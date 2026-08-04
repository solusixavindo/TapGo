import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const bool kDriverDemoMode = bool.fromEnvironment(
  'TAPGO_DRIVER_DEMO_MODE',
);
const String kApiBaseUrl = String.fromEnvironment(
  'TAPGO_API_BASE_URL',
  defaultValue: 'https://api.tapgolion.id/api/v1',
);

void main() {
  runApp(
    ProviderScope(
      overrides: [
        driverRepositoryProvider.overrideWithValue(
          kDriverDemoMode
              ? DemoDriverRepository()
              : ApiDriverRepository(
                  baseUrl: kApiBaseUrl,
                  storage: kIsWeb ? MemorySessionStore() : SecureSessionStore(),
                ),
        ),
        locationPortProvider.overrideWithValue(NoDriverLocationPort()),
      ],
      child: const TapGoDriverApp(),
    ),
  );
}

@visibleForTesting
Widget buildTestableDriverApp({
  required DriverRepository repository,
  DriverLocationPort? locationPort,
  DriverScenario scenario = DriverScenario.homeOffline,
  ThemeMode themeMode = ThemeMode.light,
}) {
  return ProviderScope(
    overrides: [
      driverRepositoryProvider.overrideWithValue(repository),
      locationPortProvider
          .overrideWithValue(locationPort ?? NoDriverLocationPort()),
      initialScenarioProvider.overrideWithValue(scenario),
      testThemeModeProvider.overrideWithValue(themeMode),
    ],
    child: const TapGoDriverApp(),
  );
}

final driverRepositoryProvider = Provider<DriverRepository>(
  (_) => kDriverDemoMode
      ? DemoDriverRepository()
      : ApiDriverRepository(
          baseUrl: kApiBaseUrl,
          storage: kIsWeb ? MemorySessionStore() : SecureSessionStore(),
        ),
);
final locationPortProvider =
    Provider<DriverLocationPort>((_) => NoDriverLocationPort());
final initialScenarioProvider =
    Provider<DriverScenario>((_) => DriverScenario.login);
final testThemeModeProvider = Provider<ThemeMode?>((_) => null);
final driverControllerProvider =
    StateNotifierProvider<DriverController, DriverState>((ref) {
  return DriverController(
    repository: ref.watch(driverRepositoryProvider),
    locationPort: ref.watch(locationPortProvider),
    initialScenario: ref.watch(initialScenarioProvider),
  );
});

class TapGoDriverApp extends ConsumerWidget {
  const TapGoDriverApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(testThemeModeProvider);
    return MaterialApp(
      title: 'TapGo Driver',
      debugShowCheckedModeBanner: false,
      themeMode: themeMode ?? ThemeMode.system,
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      home: const DriverShell(),
    );
  }
}

ThemeData _theme(Brightness brightness) {
  const navy = Color(0xFF061A2F);
  const blue = Color(0xFF0877E8);
  const gold = Color(0xFFFFC857);
  final isDark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: blue,
    brightness: brightness,
    primary: blue,
    secondary: gold,
    surface: isDark ? const Color(0xFF091A2B) : Colors.white,
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor:
        isDark ? const Color(0xFF06101E) : const Color(0xFFF3F7FB),
    appBarTheme: AppBarTheme(
      elevation: 0,
      centerTitle: false,
      backgroundColor: isDark ? const Color(0xFF071525) : navy,
      foregroundColor: Colors.white,
    ),
    textTheme: const TextTheme(
      headlineSmall: TextStyle(fontWeight: FontWeight.w800),
      titleLarge: TextStyle(fontWeight: FontWeight.w800),
      titleMedium: TextStyle(fontWeight: FontWeight.w800),
      bodyMedium: TextStyle(height: 1.35),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      color: isDark ? const Color(0xFF0D2136) : Colors.white,
    ),
  );
}

enum DriverScenario {
  login,
  profileRequired,
  pending,
  suspended,
  accountInactive,
  homeOffline,
  homeOnline,
  offerEmpty,
  offerAvailable,
  toPickup,
  arrived,
  inTrip,
  completed,
  cancelled,
  networkError,
  sessionExpired,
}

enum DriverWorkspaceStatus {
  loading,
  unauthenticated,
  profileRequired,
  pending,
  suspended,
  rejected,
  accountInactive,
  active,
  sessionExpired,
  networkError,
}

enum RideStatus {
  searchingDriver,
  driverAssigned,
  driverToPickup,
  driverArrived,
  inTrip,
  completed,
  cancelledByPassenger,
  cancelledByDriver,
  cancelledBySystem,
  expired,
  noDriver,
  paymentFailed,
  unknown,
}

enum DriverAvailability { offline, online, busy }

class DriverState {
  const DriverState({
    required this.status,
    required this.availability,
    required this.offers,
    this.session,
    this.activeRide,
    this.selectedOffer,
    this.message,
    this.isBusy = false,
    this.isPolling = false,
    this.demoScenario = DriverScenario.login,
  });

  factory DriverState.initial(DriverScenario scenario) => DriverState(
        status: DriverWorkspaceStatus.loading,
        availability: DriverAvailability.offline,
        offers: const [],
        demoScenario: scenario,
      );

  final DriverWorkspaceStatus status;
  final DriverAvailability availability;
  final List<DriverRide> offers;
  final DriverSession? session;
  final DriverRide? activeRide;
  final DriverRide? selectedOffer;
  final String? message;
  final bool isBusy;
  final bool isPolling;
  final DriverScenario demoScenario;

  bool get isAuthenticated => session != null;
  bool get isActive => status == DriverWorkspaceStatus.active;
  bool get hasTerminalRide => activeRide?.isTerminal ?? false;

  DriverState copyWith({
    DriverWorkspaceStatus? status,
    DriverAvailability? availability,
    List<DriverRide>? offers,
    DriverSession? session,
    bool clearSession = false,
    DriverRide? activeRide,
    bool clearActiveRide = false,
    DriverRide? selectedOffer,
    bool clearSelectedOffer = false,
    String? message,
    bool clearMessage = false,
    bool? isBusy,
    bool? isPolling,
    DriverScenario? demoScenario,
  }) {
    return DriverState(
      status: status ?? this.status,
      availability: availability ?? this.availability,
      offers: offers ?? this.offers,
      session: clearSession ? null : session ?? this.session,
      activeRide: clearActiveRide ? null : activeRide ?? this.activeRide,
      selectedOffer:
          clearSelectedOffer ? null : selectedOffer ?? this.selectedOffer,
      message: clearMessage ? null : message ?? this.message,
      isBusy: isBusy ?? this.isBusy,
      isPolling: isPolling ?? this.isPolling,
      demoScenario: demoScenario ?? this.demoScenario,
    );
  }
}

class DriverSession {
  const DriverSession({
    required this.accessToken,
    required this.refreshToken,
    required this.driverName,
  });
  final String accessToken;
  final String refreshToken;
  final String driverName;
}

class DriverRide {
  const DriverRide({
    required this.reference,
    required this.serviceType,
    required this.status,
    required this.pickupAddress,
    required this.dropoffAddress,
    this.distanceMeters,
    this.durationSeconds,
    this.totalFare,
    this.currency = 'IDR',
    this.updatedAt,
  });

  factory DriverRide.fromJson(Map<String, dynamic> json) {
    final pickup = json['pickup'];
    final dropoff = json['dropoff'];
    final fare = json['fare'];
    return DriverRide(
      reference: '${json['reference'] ?? json['publicReference'] ?? ''}',
      serviceType: '${json['serviceType'] ?? 'MOTORCYCLE'}',
      status: _rideStatus('${json['status'] ?? ''}'),
      pickupAddress: _addressOf(pickup, json['pickupAddress']),
      dropoffAddress: _addressOf(dropoff, json['dropoffAddress']),
      distanceMeters: _intOf(json['distanceMeters'] ?? json['distance']),
      durationSeconds: _intOf(json['durationSeconds'] ?? json['duration']),
      totalFare:
          _intOf(json['totalFare'] ?? (fare is Map ? fare['totalFare'] : null)),
      currency:
          '${(fare is Map ? fare['currency'] : null) ?? json['currency'] ?? 'IDR'}',
      updatedAt: DateTime.tryParse('${json['updatedAt'] ?? ''}'),
    );
  }

  final String reference;
  final String serviceType;
  final RideStatus status;
  final String pickupAddress;
  final String dropoffAddress;
  final int? distanceMeters;
  final int? durationSeconds;
  final int? totalFare;
  final String currency;
  final DateTime? updatedAt;

  bool get isTerminal => {
        RideStatus.completed,
        RideStatus.cancelledByDriver,
        RideStatus.cancelledByPassenger,
        RideStatus.cancelledBySystem,
        RideStatus.expired,
        RideStatus.noDriver,
        RideStatus.paymentFailed,
      }.contains(status);
}

RideStatus _rideStatus(String value) {
  switch (value) {
    case 'SEARCHING_DRIVER':
      return RideStatus.searchingDriver;
    case 'DRIVER_ASSIGNED':
      return RideStatus.driverAssigned;
    case 'DRIVER_TO_PICKUP':
      return RideStatus.driverToPickup;
    case 'DRIVER_ARRIVED':
      return RideStatus.driverArrived;
    case 'IN_TRIP':
      return RideStatus.inTrip;
    case 'COMPLETED':
      return RideStatus.completed;
    case 'CANCELLED_BY_PASSENGER':
      return RideStatus.cancelledByPassenger;
    case 'CANCELLED_BY_DRIVER':
      return RideStatus.cancelledByDriver;
    case 'CANCELLED_BY_SYSTEM':
      return RideStatus.cancelledBySystem;
    case 'EXPIRED':
      return RideStatus.expired;
    case 'NO_DRIVER':
      return RideStatus.noDriver;
    case 'PAYMENT_FAILED':
      return RideStatus.paymentFailed;
    default:
      return RideStatus.unknown;
  }
}

String _addressOf(Object? nested, Object? fallback) {
  if (nested is Map && nested['address'] != null) return '${nested['address']}';
  return '${fallback ?? 'Lokasi belum tersedia'}';
}

int? _intOf(Object? value) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse('$value');
}

abstract class DriverRepository {
  Future<DriverSession?> restoreSession();
  Future<DriverSession> login(
      {required String phone, required String password});
  Future<void> logout();
  Future<DriverAvailability> setAvailability(DriverAvailability availability);
  Future<List<DriverRide>> offers();
  Future<DriverRide?> currentRide();
  Future<DriverRide> accept(String reference);
  Future<void> reject(String reference);
  Future<DriverRide> pickup(String reference);
  Future<DriverRide> arrived(String reference);
  Future<DriverRide> start(String reference);
  Future<DriverRide> complete(String reference);
  Future<DriverRide> cancel(String reference, String reason);
}

abstract class SessionStore {
  Future<void> save(DriverSession session);
  Future<DriverSession?> read();
  Future<void> clear();
}

class MemorySessionStore implements SessionStore {
  DriverSession? _session;
  @override
  Future<void> save(DriverSession session) async => _session = session;
  @override
  Future<DriverSession?> read() async => _session;
  @override
  Future<void> clear() async => _session = null;
}

class SecureSessionStore implements SessionStore {
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  static const _access = 'tapgo.driver.access.v1';
  static const _refresh = 'tapgo.driver.refresh.v1';
  static const _name = 'tapgo.driver.name.v1';

  @override
  Future<void> save(DriverSession session) async {
    await _storage.write(key: _access, value: session.accessToken);
    await _storage.write(key: _refresh, value: session.refreshToken);
    await _storage.write(key: _name, value: session.driverName);
  }

  @override
  Future<DriverSession?> read() async {
    final access = await _storage.read(key: _access);
    final refresh = await _storage.read(key: _refresh);
    if (access == null || refresh == null) return null;
    return DriverSession(
      accessToken: access,
      refreshToken: refresh,
      driverName: await _storage.read(key: _name) ?? 'Driver TapGo',
    );
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
    await _storage.delete(key: _name);
  }
}

class ApiDriverRepository implements DriverRepository {
  ApiDriverRepository({required String baseUrl, required SessionStore storage})
      : _storage = storage,
        _dio = Dio(
          BaseOptions(
            baseUrl: _normalizeBaseUrl(baseUrl),
            connectTimeout: const Duration(seconds: 8),
            receiveTimeout: const Duration(seconds: 12),
            headers: {'Accept': 'application/json'},
          ),
        );

  final Dio _dio;
  final SessionStore _storage;
  DriverSession? _session;

  @override
  Future<DriverSession?> restoreSession() async {
    _session = await _storage.read();
    _applyToken();
    if (_session == null) return null;
    try {
      await currentRide();
      return _session;
    } on DriverApiException catch (error) {
      if (error.isAuthOrCapability) {
        await _storage.clear();
        _session = null;
        _applyToken();
      }
      rethrow;
    }
  }

  @override
  Future<DriverSession> login(
      {required String phone, required String password}) async {
    final data = await _request(
      () => _dio.post<dynamic>(
        '/auth/login',
        data: {'phone': _normalizePhone(phone), 'password': password},
      ),
    );
    final session = _sessionFrom(data);
    _session = session;
    _applyToken();
    await _storage.save(session);
    return session;
  }

  @override
  Future<void> logout() async {
    try {
      if (_session != null) {
        await _request(() => _dio.post<dynamic>('/auth/logout'));
      }
    } catch (_) {
      // Local logout tetap harus membersihkan sesi. Error backend tidak
      // ditampilkan mentah ke user.
    } finally {
      _session = null;
      _applyToken();
      await _storage.clear();
    }
  }

  @override
  Future<DriverAvailability> setAvailability(
      DriverAvailability availability) async {
    final data = await _request(
      () => _dio.post<dynamic>(
        '/driver/availability',
        data: {'availability': _availabilityApi(availability)},
      ),
    );
    return _availabilityFrom(
        '${data['availability'] ?? _availabilityApi(availability)}');
  }

  @override
  Future<List<DriverRide>> offers() async {
    final data =
        await _request(() => _dio.get<dynamic>('/driver/rides/offers'));
    final items = data['items'] is List
        ? data['items'] as List
        : data['data'] as List? ?? const [];
    return items
        .whereType<Map>()
        .map((e) => DriverRide.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  @override
  Future<DriverRide?> currentRide() async {
    final data =
        await _request(() => _dio.get<dynamic>('/driver/rides/current'));
    if (data.isEmpty || data['isNull'] == true) return null;
    return DriverRide.fromJson(data);
  }

  @override
  Future<DriverRide> accept(String reference) =>
      _rideMutation('/driver/rides/$reference/accept');
  @override
  Future<void> reject(String reference) async {
    await _request(() => _dio.post<dynamic>('/driver/rides/$reference/reject'));
  }

  @override
  Future<DriverRide> pickup(String reference) =>
      _rideMutation('/driver/rides/$reference/pickup');
  @override
  Future<DriverRide> arrived(String reference) =>
      _rideMutation('/driver/rides/$reference/arrived');
  @override
  Future<DriverRide> start(String reference) =>
      _rideMutation('/driver/rides/$reference/start');
  @override
  Future<DriverRide> complete(String reference) =>
      _rideMutation('/driver/rides/$reference/complete');
  @override
  Future<DriverRide> cancel(String reference, String reason) async {
    final data = await _request(
      () => _dio.post<dynamic>(
        '/driver/rides/$reference/cancel',
        data: {'reason': reason},
      ),
    );
    return DriverRide.fromJson(data);
  }

  Future<DriverRide> _rideMutation(String path) async {
    final data = await _request(() => _dio.post<dynamic>(path));
    return DriverRide.fromJson(data);
  }

  void _applyToken() {
    if (_session?.accessToken case final token?) {
      _dio.options.headers['Authorization'] = 'Bearer $token';
    } else {
      _dio.options.headers.remove('Authorization');
    }
  }
}

Future<Map<String, dynamic>> _request(
    Future<Response<dynamic>> Function() call) async {
  try {
    final response = await call();
    final body = response.data;
    if (body is Map<String, dynamic>) {
      final data = body['data'];
      if (data == null) return const {'isNull': true};
      if (data is List) return {'items': data};
      if (data is Map<String, dynamic>) return data;
      if (data is Map) return Map<String, dynamic>.from(data);
    }
    return const {};
  } on DioException catch (error) {
    final body = error.response?.data;
    String code = 'NETWORK_ERROR';
    String message = 'Koneksi belum stabil. Silakan coba lagi.';
    if (body is Map) {
      code = '${body['code'] ?? code}';
      message = _friendlyMessage(code, '${body['message'] ?? message}');
    }
    throw DriverApiException(
        code: code, message: message, statusCode: error.response?.statusCode);
  }
}

String _normalizeBaseUrl(String value) {
  final trimmed = value.trim();
  return trimmed.endsWith('/')
      ? trimmed.substring(0, trimmed.length - 1)
      : trimmed;
}

String _normalizePhone(String value) {
  final digits = value.replaceAll(RegExp(r'[^0-9+]'), '');
  if (digits.startsWith('+62')) return digits;
  if (digits.startsWith('62')) return '+$digits';
  if (digits.startsWith('0')) return '+62${digits.substring(1)}';
  return digits;
}

DriverSession _sessionFrom(Map<String, dynamic> data) {
  final access = '${data['accessToken'] ?? data['token'] ?? ''}';
  final refresh = '${data['refreshToken'] ?? ''}';
  final user = data['user'];
  final name = user is Map
      ? '${user['fullName'] ?? user['name'] ?? 'Driver TapGo'}'
      : 'Driver TapGo';
  if (access.isEmpty || refresh.isEmpty) {
    throw const DriverApiException(
      code: 'INVALID_AUTH_RESPONSE',
      message: 'Sesi tidak dapat diproses. Silakan coba lagi.',
    );
  }
  return DriverSession(
      accessToken: access, refreshToken: refresh, driverName: name);
}

class DriverApiException implements Exception {
  const DriverApiException(
      {required this.code, required this.message, this.statusCode});
  final String code;
  final String message;
  final int? statusCode;

  bool get isAuthOrCapability =>
      statusCode == 401 ||
      code == 'AUTH_REQUIRED' ||
      code == 'RIDE_DRIVER_PROFILE_REQUIRED' ||
      code == 'RIDE_DRIVER_NOT_ACTIVE' ||
      code == 'RIDE_DRIVER_ACCOUNT_INACTIVE';
}

String _friendlyMessage(String code, String fallback) {
  switch (code) {
    case 'RIDE_DRIVER_PROFILE_REQUIRED':
      return 'Profil driver belum tersedia. Hubungi admin TapGo.';
    case 'RIDE_DRIVER_NOT_ACTIVE':
      return 'Akun driver belum aktif untuk menerima perjalanan.';
    case 'RIDE_DRIVER_ACCOUNT_INACTIVE':
      return 'Akun Anda tidak aktif. Hubungi dukungan TapGo.';
    case 'RIDE_ALREADY_TAKEN':
      return 'Perjalanan sudah diambil driver lain.';
    case 'RIDE_DRIVER_ACTIVE_RIDE_CONFLICT':
      return 'Status perjalanan aktif perlu diperiksa admin.';
    case 'AUTH_REQUIRED':
      return 'Sesi berakhir. Silakan login kembali.';
    default:
      return fallback.isEmpty
          ? 'Terjadi kendala. Silakan coba lagi.'
          : fallback;
  }
}

String _availabilityApi(DriverAvailability value) {
  switch (value) {
    case DriverAvailability.online:
      return 'ONLINE';
    case DriverAvailability.busy:
      return 'BUSY';
    case DriverAvailability.offline:
      return 'OFFLINE';
  }
}

DriverAvailability _availabilityFrom(String value) {
  switch (value) {
    case 'ONLINE':
      return DriverAvailability.online;
    case 'BUSY':
      return DriverAvailability.busy;
    default:
      return DriverAvailability.offline;
  }
}

abstract class DriverLocationPort {
  Future<bool> get isAvailable;
  Future<void> sendCurrentLocation();
}

class NoDriverLocationPort implements DriverLocationPort {
  @override
  Future<bool> get isAvailable async => false;

  @override
  Future<void> sendCurrentLocation() async {
    throw const DriverApiException(
      code: 'LOCATION_PROVIDER_UNAVAILABLE',
      message: 'Lokasi belum tersedia pada versi ini.',
    );
  }
}

class DemoDriverRepository implements DriverRepository {
  DemoDriverRepository({DriverScenario initialScenario = DriverScenario.login})
      : _scenario = initialScenario;

  DriverScenario _scenario;
  DriverSession? _session;
  DriverAvailability _availability = DriverAvailability.offline;
  int networkCalls = 0;

  void setScenario(DriverScenario scenario) {
    _scenario = scenario;
    _availability = scenario == DriverScenario.homeOnline ||
            scenario == DriverScenario.offerAvailable ||
            scenario == DriverScenario.offerEmpty
        ? DriverAvailability.online
        : DriverAvailability.offline;
  }

  @override
  Future<DriverSession?> restoreSession() async {
    if (_scenario == DriverScenario.login) return null;
    _session ??= const DriverSession(
      accessToken: 'DEMO_ACCESS',
      refreshToken: 'DEMO_REFRESH',
      driverName: 'DRIVER_DEMO',
    );
    return _session;
  }

  @override
  Future<DriverSession> login(
      {required String phone, required String password}) async {
    if (_scenario == DriverScenario.sessionExpired) {
      throw const DriverApiException(
        code: 'AUTH_REQUIRED',
        message: 'Sesi berakhir. Silakan login kembali.',
        statusCode: 401,
      );
    }
    _session = const DriverSession(
      accessToken: 'DEMO_ACCESS',
      refreshToken: 'DEMO_REFRESH',
      driverName: 'DRIVER_DEMO',
    );
    if (_scenario == DriverScenario.login) {
      setScenario(DriverScenario.homeOffline);
    }
    return _session!;
  }

  @override
  Future<void> logout() async {
    _session = null;
    _scenario = DriverScenario.login;
  }

  @override
  Future<DriverAvailability> setAvailability(
      DriverAvailability availability) async {
    _availability = availability;
    if (availability == DriverAvailability.online &&
        _scenario == DriverScenario.homeOffline) {
      _scenario = DriverScenario.homeOnline;
    }
    return _availability;
  }

  @override
  Future<List<DriverRide>> offers() async {
    if (_scenario == DriverScenario.networkError) {
      throw const DriverApiException(
          code: 'NETWORK_ERROR', message: 'Koneksi belum stabil.');
    }
    if (_scenario == DriverScenario.offerAvailable ||
        _scenario == DriverScenario.homeOnline) {
      return [_demoOffer];
    }
    return const [];
  }

  @override
  Future<DriverRide?> currentRide() async {
    switch (_scenario) {
      case DriverScenario.profileRequired:
        throw const DriverApiException(
          code: 'RIDE_DRIVER_PROFILE_REQUIRED',
          message: 'Profil driver belum tersedia. Hubungi admin TapGo.',
          statusCode: 403,
        );
      case DriverScenario.pending:
        throw const DriverApiException(
          code: 'RIDE_DRIVER_NOT_ACTIVE',
          message: 'Akun driver belum aktif untuk menerima perjalanan.',
          statusCode: 403,
        );
      case DriverScenario.suspended:
        throw const DriverApiException(
          code: 'RIDE_DRIVER_NOT_ACTIVE',
          message: 'Akun driver belum aktif untuk menerima perjalanan.',
          statusCode: 403,
        );
      case DriverScenario.accountInactive:
        throw const DriverApiException(
          code: 'RIDE_DRIVER_ACCOUNT_INACTIVE',
          message: 'Akun Anda tidak aktif. Hubungi dukungan TapGo.',
          statusCode: 403,
        );
      case DriverScenario.networkError:
        throw const DriverApiException(
          code: 'NETWORK_ERROR',
          message: 'Koneksi belum stabil.',
        );
      case DriverScenario.toPickup:
        return _demoRide(RideStatus.driverToPickup);
      case DriverScenario.arrived:
        return _demoRide(RideStatus.driverArrived);
      case DriverScenario.inTrip:
        return _demoRide(RideStatus.inTrip);
      case DriverScenario.completed:
        return _demoRide(RideStatus.completed);
      case DriverScenario.cancelled:
        return _demoRide(RideStatus.cancelledByDriver);
      case DriverScenario.sessionExpired:
        throw const DriverApiException(
          code: 'AUTH_REQUIRED',
          message: 'Sesi berakhir. Silakan login kembali.',
          statusCode: 401,
        );
      default:
        return null;
    }
  }

  @override
  Future<DriverRide> accept(String reference) async {
    _scenario = DriverScenario.toPickup;
    return _demoRide(RideStatus.driverToPickup);
  }

  @override
  Future<void> reject(String reference) async {
    _scenario = DriverScenario.offerEmpty;
  }

  @override
  Future<DriverRide> pickup(String reference) async {
    _scenario = DriverScenario.toPickup;
    return _demoRide(RideStatus.driverToPickup);
  }

  @override
  Future<DriverRide> arrived(String reference) async {
    _scenario = DriverScenario.arrived;
    return _demoRide(RideStatus.driverArrived);
  }

  @override
  Future<DriverRide> start(String reference) async {
    _scenario = DriverScenario.inTrip;
    return _demoRide(RideStatus.inTrip);
  }

  @override
  Future<DriverRide> complete(String reference) async {
    _scenario = DriverScenario.completed;
    return _demoRide(RideStatus.completed);
  }

  @override
  Future<DriverRide> cancel(String reference, String reason) async {
    _scenario = DriverScenario.cancelled;
    return _demoRide(RideStatus.cancelledByDriver);
  }
}

DriverRide get _demoOffer => const DriverRide(
      reference: 'RIDE-DEMO-001',
      serviceType: 'MOTORCYCLE',
      status: RideStatus.searchingDriver,
      pickupAddress: 'LOKASI_DEMO_A',
      dropoffAddress: 'LOKASI_DEMO_B',
      distanceMeters: 2500,
      durationSeconds: 600,
      totalFare: 9000,
    );

DriverRide _demoRide(RideStatus status) => DriverRide(
      reference: 'RIDE-DEMO-001',
      serviceType: 'MOTORCYCLE',
      status: status,
      pickupAddress: 'LOKASI_DEMO_A',
      dropoffAddress: 'LOKASI_DEMO_B',
      distanceMeters: 2500,
      durationSeconds: 600,
      totalFare: 9000,
      updatedAt: DateTime(2026, 8, 4, 9, 30),
    );

class DriverController extends StateNotifier<DriverState>
    with WidgetsBindingObserver {
  DriverController({
    required DriverRepository repository,
    required DriverLocationPort locationPort,
    required DriverScenario initialScenario,
  })  : _repository = repository,
        _locationPort = locationPort,
        super(DriverState.initial(initialScenario)) {
    WidgetsBinding.instance.addObserver(this);
    if (_repository case final DemoDriverRepository demo) {
      demo.setScenario(initialScenario);
    }
    unawaited(restore());
  }

  final DriverRepository _repository;
  final DriverLocationPort _locationPort;
  Timer? _pollTimer;
  bool _polling = false;
  final Set<String> _singleFlights = <String>{};

  Future<void> restore() async {
    state = state.copyWith(
        status: DriverWorkspaceStatus.loading, clearMessage: true);
    try {
      final session = await _repository.restoreSession();
      if (session == null) {
        state = state.copyWith(
          status: DriverWorkspaceStatus.unauthenticated,
          clearSession: true,
        );
        return;
      }
      state = state.copyWith(session: session);
      await refreshWorkspace();
    } on DriverApiException catch (error) {
      _applyCapabilityError(error);
    } catch (_) {
      state = state.copyWith(
        status: DriverWorkspaceStatus.networkError,
        message: 'Koneksi belum stabil. Silakan coba lagi.',
      );
    }
  }

  Future<void> login(String phone, String password) async {
    if (!_startFlight('login')) return;
    state = state.copyWith(isBusy: true, clearMessage: true);
    try {
      final session = await _repository.login(phone: phone, password: password);
      state = state.copyWith(session: session);
      await refreshWorkspace();
    } on DriverApiException catch (error) {
      state = state.copyWith(
        status: error.statusCode == 401
            ? DriverWorkspaceStatus.sessionExpired
            : DriverWorkspaceStatus.unauthenticated,
        message: error.message,
      );
    } finally {
      _endFlight('login');
      state = state.copyWith(isBusy: false);
    }
  }

  Future<void> logout() async {
    _stopPolling();
    await _repository.logout();
    state = state.copyWith(
      status: DriverWorkspaceStatus.unauthenticated,
      clearSession: true,
      clearActiveRide: true,
      clearSelectedOffer: true,
      offers: const [],
      availability: DriverAvailability.offline,
    );
  }

  Future<void> refreshWorkspace() async {
    if (state.session == null) {
      state = state.copyWith(status: DriverWorkspaceStatus.unauthenticated);
      return;
    }
    try {
      final current = await _repository.currentRide();
      if (current != null) {
        state = state.copyWith(
          status: DriverWorkspaceStatus.active,
          activeRide: current,
          offers: const [],
          availability: current.isTerminal
              ? DriverAvailability.offline
              : DriverAvailability.busy,
          clearMessage: true,
        );
        current.isTerminal ? _stopPolling() : _startPolling();
        return;
      }
      final offers = await _repository.offers();
      state = state.copyWith(
        status: DriverWorkspaceStatus.active,
        clearActiveRide: true,
        offers: offers,
        clearMessage: true,
      );
      _startPolling();
    } on DriverApiException catch (error) {
      _applyCapabilityError(error);
    } catch (_) {
      state = state.copyWith(
        status: DriverWorkspaceStatus.networkError,
        message: 'Koneksi belum stabil. Silakan coba lagi.',
      );
    }
  }

  Future<void> setAvailability(DriverAvailability availability) async {
    if (!_startFlight('availability')) return;
    state = state.copyWith(isBusy: true, clearMessage: true);
    try {
      final updated = await _repository.setAvailability(availability);
      state = state.copyWith(availability: updated);
      await refreshWorkspace();
    } on DriverApiException catch (error) {
      _applyCapabilityError(error);
    } finally {
      _endFlight('availability');
      state = state.copyWith(isBusy: false);
    }
  }

  void selectOffer(DriverRide ride) {
    state = state.copyWith(selectedOffer: ride);
  }

  void closeOffer() {
    state = state.copyWith(clearSelectedOffer: true);
  }

  Future<void> acceptSelectedOffer() async {
    final offer = state.selectedOffer;
    if (offer == null || offer.status != RideStatus.searchingDriver) return;
    if (!_startFlight('accept:${offer.reference}')) return;
    state = state.copyWith(isBusy: true, clearMessage: true);
    try {
      final ride = await _repository.accept(offer.reference);
      state = state.copyWith(
        activeRide: ride,
        clearSelectedOffer: true,
        offers: const [],
        availability: DriverAvailability.busy,
      );
      _startPolling();
    } on DriverApiException catch (error) {
      state = state.copyWith(message: error.message);
    } finally {
      _endFlight('accept:${offer.reference}');
      state = state.copyWith(isBusy: false);
    }
  }

  Future<void> rejectSelectedOffer() async {
    final offer = state.selectedOffer;
    if (offer == null) return;
    if (!_startFlight('reject:${offer.reference}')) return;
    state = state.copyWith(isBusy: true, clearMessage: true);
    try {
      await _repository.reject(offer.reference);
      state = state.copyWith(
        clearSelectedOffer: true,
        offers: state.offers
            .where((item) => item.reference != offer.reference)
            .toList(),
      );
    } on DriverApiException catch (error) {
      state = state.copyWith(message: error.message);
    } finally {
      _endFlight('reject:${offer.reference}');
      state = state.copyWith(isBusy: false);
    }
  }

  Future<void> advanceRide() async {
    final ride = state.activeRide;
    if (ride == null || ride.isTerminal) return;
    final action = _nextAction(ride.status);
    if (action == null || !_startFlight('${action.name}:${ride.reference}')) {
      return;
    }
    state = state.copyWith(isBusy: true, clearMessage: true);
    try {
      final updated = switch (action) {
        _TripAction.pickup => await _repository.pickup(ride.reference),
        _TripAction.arrived => await _repository.arrived(ride.reference),
        _TripAction.start => await _repository.start(ride.reference),
        _TripAction.complete => await _repository.complete(ride.reference),
      };
      state = state.copyWith(activeRide: updated);
      updated.isTerminal ? _stopPolling() : _startPolling();
    } on DriverApiException catch (error) {
      state = state.copyWith(message: error.message);
    } finally {
      _endFlight('${action.name}:${ride.reference}');
      state = state.copyWith(isBusy: false);
    }
  }

  Future<void> cancelRide() async {
    final ride = state.activeRide;
    if (ride == null || ride.isTerminal) return;
    if (!_startFlight('cancel:${ride.reference}')) return;
    state = state.copyWith(isBusy: true, clearMessage: true);
    try {
      final cancelled = await _repository.cancel(ride.reference, 'OTHER');
      state = state.copyWith(
          activeRide: cancelled, availability: DriverAvailability.offline);
      _stopPolling();
    } on DriverApiException catch (error) {
      state = state.copyWith(message: error.message);
    } finally {
      _endFlight('cancel:${ride.reference}');
      state = state.copyWith(isBusy: false);
    }
  }

  Future<void> sendLocationIfAvailable() async {
    if (!await _locationPort.isAvailable) {
      state = state.copyWith(message: 'Lokasi belum tersedia pada versi ini.');
      return;
    }
    await _locationPort.sendCurrentLocation();
  }

  void demoScenario(DriverScenario scenario) {
    if (_repository case final DemoDriverRepository demo) {
      demo.setScenario(scenario);
      state = state.copyWith(demoScenario: scenario);
      unawaited(restore());
    }
  }

  void _applyCapabilityError(DriverApiException error) {
    _stopPolling();
    final status = switch (error.code) {
      'RIDE_DRIVER_PROFILE_REQUIRED' => DriverWorkspaceStatus.profileRequired,
      'RIDE_DRIVER_NOT_ACTIVE' => DriverWorkspaceStatus.pending,
      'RIDE_DRIVER_ACCOUNT_INACTIVE' => DriverWorkspaceStatus.accountInactive,
      'AUTH_REQUIRED' => DriverWorkspaceStatus.sessionExpired,
      'RIDE_DRIVER_ACTIVE_RIDE_CONFLICT' => DriverWorkspaceStatus.networkError,
      _ => error.statusCode == 401
          ? DriverWorkspaceStatus.sessionExpired
          : DriverWorkspaceStatus.networkError,
    };
    state = state.copyWith(status: status, message: error.message);
  }

  void _startPolling() {
    if (state.activeRide?.isTerminal ?? false) return;
    _pollTimer ??= Timer.periodic(const Duration(seconds: 12), (_) => _poll());
    state = state.copyWith(isPolling: true);
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
    if (mounted) state = state.copyWith(isPolling: false);
  }

  Future<void> _poll() async {
    if (_polling || state.session == null || state.hasTerminalRide) return;
    _polling = true;
    try {
      await refreshWorkspace();
    } finally {
      _polling = false;
    }
  }

  bool _startFlight(String key) {
    if (_singleFlights.contains(key)) return false;
    _singleFlights.add(key);
    return true;
  }

  void _endFlight(String key) => _singleFlights.remove(key);

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      _stopPolling();
    }
    if (state == AppLifecycleState.resumed) {
      unawaited(refreshWorkspace());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopPolling();
    super.dispose();
  }
}

enum _TripAction { pickup, arrived, start, complete }

_TripAction? _nextAction(RideStatus status) {
  switch (status) {
    case RideStatus.driverAssigned:
      return _TripAction.pickup;
    case RideStatus.driverToPickup:
      return _TripAction.arrived;
    case RideStatus.driverArrived:
      return _TripAction.start;
    case RideStatus.inTrip:
      return _TripAction.complete;
    default:
      return null;
  }
}

class DriverShell extends ConsumerWidget {
  const DriverShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(driverControllerProvider);
    final controller = ref.read(driverControllerProvider.notifier);
    return Scaffold(
      appBar: AppBar(
        title: const Text('TapGo Driver'),
        actions: [
          if (state.isAuthenticated)
            IconButton(
              tooltip: 'Logout',
              onPressed: state.isBusy ? null : controller.logout,
              icon: const Icon(Icons.logout_rounded),
            ),
        ],
      ),
      body: SafeArea(
        child: Stack(
          children: [
            DriverOverlay(
              child: Padding(
                padding:
                    EdgeInsets.only(bottom: state.isAuthenticated ? 24 : 0),
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 220),
                  child: _bodyFor(state),
                ),
              ),
            ),
            if (kDriverDemoMode)
              const Positioned(top: 0, left: 0, right: 0, child: DemoBanner()),
          ],
        ),
      ),
      bottomNavigationBar: state.isAuthenticated
          ? NavigationBar(
              selectedIndex: 0,
              destinations: const [
                NavigationDestination(
                  icon: Icon(Icons.route_rounded),
                  label: 'Perjalanan',
                ),
                NavigationDestination(
                  icon: Icon(Icons.person_rounded),
                  label: 'Akun',
                ),
              ],
            )
          : null,
    );
  }

  Widget _bodyFor(DriverState state) {
    switch (state.status) {
      case DriverWorkspaceStatus.loading:
        return const LoadingScreen(key: ValueKey('loading'));
      case DriverWorkspaceStatus.unauthenticated:
        return const LoginScreen(key: ValueKey('login'));
      case DriverWorkspaceStatus.profileRequired:
        return CapabilityScreen(
          key: const ValueKey('profile-required'),
          title: 'Profil driver diperlukan',
          message:
              state.message ?? 'Akun ini belum memiliki profil driver aktif.',
          icon: Icons.badge_rounded,
        );
      case DriverWorkspaceStatus.pending:
        return CapabilityScreen(
          key: const ValueKey('pending'),
          title: 'Akun driver belum aktif',
          message: state.message ?? 'Pengajuan driver sedang ditinjau.',
          icon: Icons.hourglass_top_rounded,
        );
      case DriverWorkspaceStatus.suspended:
      case DriverWorkspaceStatus.rejected:
        return CapabilityScreen(
          key: const ValueKey('suspended'),
          title: 'Akses driver dihentikan',
          message: state.message ?? 'Akun driver belum dapat digunakan.',
          icon: Icons.block_rounded,
        );
      case DriverWorkspaceStatus.accountInactive:
        return CapabilityScreen(
          key: const ValueKey('account-inactive'),
          title: 'Akun tidak aktif',
          message: state.message ?? 'Hubungi dukungan TapGo.',
          icon: Icons.lock_rounded,
        );
      case DriverWorkspaceStatus.sessionExpired:
        return CapabilityScreen(
          key: const ValueKey('session-expired'),
          title: 'Sesi berakhir',
          message: state.message ?? 'Silakan login kembali.',
          icon: Icons.lock_clock_rounded,
          showLoginAction: true,
        );
      case DriverWorkspaceStatus.networkError:
        return CapabilityScreen(
          key: const ValueKey('network-error'),
          title: 'Koneksi belum stabil',
          message: state.message ?? 'Coba muat ulang beberapa saat lagi.',
          icon: Icons.wifi_off_rounded,
          showRetry: true,
        );
      case DriverWorkspaceStatus.active:
        return const DriverHomeScreen(key: ValueKey('home'));
    }
  }
}

class DemoBanner extends StatelessWidget {
  const DemoBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Demo data tidak terhubung backend atau provider',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        color: const Color(0xFFFFC857),
        child: const Text(
          'DEMO DATA — tidak terhubung backend/provider',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Color(0xFF061A2F),
            fontWeight: FontWeight.w800,
            fontSize: 12,
          ),
        ),
      ),
    );
  }
}

class LoadingScreen extends StatelessWidget {
  const LoadingScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return const Center(child: CircularProgressIndicator());
  }
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phone =
      TextEditingController(text: kDriverDemoMode ? '080000000000' : '');
  final _password =
      TextEditingController(text: kDriverDemoMode ? 'driver-demo' : '');

  @override
  void dispose() {
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(driverControllerProvider);
    final controller = ref.read(driverControllerProvider.notifier);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, kDriverDemoMode ? 56 : 28, 20, 20),
      children: [
        const _BrandHeader(
          title: 'Masuk Driver',
          subtitle: 'Kelola perjalanan aktif dengan akses yang terverifikasi.',
        ),
        const SizedBox(height: 24),
        TextField(
          key: const ValueKey('driver-phone-input'),
          controller: _phone,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
          decoration: const InputDecoration(
            labelText: 'Nomor HP',
            hintText: '08xxxxxxxxxx',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 14),
        TextField(
          key: const ValueKey('driver-password-input'),
          controller: _password,
          obscureText: true,
          autofillHints: const [AutofillHints.password],
          decoration: const InputDecoration(
            labelText: 'Password',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (_) => controller.login(_phone.text, _password.text),
        ),
        if (state.message != null) ...[
          const SizedBox(height: 12),
          ErrorNotice(message: state.message!),
        ],
        const SizedBox(height: 20),
        FilledButton(
          key: const ValueKey('driver-login-button'),
          onPressed: state.isBusy
              ? null
              : () => controller.login(_phone.text, _password.text),
          child: state.isBusy
              ? const SizedBox.square(
                  dimension: 22,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Login'),
        ),
        if (kDriverDemoMode) const DemoScenarioSelector(),
      ],
    );
  }
}

class DriverHomeScreen extends ConsumerWidget {
  const DriverHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(driverControllerProvider);
    final controller = ref.read(driverControllerProvider.notifier);
    final topPadding = kDriverDemoMode ? 52.0 : 20.0;
    return RefreshIndicator(
      onRefresh: controller.refreshWorkspace,
      child: ListView(
        padding: EdgeInsets.fromLTRB(16, topPadding, 16, 120),
        children: [
          _DriverStatusCard(state: state),
          const SizedBox(height: 16),
          if (state.message != null) ...[
            ErrorNotice(message: state.message!),
            const SizedBox(height: 12),
          ],
          if (state.activeRide != null)
            ActiveRideCard(ride: state.activeRide!)
          else ...[
            AvailabilityCard(state: state),
            const SizedBox(height: 16),
            _OfferSection(state: state),
          ],
          if (kDriverDemoMode) const DemoScenarioSelector(),
        ],
      ),
    );
  }
}

class _BrandHeader extends StatelessWidget {
  const _BrandHeader({required this.title, required this.subtitle});
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF061A2F), Color(0xFF0877E8)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.local_taxi_rounded,
              color: Color(0xFFFFC857), size: 44),
          const SizedBox(height: 18),
          Text(
            title,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
          ),
          const SizedBox(height: 8),
          Text(subtitle, style: const TextStyle(color: Colors.white70)),
        ],
      ),
    );
  }
}

class _DriverStatusCard extends ConsumerWidget {
  const _DriverStatusCard({required this.state});
  final DriverState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final name = state.session?.driverName ?? 'Driver TapGo';
    final status = switch (state.availability) {
      DriverAvailability.online => 'Online',
      DriverAvailability.busy => 'Dalam Perjalanan',
      DriverAvailability.offline => 'Offline',
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                        colors: [Color(0xFF00D4FF), Color(0xFF0877E8)]),
                  ),
                  child: const Icon(Icons.person_rounded, color: Colors.white),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 4),
                      Text('Status: $status'),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            StatusPill(
              label: status,
              active: state.availability != DriverAvailability.offline,
            ),
          ],
        ),
      ),
    );
  }
}

class AvailabilityCard extends ConsumerWidget {
  const AvailabilityCard({required this.state, super.key});
  final DriverState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(driverControllerProvider.notifier);
    final isOnline = state.availability == DriverAvailability.online;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Ketersediaan', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
              isOnline
                  ? 'Anda siap menerima perjalanan baru.'
                  : 'Aktifkan Online saat siap menerima perjalanan.',
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              key: const ValueKey('availability-toggle'),
              onPressed: state.isBusy
                  ? null
                  : () => controller.setAvailability(
                        isOnline
                            ? DriverAvailability.offline
                            : DriverAvailability.online,
                      ),
              icon: Icon(isOnline
                  ? Icons.pause_circle_rounded
                  : Icons.play_circle_rounded),
              label: Text(isOnline ? 'Ubah ke Offline' : 'Online Sekarang'),
            ),
          ],
        ),
      ),
    );
  }
}

class _OfferSection extends StatelessWidget {
  const _OfferSection({required this.state});
  final DriverState state;

  @override
  Widget build(BuildContext context) {
    if (state.offers.isEmpty) {
      return const EmptyStateCard(
        key: ValueKey('offer-empty'),
        icon: Icons.inbox_rounded,
        title: 'Belum ada tawaran',
        message:
            'Tawaran perjalanan akan muncul saat tersedia untuk kendaraan Anda.',
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Tawaran Perjalanan',
            style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        for (final offer in state.offers) OfferTile(ride: offer),
      ],
    );
  }
}

class OfferTile extends ConsumerWidget {
  const OfferTile({required this.ride, super.key});
  final DriverRide ride;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(driverControllerProvider.notifier);
    return Card(
      child: InkWell(
        key: ValueKey('offer-${ride.reference}'),
        borderRadius: BorderRadius.circular(24),
        onTap: () => controller.selectOffer(ride),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              const Icon(Icons.two_wheeler_rounded,
                  size: 36, color: Color(0xFF0877E8)),
              const SizedBox(width: 14),
              Expanded(child: _RideSummary(ride: ride)),
              const Icon(Icons.chevron_right_rounded),
            ],
          ),
        ),
      ),
    );
  }
}

class _RideSummary extends StatelessWidget {
  const _RideSummary({required this.ride});
  final DriverRide ride;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(_serviceLabel(ride.serviceType),
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text('${ride.pickupAddress} → ${ride.dropoffAddress}', maxLines: 3),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (ride.distanceMeters != null)
              InfoChip(label: _distance(ride.distanceMeters!)),
            if (ride.durationSeconds != null)
              InfoChip(label: _duration(ride.durationSeconds!)),
            if (ride.totalFare != null)
              InfoChip(label: _rupiah(ride.totalFare!)),
          ],
        ),
      ],
    );
  }
}

class ActiveRideCard extends ConsumerWidget {
  const ActiveRideCard({required this.ride, super.key});
  final DriverRide ride;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(driverControllerProvider);
    final controller = ref.read(driverControllerProvider.notifier);
    final action = _nextAction(ride.status);
    return Card(
      key: const ValueKey('active-ride-card'),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 12,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text('Perjalanan Aktif',
                    style: Theme.of(context).textTheme.titleLarge),
                StatusPill(
                  label: _statusLabel(ride.status),
                  active: !ride.isTerminal,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(ride.reference,
                style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 16),
            _TimelineStep(
              icon: Icons.my_location_rounded,
              title: 'Jemput',
              value: ride.pickupAddress,
            ),
            const SizedBox(height: 12),
            _TimelineStep(
              icon: Icons.flag_rounded,
              title: 'Tujuan',
              value: ride.dropoffAddress,
            ),
            const SizedBox(height: 16),
            _RideSummary(ride: ride),
            const SizedBox(height: 20),
            if (!ride.isTerminal && action != null)
              FilledButton(
                key: const ValueKey('trip-primary-action'),
                onPressed: state.isBusy ? null : controller.advanceRide,
                child: Text(_actionLabel(action)),
              ),
            if (!ride.isTerminal) ...[
              const SizedBox(height: 10),
              OutlinedButton(
                key: const ValueKey('trip-cancel-action'),
                onPressed: state.isBusy ? null : controller.cancelRide,
                child: const Text('Batalkan Perjalanan'),
              ),
            ],
            if (ride.isTerminal)
              const EmptyStateCard(
                key: ValueKey('terminal-ride-state'),
                icon: Icons.check_circle_rounded,
                title: 'Perjalanan selesai',
                message:
                    'Status perjalanan sudah final. Muat ulang untuk melihat tawaran berikutnya.',
              ),
          ],
        ),
      ),
    );
  }
}

class OfferDetailSheet extends ConsumerWidget {
  const OfferDetailSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(driverControllerProvider);
    final ride = state.selectedOffer;
    if (ride == null) return const SizedBox.shrink();
    final controller = ref.read(driverControllerProvider.notifier);
    return DraggableScrollableSheet(
      initialChildSize: 0.86,
      maxChildSize: 0.96,
      minChildSize: 0.55,
      builder: (context, scrollController) {
        return Material(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          clipBehavior: Clip.antiAlias,
          child: ListView(
            controller: scrollController,
            padding: const EdgeInsets.all(20),
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 5,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.outlineVariant,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text('Detail Tawaran',
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              _RideSummary(ride: ride),
              const SizedBox(height: 20),
              _TimelineStep(
                icon: Icons.my_location_rounded,
                title: 'Lokasi Jemput',
                value: ride.pickupAddress,
              ),
              const SizedBox(height: 12),
              _TimelineStep(
                icon: Icons.flag_rounded,
                title: 'Tujuan',
                value: ride.dropoffAddress,
              ),
              const SizedBox(height: 20),
              FilledButton(
                key: const ValueKey('accept-offer-button'),
                onPressed:
                    state.isBusy || ride.status != RideStatus.searchingDriver
                        ? null
                        : controller.acceptSelectedOffer,
                child: const Text('Terima Perjalanan'),
              ),
              const SizedBox(height: 10),
              OutlinedButton(
                key: const ValueKey('reject-offer-button'),
                onPressed: state.isBusy ? null : controller.rejectSelectedOffer,
                child: const Text('Tolak'),
              ),
              const SizedBox(height: 24),
            ],
          ),
        );
      },
    );
  }
}

class _TimelineStep extends StatelessWidget {
  const _TimelineStep(
      {required this.icon, required this.title, required this.value});
  final IconData icon;
  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 48,
          height: 48,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color:
                  Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(icon, color: Theme.of(context).colorScheme.primary),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(value),
            ],
          ),
        ),
      ],
    );
  }
}

class CapabilityScreen extends ConsumerWidget {
  const CapabilityScreen({
    required this.title,
    required this.message,
    required this.icon,
    this.showRetry = false,
    this.showLoginAction = false,
    super.key,
  });

  final String title;
  final String message;
  final IconData icon;
  final bool showRetry;
  final bool showLoginAction;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(driverControllerProvider.notifier);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, kDriverDemoMode ? 72 : 32, 20, 20),
      children: [
        EmptyStateCard(icon: icon, title: title, message: message),
        const SizedBox(height: 16),
        if (showRetry)
          FilledButton(
            key: const ValueKey('retry-button'),
            onPressed: controller.refreshWorkspace,
            child: const Text('Coba Lagi'),
          ),
        if (showLoginAction)
          FilledButton(
            key: const ValueKey('back-to-login-button'),
            onPressed: controller.logout,
            child: const Text('Login Kembali'),
          ),
        if (kDriverDemoMode) const DemoScenarioSelector(),
      ],
    );
  }
}

class EmptyStateCard extends StatelessWidget {
  const EmptyStateCard({
    required this.icon,
    required this.title,
    required this.message,
    super.key,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          children: [
            Icon(icon, size: 48, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 14),
            Text(title,
                style: Theme.of(context).textTheme.titleLarge,
                textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}

class ErrorNotice extends StatelessWidget {
  const ErrorNotice({required this.message, super.key});
  final String message;
  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.errorContainer,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          message,
          style:
              TextStyle(color: Theme.of(context).colorScheme.onErrorContainer),
        ),
      ),
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill({required this.label, required this.active, super.key});
  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: active
            ? const Color(0xFFDCFCE7)
            : Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: active
              ? const Color(0xFF166534)
              : Theme.of(context).colorScheme.onSurfaceVariant,
          fontWeight: FontWeight.w800,
          fontSize: 12,
        ),
      ),
    );
  }
}

class InfoChip extends StatelessWidget {
  const InfoChip({required this.label, super.key});
  final String label;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(label,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
    );
  }
}

class DemoScenarioSelector extends ConsumerWidget {
  const DemoScenarioSelector({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!kDriverDemoMode) return const SizedBox.shrink();
    final state = ref.watch(driverControllerProvider);
    final controller = ref.read(driverControllerProvider.notifier);
    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: DropdownButtonFormField<DriverScenario>(
        key: const ValueKey('demo-scenario-selector'),
        initialValue: state.demoScenario,
        isExpanded: true,
        decoration: const InputDecoration(
          labelText: 'Scenario demo',
          border: OutlineInputBorder(),
        ),
        items: [
          for (final scenario in DriverScenario.values)
            DropdownMenuItem(
                value: scenario, child: Text(_scenarioLabel(scenario))),
        ],
        onChanged: (value) {
          if (value != null) controller.demoScenario(value);
        },
      ),
    );
  }
}

String _scenarioLabel(DriverScenario value) {
  switch (value) {
    case DriverScenario.login:
      return 'Login';
    case DriverScenario.profileRequired:
      return 'Profile required';
    case DriverScenario.pending:
      return 'Pending';
    case DriverScenario.suspended:
      return 'Suspended';
    case DriverScenario.accountInactive:
      return 'Account inactive';
    case DriverScenario.homeOffline:
      return 'Home offline';
    case DriverScenario.homeOnline:
      return 'Home online';
    case DriverScenario.offerEmpty:
      return 'Offer empty';
    case DriverScenario.offerAvailable:
      return 'Offer tersedia';
    case DriverScenario.toPickup:
      return 'Menuju jemput';
    case DriverScenario.arrived:
      return 'Arrived';
    case DriverScenario.inTrip:
      return 'In trip';
    case DriverScenario.completed:
      return 'Completed';
    case DriverScenario.cancelled:
      return 'Cancelled';
    case DriverScenario.networkError:
      return 'Network error';
    case DriverScenario.sessionExpired:
      return 'Session expired';
  }
}

String _serviceLabel(String type) =>
    type == 'CAR' ? 'Ojek Mobil' : 'Ojek Motor';
String _distance(int meters) =>
    meters >= 1000 ? '${(meters / 1000).toStringAsFixed(1)} km' : '$meters m';
String _duration(int seconds) => '${(seconds / 60).ceil()} menit';
String _rupiah(int amount) {
  final raw = amount.toString();
  final buffer = StringBuffer();
  for (var i = 0; i < raw.length; i += 1) {
    final left = raw.length - i;
    buffer.write(raw[i]);
    if (left > 1 && left % 3 == 1) buffer.write('.');
  }
  return 'Rp$buffer';
}

String _statusLabel(RideStatus status) {
  switch (status) {
    case RideStatus.searchingDriver:
      return 'Mencari Driver';
    case RideStatus.driverAssigned:
      return 'Driver Ditugaskan';
    case RideStatus.driverToPickup:
      return 'Menuju Jemput';
    case RideStatus.driverArrived:
      return 'Tiba di Jemput';
    case RideStatus.inTrip:
      return 'Dalam Perjalanan';
    case RideStatus.completed:
      return 'Selesai';
    case RideStatus.cancelledByPassenger:
    case RideStatus.cancelledByDriver:
    case RideStatus.cancelledBySystem:
      return 'Dibatalkan';
    case RideStatus.expired:
      return 'Kedaluwarsa';
    case RideStatus.noDriver:
      return 'Tidak Ada Driver';
    case RideStatus.paymentFailed:
      return 'Pembayaran Gagal';
    case RideStatus.unknown:
      return 'Status Tidak Dikenal';
  }
}

String _actionLabel(_TripAction action) {
  switch (action) {
    case _TripAction.pickup:
      return 'Mulai Menuju Jemput';
    case _TripAction.arrived:
      return 'Saya Sudah Tiba';
    case _TripAction.start:
      return 'Mulai Perjalanan';
    case _TripAction.complete:
      return 'Selesaikan Perjalanan';
  }
}

class DriverOverlay extends ConsumerWidget {
  const DriverOverlay({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected =
        ref.watch(driverControllerProvider.select((s) => s.selectedOffer));
    return Stack(
      children: [
        child,
        if (selected != null) const OfferDetailSheet(),
      ],
    );
  }
}
