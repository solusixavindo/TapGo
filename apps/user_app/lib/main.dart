import 'dart:convert';
import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:image_picker/image_picker.dart';
import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import 'demo/client_flow_models.dart';

part 'data/demo_membership_data.dart';
part 'data/demo_admin_data.dart';
part 'data/demo_referral_tree_data.dart';
part 'data/demo_user_session.dart';
part 'data/demo_user_session_models.dart';
part 'screens/auth_screen.dart';
part 'screens/admin_broadcast_screen.dart';
part 'screens/admin_dashboard_screen.dart';
part 'screens/admin_member_detail_screen.dart';
part 'screens/admin_member_list_screen.dart';
part 'screens/admin_payment_screen.dart';
part 'screens/admin_referral_analytics_screen.dart';
part 'screens/admin_wallet_screen.dart';
part 'screens/admin_withdrawal_screen.dart';
part 'screens/checkout_screen.dart';
part 'screens/dashboard_screen.dart';
part 'screens/membership_registration_screen.dart';
part 'screens/membership_screen.dart';
part 'screens/payment_demo_screen.dart';
part 'screens/referral_tree_screen.dart';
part 'screens/splash_screen.dart';
part 'screens/success_screen.dart';
part 'services/persistent_demo_store.dart';
part 'services/tapgo_api_client.dart';
part 'widgets/benefit_item.dart';
part 'widgets/invoice_card.dart';
part 'widgets/package_card.dart';
part 'widgets/referral_tree_node_widget.dart';
part 'widgets/stat_card.dart';
part 'widgets/tapgo_button.dart';

const _brandBlue = Color(0xFF0569E8);
const _brandOrange = Color(0xFFFF8A00);
const _softBackground = Color(0xFFF4F8FB);
const _tapGoAppMode =
    String.fromEnvironment('TAPGO_APP_MODE', defaultValue: 'staging');
const _tapGoApiBaseUrl = String.fromEnvironment(
  'TAPGO_API_BASE_URL',
  defaultValue: 'https://api.tapgolion.id/api/v1',
);
const _isTapGoProductionBuild = _tapGoAppMode == 'production';
const _isTapGoUatBuild = _tapGoAppMode == 'staging';
const _isTapGoDevelopmentBuild = _tapGoAppMode == 'development';
const _isPaymentSimulatorEnabled = _isTapGoDevelopmentBuild || _isTapGoUatBuild;

final _persistentStore = _TapGoPersistentStore();
final _serverConfigStore = _TapGoServerConfigStore();
final _apiClient =
    _TapGoApiClient(baseUrl: _normalizeApiBaseUrl(_tapGoApiBaseUrl));
const _productionApiRootUrl = 'https://api.tapgolion.id';
const _productionFinalSyncResetKey =
    'tapgo.production.final_sync_cache_reset.v1';
const _tapgoApiEndpoints = [
  _TapGoEndpointCatalog.register,
  _TapGoEndpointCatalog.login,
  _TapGoEndpointCatalog.refresh,
  _TapGoEndpointCatalog.logout,
  _TapGoEndpointCatalog.me,
  _TapGoEndpointCatalog.membershipPlans,
  _TapGoEndpointCatalog.membershipMe,
  _TapGoEndpointCatalog.membershipUpgrade,
  _TapGoEndpointCatalog.membershipPackages,
  _TapGoEndpointCatalog.membershipOrders,
  _TapGoEndpointCatalog.membershipOrderPay,
  _TapGoEndpointCatalog.invoiceDetail,
  _TapGoEndpointCatalog.midtransNotification,
  _TapGoEndpointCatalog.referralSummary,
  _TapGoEndpointCatalog.referralTree,
  _TapGoEndpointCatalog.referralCommissions,
  _TapGoEndpointCatalog.wallet,
  _TapGoEndpointCatalog.walletTransactions,
  _TapGoEndpointCatalog.bankAccount,
  _TapGoEndpointCatalog.bankAccountUpdate,
  _TapGoEndpointCatalog.withdrawalRequest,
  _TapGoEndpointCatalog.withdrawalHistory,
  _TapGoEndpointCatalog.accountDeleteRequest,
  _TapGoEndpointCatalog.contactMessage,
  _TapGoEndpointCatalog.adminMemberRequests,
  _TapGoEndpointCatalog.adminBonusReport,
  _TapGoEndpointCatalog.adminPpobReport,
  _TapGoEndpointCatalog.adminRewardReport,
  _TapGoEndpointCatalog.adminWithdrawals,
  _TapGoEndpointCatalog.adminDashboardSummary,
  _TapGoEndpointCatalog.adminMembers,
  _TapGoEndpointCatalog.adminMemberDetail,
  _TapGoEndpointCatalog.adminPayments,
  _TapGoEndpointCatalog.adminInvoices,
  _TapGoEndpointCatalog.adminCommissions,
  _TapGoEndpointCatalog.adminCommissionSettings,
  _TapGoEndpointCatalog.adminWallets,
  _TapGoEndpointCatalog.adminWalletTransactions,
  _TapGoEndpointCatalog.adminApproveWithdrawal,
  _TapGoEndpointCatalog.adminRejectWithdrawal,
  _TapGoEndpointCatalog.adminPaidWithdrawal,
  _TapGoEndpointCatalog.adminProfitSharingPeriods,
  _TapGoEndpointCatalog.adminProfitSharingApprove,
  _TapGoEndpointCatalog.adminProfitSharingDistribute,
  _TapGoEndpointCatalog.adminRoleManagement,
  _TapGoEndpointCatalog.adminAppSettings,
  _TapGoEndpointCatalog.membershipPackageSettings,
];

bool tapGoDisablePersistenceForTests = false;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    if (_isTapGoProductionBuild) {
      await _prepareProductionFinalSync().timeout(
        const Duration(seconds: 3),
        onTimeout: () {
          debugPrint('[TapGo Startup] production cache reset timed out.');
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
    debugPrint('[TapGo Startup] init skipped: $error');
    if (_isTapGoProductionBuild) {
      _apiClient.setBaseUrl(_productionApiRootUrl);
    }
  }
  runApp(const ProviderScope(child: TapGoUserApp()));
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
    debugPrint('[TapGo Startup] server config reset skipped: $error');
  }
  try {
    await _persistentStore.clearProductionRuntimeCache().timeout(
          const Duration(seconds: 2),
        );
  } catch (error) {
    debugPrint('[TapGo Startup] secure cache reset skipped: $error');
  }
  try {
    await preferences.setBool(_productionFinalSyncResetKey, true).timeout(
          const Duration(seconds: 1),
        );
  } catch (error) {
    debugPrint('[TapGo Startup] reset marker write skipped: $error');
  }
}

class TapGoUserApp extends ConsumerWidget {
  const TapGoUserApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isAuthenticated = ref.watch(_isAuthenticatedProvider);

    return MaterialApp(
      title: 'TapGo',
      debugShowCheckedModeBanner: false,
      theme: _tapGoReadableTheme(),
      darkTheme: _tapGoReadableTheme(brightness: Brightness.dark),
      themeMode: ThemeMode.system,
      home: _SessionBootstrap(
        child:
            isAuthenticated ? const _RoleDashboardGate() : const SplashGate(),
      ),
    );
  }
}

ThemeData _tapGoReadableTheme({Brightness brightness = Brightness.light}) {
  final isDark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: _brandBlue,
    brightness: brightness,
  );
  final scaffoldBackground = isDark ? const Color(0xFF071525) : _softBackground;
  final surfaceColor = isDark ? const Color(0xFF0B1F35) : Colors.white;
  final inputFillColor = isDark ? const Color(0xFF102A44) : Colors.white;
  final inputBorderColor =
      isDark ? const Color(0xFF29445F) : const Color(0xFFEAF0F6);
  final inputTextColor =
      isDark ? const Color(0xFFEAF7FF) : const Color(0xFF172033);
  final inputHintColor =
      isDark ? const Color(0xFFA9B8C9) : const Color(0xFF94A3B8);

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

class _RoleDashboardGate extends ConsumerWidget {
  const _RoleDashboardGate();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(_demoSessionProvider);
    final dashboard = session.isSuperAdmin
        ? const SuperAdminDashboardScreen()
        : session.role == 'ADMIN'
            ? const AdminDashboardScreen()
            : const TapGoDashboard();

    return PopScope(
      canPop: false,
      child: dashboard,
    );
  }
}

class _AccessDeniedScreen extends StatelessWidget {
  const _AccessDeniedScreen();

  @override
  Widget build(BuildContext context) {
    return const _DemoScaffold(
      title: 'Akses Ditolak',
      subtitle: 'Role akun tidak memiliki izin untuk route ini.',
      child: _StatusSurface(
        icon: Icons.lock_rounded,
        title: 'Anda tidak memiliki akses admin.',
        subtitle: 'Silakan kembali ke dashboard akun Anda.',
      ),
    );
  }
}
