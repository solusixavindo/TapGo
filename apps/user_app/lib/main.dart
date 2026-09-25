import 'dart:convert';
import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import 'package:latlong2/latlong.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io_client;
import 'package:url_launcher/url_launcher.dart';

import 'demo/client_flow_models.dart';
import 'features/ppob/application/ppob_providers.dart';
import 'services/token_refresh_coordinator.dart';
import 'features/ppob/data/ppob_demo_repository.dart';
import 'features/ppob/data/ppob_repository.dart';
import 'features/ppob/domain/ppob_models.dart';
import 'features/ppob/presentation/ppob_category_screen.dart';
import 'features/ppob/presentation/widgets/ppob_shared.dart'
    show ppobCategoryIcon, ppobStatusLabel;
import 'features/ppob/presentation/ppob_home_screen.dart';

part 'data/demo_user_session.dart';
part 'data/demo_user_session_models.dart';
part 'services/activity_feed.dart';
part 'services/push_notifications.dart';
part 'services/ride_tracking.dart';
part 'services/saved_places.dart';
part 'screens/auth_screen.dart';
part 'screens/change_password_screen.dart';
part 'screens/dashboard_screen.dart';
part 'screens/membership_screen.dart';
part 'screens/password_recovery_screen.dart';
part 'screens/ride_chat_screen.dart';
part 'screens/ride_customer_screens.dart';
part 'screens/ride_location_picker.dart';
part 'screens/ride_receipt_screen.dart';
part 'screens/splash_screen.dart';
part 'screens/verification_gate_screen.dart';
part 'screens/wallet_screen.dart';
part 'screens/wallet_transfer_screen.dart';
part 'services/persistent_demo_store.dart';
part 'services/ride_flow_controller.dart';
part 'services/ride_location_port.dart';
part 'services/tapgo_api_client.dart';
part 'tapgo_app_guards.dart';
part 'widgets/stat_card.dart';
part 'widgets/tapgo_service_illustration.dart';
part 'widgets/tapgo_button.dart';
part 'widgets/tapgo_polish.dart';
part 'widgets/ride_live_map.dart';
part 'widgets/map_user_location.dart';

const _brandBlue = Color(0xFF0569E8);
const _brandOrange = Color(0xFFFF8A00);
const _softBackground = Color(0xFFE8EFF6);
const _tapGoAppMode = String.fromEnvironment(
  'TAPGO_APP_MODE',
  defaultValue: 'production',
);
const _tapGoApiBaseUrl = String.fromEnvironment(
  'TAPGO_API_BASE_URL',
  defaultValue: 'https://api.tapgolion.id/api/v1',
);
const _isTapGoProductionBuild = _tapGoAppMode == 'production';
const _isTapGoDevelopmentBuild = _tapGoAppMode == 'development';

// Kosong = Sentry tidak aktif sama sekali (fail-closed) — sama pola dengan
// _tapGoAppMode dkk di atas. Diisi lewat --dart-define saat build.
const String kSentryDsn =
    String.fromEnvironment('SENTRY_DSN', defaultValue: '');
Future<List<Map<String, dynamic>>> Function()?
    tapGoSupportTicketsLoaderForTests;
Future<Map<String, dynamic>> Function(String ticketId)?
    tapGoSupportTicketDetailLoaderForTests;
Future<Map<String, dynamic>> Function({
  required String category,
  required String subject,
  required String message,
})? tapGoCreateSupportTicketForTests;
Future<Map<String, dynamic>> Function()? tapGoMemberIdentityLoaderForTests;
// Hook ubah password, mengikuti pola loader-for-tests di atas: test mengganti
// batas jaringan tanpa menyentuh logika layar. Nilai default null berarti
// produksi selalu memakai _apiClient.
Future<void> Function({
  required String currentPassword,
  required String newPassword,
})? tapGoChangePasswordSubmitterForTests;

// Hook Ojek Online, mengikuti pola loader-for-tests di atas. Dipakai test yang
// menyentuh widget dashboard nyata, supaya tap tidak pernah menembak jaringan.
// Nilai default null berarti produksi selalu memakai _apiClient.
Future<List<Map<String, dynamic>>> Function()? tapGoRideHistoryLoaderForTests;
Future<Map<String, dynamic>> Function(String reference)?
    tapGoRideDetailLoaderForTests;
const tapGoLocalSessionPersistenceWarning =
    'Anda berhasil masuk, tetapi sesi belum tersimpan di perangkat. '
    'Anda mungkin perlu login kembali saat aplikasi dibuka ulang.';

/// Aplikasi ini hanya didistribusikan lewat Google Play. Header ini dibaca
/// server untuk membedakan build sejak 2026-09-19 dari build lama yang perlu
/// diperbarui (lihat legacyMobileClientGate di backend).
const Map<String, String> _tapGoDistributionHeader = {
  'X-TapGo-Distribution': 'play',
};

/// Stage R2.7 — mode demo PPOB (UAT tanpa backend): katalog mini lokal dan
/// order yang jujur mencerminkan fail-closed provider (REFUNDED).
const tapGoPpobDemoMode = bool.fromEnvironment('TAPGO_PPOB_DEMO_MODE');

/// Hook uji: repositori PPOB nyata (adaptor ke klien API) tanpa provider.
@visibleForTesting
PpobRepository tapGoBuildPpobRepositoryForTests() => _buildPpobRepository();

/// Menjembatani fitur PPOB (library berdiri sendiri di lib/features/ppob/)
/// dengan _apiClient privat milik library ini. Error Dio dinormalisasi
/// menjadi PpobApiException agar lapisan UI tidak bergantung pada Dio.
PpobRepository _buildPpobRepository() {
  PpobApiException mapError(Object error) {
    if (error is DioException) {
      final data = error.response?.data;
      if (data is Map<String, dynamic>) {
        return PpobApiException(
          code: data['code'] is String ? data['code'] as String : 'UNKNOWN',
          message: data['message'] is String
              ? data['message'] as String
              : 'Terjadi kesalahan pada server.',
          statusCode: error.response?.statusCode,
        );
      }
      return PpobApiException(
        code: 'NETWORK_ERROR',
        message: 'Koneksi ke server gagal.',
        statusCode: error.response?.statusCode,
      );
    }
    if (error is PpobApiException) {
      return error;
    }
    return const PpobApiException(
      code: 'UNKNOWN',
      message: 'Terjadi kesalahan yang tidak dikenal.',
    );
  }

  Future<T> guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } catch (error) {
      throw mapError(error);
    }
  }

  return PpobRepository(
    catalogRequest: () => guard(() async {
      final payload = await _apiClient.get('ppob/catalog');
      return payload['items'] is List
          ? payload['items'] as List<dynamic>
          : const [];
    }),
    inquiryRequest: ({required sku, required targetNumber}) => guard(
      () => _apiClient.post(
        'ppob/orders/inquiry',
        body: {'sku': sku, 'targetNumber': targetNumber},
      ),
    ),
    createOrderRequest: ({
      required sku,
      required targetNumber,
      required idempotencyKey,
    }) =>
        guard(
      () => _apiClient.post(
        'ppob/orders',
        body: {
          'sku': sku,
          'targetNumber': targetNumber,
          'idempotencyKey': idempotencyKey,
        },
      ),
    ),
    ordersRequest: () => guard(() async {
      final payload = await _apiClient.get('ppob/orders');
      return payload['items'] is List
          ? payload['items'] as List<dynamic>
          : const [];
    }),
  );
}

/// Membuka beranda PPOB dari dashboard (kedua distribusi; pembelian memakai
/// saldo internal sehingga sah pada distribusi Play).
void tapGoOpenPpobHome(BuildContext context) {
  Navigator.of(context).push(
    _tapGoPageRoute((_) => const PpobHomeScreen()),
  );
}

/// Membuka satu kategori PPOB langsung (dipakai tile Super Menu — Pulsa,
/// Paket Data, Token PLN, E-Wallet, BPJS, PDAM), bukan lewat grid PpobHomeScreen
/// dulu.
///
/// Akar masalah yang diperbaiki (laporan Owner 22 Sep 2026): sebelumnya,
/// KATEGORI YANG TIDAK DITEMUKAN di katalog (mis. BPJS/PDAM sebelum penyedia
/// mengaktifkannya) diam-diam jatuh ke [PpobHomeScreen] (judul "PPOB") — tile
/// "BPJS" membuka layar yang terlihat seperti kategori lain, bukan penjelasan
/// bahwa BPJS belum tersedia. Sekarang dua kegagalan dibedakan:
///  - katalog GAGAL DIMUAT (jaringan/server) -> [PpobHomeScreen], yang sudah
///    punya UI muat-ulang sendiri untuk kegagalan sementara ini;
///  - katalog berhasil dimuat tapi kategorinya memang TIDAK ADA di dalamnya
///    -> [PpobCategoryUnavailableScreen], yang menyebut nama layanan dan
///    alasannya, bukan tampilan yang membingungkan.
Future<void> tapGoOpenPpobCategory(
  BuildContext context,
  String categoryCode, {
  required String label,
}) async {
  final navigator = Navigator.of(context);
  final container = ProviderScope.containerOf(context, listen: false);
  List<PpobCategory>? categories;
  try {
    categories = await container.read(ppobCatalogProvider.future);
  } catch (_) {
    categories = null;
  }
  if (!context.mounted) return;
  if (categories == null) {
    navigator.push(_tapGoPageRoute((_) => const PpobHomeScreen()));
    return;
  }
  PpobCategory? category;
  for (final candidate in categories) {
    if (candidate.code == categoryCode) {
      category = candidate;
      break;
    }
  }
  navigator.push(
    category != null
        ? _tapGoPageRoute((_) => PpobCategoryScreen(category: category!))
        : _tapGoPageRoute((_) => PpobCategoryUnavailableScreen(label: label)),
  );
}

enum TapGoThemePreference {
  system,
  light,
  dark;

  String get storageValue => name;

  String get label => switch (this) {
        TapGoThemePreference.system => 'Ikuti sistem',
        TapGoThemePreference.light => 'Tema terang',
        TapGoThemePreference.dark => 'Tema gelap',
      };

  ThemeMode get themeMode => switch (this) {
        TapGoThemePreference.system => ThemeMode.system,
        TapGoThemePreference.light => ThemeMode.light,
        TapGoThemePreference.dark => ThemeMode.dark,
      };

  static TapGoThemePreference fromStorageValue(String? value) {
    return switch (value?.trim().toLowerCase()) {
      'light' => TapGoThemePreference.light,
      'dark' => TapGoThemePreference.dark,
      _ => TapGoThemePreference.system,
    };
  }
}

final tapGoThemePreferenceProvider =
    StateNotifierProvider<_TapGoThemeController, TapGoThemePreference>(
  (ref) => _TapGoThemeController()..load(),
);

class _TapGoThemeController extends StateNotifier<TapGoThemePreference> {
  _TapGoThemeController() : super(TapGoThemePreference.system);

  static const _storageKey = 'tapgo.theme.preference.v1';

  Future<void> load() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      state = TapGoThemePreference.fromStorageValue(
        preferences.getString(_storageKey),
      );
    } catch (error) {
      _tapGoDebugLog('[TapGo Theme] load skipped: $error');
      state = TapGoThemePreference.system;
    }
  }

  Future<void> setPreference(TapGoThemePreference preference) async {
    state = preference;
    try {
      final preferences = await SharedPreferences.getInstance();
      await preferences.setString(_storageKey, preference.storageValue);
    } catch (error) {
      _tapGoDebugLog('[TapGo Theme] save skipped: $error');
    }
  }
}

void _tapGoDebugLog(String message) {
  if (_isTapGoDevelopmentBuild) {
    debugPrint(message);
  }
}

final _persistentStore = _TapGoPersistentStore();
final _serverConfigStore = _TapGoServerConfigStore();
final _apiClient = _TapGoApiClient(
  baseUrl: _normalizeApiBaseUrl(_tapGoApiBaseUrl),
);
final _tapGoScaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();
final _tapGoNavigatorKey = GlobalKey<NavigatorState>();

/// Hook uji: mensimulasikan server yang menegaskan sesi sudah berakhir.
@visibleForTesting
void tapGoTriggerSessionExpiredForTests() =>
    _apiClient.onSessionExpired?.call();

/// Hook uji: mengganti adaptor HTTP klien API sehingga SELURUH kode klien
/// nyata (pemetaan request, header, penanganan error) ikut teruji terhadap
/// server palsu, tanpa jaringan. Berikan null untuk mengembalikan aslinya.
final HttpClientAdapter _tapGoOriginalHttpAdapter =
    _apiClient._dio.httpClientAdapter;
@visibleForTesting
void tapGoSetHttpAdapterForTests(HttpClientAdapter? adapter) {
  final original = _tapGoOriginalHttpAdapter; // ditangkap sebelum diganti
  _apiClient._dio.httpClientAdapter = adapter ?? original;
}

const _productionApiRootUrl = 'https://api.tapgolion.id';
const _productionFinalSyncResetKey =
    'tapgo.production.final_sync_cache_reset.v1';
bool tapGoDisablePersistenceForTests = false;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (kSentryDsn.isEmpty) {
    // Tanpa DSN, Sentry tidak aktif sama sekali — jangan panggil
    // SentryFlutter.init() dengan DSN kosong (SDK akan warning).
    await _runTapGoUserApp();
    return;
  }
  await SentryFlutter.init(
    (options) {
      options.dsn = kSentryDsn;
      options.environment = _tapGoAppMode;
      // 10%: sama seperti tracesSampleRate backend — cukup untuk gambaran
      // performa tanpa membebani kuota Sentry.
      options.tracesSampleRate = 0.1;
      // Data pribadi pengguna (NIK, telepon, dsb.) tidak boleh terkirim ke
      // Sentry — konsisten dengan redaksi ketat logger backend.
      options.sendDefaultPii = false;
    },
    appRunner: _runTapGoUserApp,
  );
}

Future<void> _runTapGoUserApp() async {
  installTapGoCrashGuards();
  try {
    if (_isTapGoProductionBuild) {
      await _prepareProductionFinalSync().timeout(
        const Duration(seconds: 3),
        onTimeout: () {
          _tapGoDebugLog('[TapGo Startup] production cache reset timed out.');
        },
      );
      _apiClient.setBaseUrl(_productionApiRootUrl);
    } else {
      final savedApiBaseUrl = await _serverConfigStore.loadApiBaseUrl().timeout(
            const Duration(seconds: 2),
            onTimeout: () => null,
          );
      if (savedApiBaseUrl != null && savedApiBaseUrl.trim().isNotEmpty) {
        _apiClient.setBaseUrl(savedApiBaseUrl);
      }
    }
  } catch (error) {
    _tapGoDebugLog('[TapGo Startup] init skipped: $error');
    if (_isTapGoProductionBuild) {
      _apiClient.setBaseUrl(_productionApiRootUrl);
    }
  }
  runApp(
    ProviderScope(
      overrides: [
        ppobRepositoryProvider.overrideWithValue(
          tapGoPpobDemoMode
              ? createDemoPpobRepository()
              : _buildPpobRepository(),
        ),
      ],
      child: const TapGoUserApp(),
    ),
  );
}

Future<void> _prepareProductionFinalSync() async {
  if (tapGoDisablePersistenceForTests) {
    return;
  }
  final preferences = await SharedPreferences.getInstance();
  final alreadyReset =
      preferences.getBool(_productionFinalSyncResetKey) ?? false;
  if (alreadyReset) {
    return;
  }
  try {
    await _serverConfigStore.resetApiBaseUrl().timeout(
          const Duration(seconds: 1),
        );
  } catch (error) {
    _tapGoDebugLog('[TapGo Startup] server config reset skipped: $error');
  }
  try {
    await _persistentStore.clearProductionRuntimeCache().timeout(
          const Duration(seconds: 2),
        );
  } catch (error) {
    _tapGoDebugLog('[TapGo Startup] secure cache reset skipped: $error');
  }
  try {
    await preferences
        .setBool(_productionFinalSyncResetKey, true)
        .timeout(const Duration(seconds: 1));
  } catch (error) {
    _tapGoDebugLog('[TapGo Startup] reset marker write skipped: $error');
  }
}

class TapGoUserApp extends ConsumerWidget {
  const TapGoUserApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isAuthenticated = ref.watch(_isAuthenticatedProvider);
    final themePreference = ref.watch(tapGoThemePreferenceProvider);

    // Data PPOB terikat pada sesi: begitu pengguna masuk/keluar/berganti akun,
    // katalog dan riwayat yang tersimpan (termasuk ERROR lama seperti "sesi
    // berakhir") dibuang dan dimuat ulang. Sebelumnya error sebelum login tetap
    // tampil setelah login berhasil.
    void refetchPpob(Object? previous, Object? next) {
      ref.invalidate(ppobCatalogProvider);
      ref.invalidate(ppobOrdersProvider);
    }

    ref.listen<bool>(_isAuthenticatedProvider, refetchPpob);
    ref.listen<bool>(_isAuthenticatedProvider, (previous, next) {
      if (next) {
        tapGoStartPush();
      } else if (previous == true) {
        // Semua jalur keluar (logout, sesi berakhir, ganti password) lewat
        // sini: token lokal dihapus agar HP tak lagi menerima notifikasi akun
        // yang sudah keluar. Logout manual sudah mencabut token lebih dulu;
        // panggilan ini idempoten.
        unawaited(tapGoStopPush());
      }
    });
    ref.listen<String?>(
      _demoSessionProvider.select((session) => session.userId),
      refetchPpob,
    );

    return MaterialApp(
      title: 'TapGo',
      scaffoldMessengerKey: _tapGoScaffoldMessengerKey,
      navigatorKey: _tapGoNavigatorKey,
      debugShowCheckedModeBanner: false,
      theme: tapGoReadableTheme(),
      darkTheme: tapGoReadableTheme(brightness: Brightness.dark),
      themeMode: themePreference.themeMode,
      home: _SessionBootstrap(
        child:
            isAuthenticated ? const _RoleDashboardGate() : const SplashGate(),
      ),
    );
  }
}

/// Tema aplikasi. Publik supaya harness bukti visual Stage R2.4 merender
/// layar dengan tema yang sama persis dengan aplikasi, bukan tema Material
/// bawaan yang warnanya berbeda dari merek TapGo.
ThemeData tapGoReadableTheme({Brightness brightness = Brightness.light}) {
  final isDark = brightness == Brightness.dark;
  final scaffoldBackground = isDark ? const Color(0xFF071525) : _softBackground;
  final surfaceColor = isDark ? const Color(0xFF0B1F35) : Colors.white;
  final inputFillColor = isDark ? const Color(0xFF102A44) : Colors.white;
  final inputBorderColor =
      isDark ? const Color(0xFF29445F) : const Color(0xFFEAF0F6);
  final inputTextColor =
      isDark ? const Color(0xFFEAF7FF) : const Color(0xFF172033);
  // Abu-abu sekunder terang digelapkan sedikit (94A3B8 -> 64748B) agar tetap
  // terbaca di atas latar yang kini lebih pekat.
  final inputHintColor =
      isDark ? const Color(0xFFA9B8C9) : const Color(0xFF64748B);
  final scheme = ColorScheme.fromSeed(
    seedColor: _brandBlue,
    brightness: brightness,
  ).copyWith(
    surface: surfaceColor,
    onSurface: inputTextColor,
    onSurfaceVariant: inputHintColor,
    outlineVariant: inputBorderColor,
  );

  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: scaffoldBackground,
    cardColor: surfaceColor,
    canvasColor: scaffoldBackground,
    dialogTheme: DialogThemeData(backgroundColor: surfaceColor),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: inputFillColor,
      labelStyle: TextStyle(color: inputHintColor),
      hintStyle: TextStyle(color: inputHintColor),
      prefixIconColor: isDark ? const Color(0xFF8CC4FF) : _brandBlue,
      suffixIconColor: isDark ? const Color(0xFF8CC4FF) : _brandBlue,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: inputBorderColor),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: inputBorderColor),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: _brandBlue, width: 1.4),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFEF4444)),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFEF4444), width: 1.4),
      ),
      errorStyle: const TextStyle(
        color: Color(0xFFEF4444),
        fontWeight: FontWeight.w700,
      ),
    ),
    textTheme: TextTheme(
      bodyLarge: TextStyle(color: inputTextColor),
      bodyMedium: TextStyle(color: inputTextColor),
      bodySmall: TextStyle(color: inputHintColor),
      titleLarge: TextStyle(
        color: isDark ? const Color(0xFFF8FBFF) : const Color(0xFF0A2A43),
      ),
      titleMedium: TextStyle(color: inputTextColor),
      titleSmall: TextStyle(color: inputTextColor),
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: Color(0xFF172033),
      contentTextStyle: TextStyle(color: Colors.white),
      behavior: SnackBarBehavior.floating,
    ),
    textSelectionTheme: const TextSelectionThemeData(
      cursorColor: _brandBlue,
      selectionColor: Color(0x332F80ED),
      selectionHandleColor: _brandBlue,
    ),
    useMaterial3: true,
    fontFamily: 'Roboto',
  );
}

Color _tapGoTextPrimary(BuildContext context) =>
    Theme.of(context).colorScheme.onSurface;

class _RoleDashboardGate extends ConsumerWidget {
  const _RoleDashboardGate();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Keputusan owner: aplikasi user tidak menampilkan dashboard admin untuk
    // peran apa pun. Admin/Super Admin bekerja di konsol web; di aplikasi
    // mereka diperlakukan seperti member biasa.
    const dashboard = TapGoDashboard();

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        confirmTapGoExit(context).then((exitConfirmed) {
          if (exitConfirmed) SystemNavigator.pop();
        });
      },
      child: dashboard,
    );
  }
}
