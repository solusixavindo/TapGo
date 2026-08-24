part of '../main.dart';

class _TapGoApiClient {
  _TapGoApiClient({
    Dio? dio,
    _TapGoDeviceContextStore? deviceContextStore,
    this.baseUrl = 'https://api.tapgolion.id/api/v1/',
  })  : _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: _normalizeApiBaseUrl(baseUrl),
                connectTimeout: const Duration(seconds: 8),
                receiveTimeout: const Duration(seconds: 12),
                headers: {'Accept': 'application/json'},
              ),
            ),
        _deviceContextStore = deviceContextStore ?? _TapGoDeviceContextStore() {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          try {
            final context = await _deviceContextStore.load().timeout(
                  const Duration(seconds: 1),
                );
            options.headers.addAll(context.headers);
          } catch (error) {
            _tapGoDebugLog('[TapGo Device] fingerprint skipped: $error');
            options.headers.addAll(_TapGoDeviceContextStore.fallbackHeaders);
          }
          handler.next(options);
        },
      ),
    );
  }

  final Dio _dio;
  final _TapGoDeviceContextStore _deviceContextStore;
  String baseUrl;

  String get rootUrl => _rootUrlFromApiBaseUrl(baseUrl);

  void setBaseUrl(String value) {
    baseUrl = _normalizeApiBaseUrl(value);
    _dio.options.baseUrl = baseUrl;
  }

  void setAccessToken(String? token) {
    if (token == null || token.isEmpty) {
      _dio.options.headers.remove('Authorization');
      return;
    }
    _dio.options.headers['Authorization'] = 'Bearer $token';
  }

  /// Menukar refresh token menjadi pasangan token baru (rotasi di server).
  /// Mengembalikan null bila refresh token kosong atau ditolak (dicabut /
  /// ganti password) — pemanggil lalu mengosongkan sesi untuk login ulang.
  /// Header Authorization sengaja dikosongkan: endpoint refresh hanya butuh
  /// refreshToken di body, dan mengirim access token kedaluwarsa bisa 401.
  Future<({String accessToken, String refreshToken})?> refreshSession(
      String refreshToken) async {
    if (refreshToken.isEmpty) return null;
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        _apiPath('auth/refresh'),
        data: {'refreshToken': refreshToken},
        options: Options(headers: const {'Authorization': null}),
      );
      final data = _unwrap(response.data);
      final access = '${data['accessToken'] ?? ''}';
      final refresh = '${data['refreshToken'] ?? ''}';
      if (access.isEmpty || refresh.isEmpty) return null;
      return (accessToken: access, refreshToken: refresh);
    } on DioException {
      return null;
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      _apiPath(path),
      data: body,
    );
    return _unwrap(response.data);
  }

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      _apiPath(path),
      queryParameters: query,
    );
    return _unwrap(response.data);
  }

  Future<Map<String, dynamic>> put(
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final response = await _dio.put<Map<String, dynamic>>(
      _apiPath(path),
      data: body,
    );
    return _unwrap(response.data);
  }

  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final response = await _dio.patch<Map<String, dynamic>>(
      _apiPath(path),
      data: body,
    );
    return _unwrap(response.data);
  }

  Future<_TapGoAuthResult> register({
    required String name,
    required String phone,
    required String password,
    String? referralCode,
  }) async {
    final deviceContext = await _deviceContextStore.load().timeout(
          const Duration(seconds: 1),
          onTimeout: _TapGoDeviceContextStore.fallbackContext,
        );
    final body = {
      'name': name,
      'fullName': name,
      'phone': _normalizePhone(phone),
      'password': password,
      'deviceId': deviceContext.deviceId,
      'deviceFingerprint': deviceContext.deviceFingerprint,
      if (referralCode != null && referralCode.trim().isNotEmpty)
        'referralCode': referralCode.trim().toUpperCase(),
    };
    final safeBody = {...body, 'password': '***'};
    final registerUrl = _fullApiUrl('auth/register');
    _tapGoDebugLog('ACTIVE ROOT URL: $rootUrl');
    _tapGoDebugLog('REGISTER URL: $registerUrl');
    _tapGoDebugLog('REGISTER PAYLOAD: $safeBody');
    try {
      final response = await _dio.post<dynamic>(
        _apiPath('auth/register'),
        data: body,
      );
      _tapGoDebugLog('REGISTER RESPONSE STATUS: ${response.statusCode}');
      _tapGoDebugLog('REGISTER RESPONSE: <redacted>');
      return _TapGoAuthResult.fromMap(_unwrapDynamic(response.data));
    } on DioException catch (error) {
      _tapGoDebugLog('REGISTER ERROR: ${error.message}');
      _tapGoDebugLog('REGISTER ERROR STATUS: ${error.response?.statusCode}');
      _tapGoDebugLog('REGISTER ERROR BODY: <redacted>');
      rethrow;
    }
  }

  Future<_TapGoAuthResult> login({
    required String phone,
    required String password,
  }) async {
    final body = {'phone': _normalizePhone(phone), 'password': password};
    final safeBody = {...body, 'password': '***'};
    final loginUrl = _fullApiUrl('auth/login');
    _tapGoDebugLog('ACTIVE ROOT URL: $rootUrl');
    _tapGoDebugLog('LOGIN URL: $loginUrl');
    _tapGoDebugLog('LOGIN PAYLOAD: $safeBody');
    try {
      final response = await _dio.post<dynamic>(
        _apiPath('auth/login'),
        data: body,
      );
      _tapGoDebugLog('LOGIN RESPONSE STATUS: ${response.statusCode}');
      _tapGoDebugLog('LOGIN RESPONSE: <redacted>');
      return _TapGoAuthResult.fromMap(_unwrapDynamic(response.data));
    } on DioException catch (error) {
      _tapGoDebugLog('LOGIN ERROR: ${error.message}');
      _tapGoDebugLog('LOGIN ERROR STATUS: ${error.response?.statusCode}');
      _tapGoDebugLog('LOGIN ERROR BODY: <redacted>');
      rethrow;
    }
  }

  // --- Ojek Online penumpang ------------------------------------------------
  // Memakai kontrak backend yang sudah ada tanpa menambah endpoint maupun
  // field. Idempotency-Key dikirim sebagai header sesuai kontrak, dan nilainya
  // dibuat pemanggil agar tetap stabil saat percobaan ulang.

  Future<Map<String, dynamic>> createRideQuote({
    required String serviceType,
    required Map<String, dynamic> pickup,
    required Map<String, dynamic> dropoff,
    String? idempotencyKey,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      _apiPath('rides/quotes'),
      data: {
        'serviceType': serviceType,
        'pickup': pickup,
        'dropoff': dropoff,
      },
      options: idempotencyKey == null
          ? null
          : Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
    return _unwrap(response.data);
  }

  Future<Map<String, dynamic>> createRideOrder({
    required String quoteId,
    String? idempotencyKey,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      _apiPath('rides'),
      // CASH sesuai kontrak tahap ini. DIGITAL tidak pernah dikirim.
      data: {'quoteId': quoteId, 'paymentMethod': 'CASH'},
      options: idempotencyKey == null
          ? null
          : Options(headers: {'Idempotency-Key': idempotencyKey}),
    );
    return _unwrap(response.data);
  }

  Future<Map<String, dynamic>> rideDetail(String reference) {
    return get('rides/$reference');
  }

  Future<List<Map<String, dynamic>>> rideHistory({int limit = 20}) async {
    final response = await _dio.get<dynamic>(
      _apiPath('rides'),
      queryParameters: {'limit': limit},
    );
    // Backend menjawab { success, data: [...] }. _unwrap membungkus payload
    // non-map menjadi {'items': payload}, jadi daftar berada di 'items'.
    final payload = _unwrapDynamic(response.data)['items'];
    if (payload is! List) {
      return const [];
    }
    return payload
        .whereType<Map>()
        .map((row) => row.cast<String, dynamic>())
        .toList();
  }

  Future<Map<String, dynamic>> cancelRide({
    required String reference,
    required String reasonCode,
    String? note,
  }) {
    return post('rides/$reference/cancel', body: {
      'reason': reasonCode,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    });
  }

  // --- Pemulihan password ---------------------------------------------------
  // Tidak ada satu pun method di bawah yang menulis identifier, OTP, reset
  // token, atau password ke log. Backend selalu menjawab permintaan pemulihan
  // dengan pesan generik yang sama, sehingga aplikasi tidak pernah mengetahui
  // apakah sebuah akun terdaftar.

  Future<String> requestPasswordRecovery(String identifier) async {
    final data = await post(
      'auth/recovery/request',
      body: {'identifier': _normalizeRecoveryIdentifier(identifier)},
    );
    return (data['message'] as String?) ??
        'Jika akun ditemukan, instruksi pemulihan telah dikirim.';
  }

  /// Mengembalikan reset token sekali pakai beserta tujuan tersamarkan.
  Future<Map<String, String>> verifyPasswordRecovery({
    required String identifier,
    required String code,
  }) async {
    final data = await post(
      'auth/recovery/verify',
      body: {
        'identifier': _normalizeRecoveryIdentifier(identifier),
        'code': code,
      },
    );
    return {
      'resetToken': (data['resetToken'] as String?) ?? '',
      'maskedDestination': (data['maskedDestination'] as String?) ?? '',
    };
  }

  Future<void> resetPassword({
    required String resetToken,
    required String newPassword,
  }) async {
    await post(
      'auth/recovery/reset',
      body: {'resetToken': resetToken, 'newPassword': newPassword},
    );
  }

  // --- Verifikasi kontak ------------------------------------------------------

  Future<Map<String, dynamic>> verificationStatus() {
    return get('auth/verification/status');
  }

  Future<Map<String, dynamic>> requestContactVerification(String channel) {
    return post('auth/verification/request', body: {'channel': channel});
  }

  Future<Map<String, dynamic>> confirmContactVerification({
    required String channel,
    required String code,
  }) {
    return post(
      'auth/verification/confirm',
      body: {'channel': channel, 'code': code},
    );
  }

  /// Email dibiarkan apa adanya (hanya di-trim/lowercase); nomor telepon
  /// dinormalisasi memakai aturan yang sama dengan login.
  String _normalizeRecoveryIdentifier(String value) {
    final trimmed = value.trim();
    if (trimmed.contains('@')) {
      return trimmed.toLowerCase();
    }
    return _normalizePhone(trimmed);
  }

  Future<_TapGoHealthCheckResult> testConnection({
    String? baseUrlOverride,
  }) async {
    final normalized = _normalizeApiBaseUrl(baseUrlOverride ?? baseUrl);
    final healthUrl = _healthUrlFromApiBaseUrl(normalized);
    _tapGoDebugLog('ACTIVE ROOT URL: ${_rootUrlFromApiBaseUrl(normalized)}');
    _tapGoDebugLog('HEALTH URL: $healthUrl');
    final response = await Dio(
      BaseOptions(
        connectTimeout: const Duration(seconds: 8),
        receiveTimeout: const Duration(seconds: 10),
        headers: {'Accept': 'application/json'},
      ),
    ).get<Map<String, dynamic>>(healthUrl);
    final data = response.data;
    _tapGoDebugLog('HEALTH RESPONSE STATUS: ${response.statusCode}');
    _tapGoDebugLog('HEALTH RESPONSE BODY: <redacted>');
    if (response.statusCode != 200 ||
        data?['success'] != true ||
        data?['status'] != 'ok') {
      throw DioException(
        requestOptions: response.requestOptions,
        response: response,
        type: DioExceptionType.badResponse,
        message: 'Health check TapGo tidak valid.',
      );
    }
    return _TapGoHealthCheckResult(
      url: healthUrl,
      statusCode: response.statusCode ?? 0,
      message: data?['status']?.toString() ?? 'ok',
    );
  }

  Future<Map<String, dynamic>> claimReferral(String referralCode) {
    return post(
      '/referrals/claim',
      body: {
        'sponsorCode': referralCode.trim().toUpperCase(),
        'triggerType': 'REFERRAL_JOIN',
        'triggerId': 'register:${DateTime.now().millisecondsSinceEpoch}',
        'baseAmount': 0,
      },
    );
  }

  Future<_TapGoAuthUser> me() async {
    final response = await _dio.get<Map<String, dynamic>>(_apiPath('auth/me'));
    _tapGoDebugLog(
      '[TapGo Auth] auth/me response status: ${response.statusCode}',
    );
    return _TapGoAuthUser.fromMap(_unwrap(response.data));
  }

  Future<_TapGoProductionSnapshot> productionSnapshot() async {
    if (tapGoIsPlayDistribution) {
      final membership = await _productionSnapshotPart(
        'membership',
        () => get('/membership/me'),
      );
      return _TapGoProductionSnapshot.fromMaps(
        membership: membership,
        wallet: const {},
        transactions: const {'items': []},
        referralSummary: const {},
        referralTree: const {},
        commissions: const {'items': []},
      );
    }

    final responses = await Future.wait([
      _productionSnapshotPart('membership', () => get('/membership/me')),
      _productionSnapshotPart('wallet', _walletForSnapshot, requiredPart: true),
      _productionSnapshotPart(
        'wallet transactions',
        () => get('/wallet/transactions', query: {'page': 1, 'pageSize': 20}),
      ),
      _productionSnapshotPart(
        'referral summary',
        () => get('/referrals/summary'),
      ),
      _productionSnapshotPart(
        'referal tim',
        () => get(
          '/referrals/downlines',
          query: {'maxLevel': 10, 'page': 1, 'pageSize': 100},
        ),
      ),
      _productionSnapshotPart(
        'referral commissions',
        () => get('/referrals/commissions', query: {'page': 1, 'pageSize': 50}),
      ),
    ]);

    return _TapGoProductionSnapshot.fromMaps(
      membership: responses[0],
      wallet: responses[1],
      transactions: responses[2],
      referralSummary: responses[3],
      referralTree: responses[4],
      commissions: responses[5],
    );
  }

  Future<Map<String, dynamic>> _walletForSnapshot() async {
    final walletUrl = _fullApiUrl('wallet');
    _tapGoDebugLog('ACTIVE API BASE URL: $baseUrl');
    _tapGoDebugLog('WALLET URL: $walletUrl');
    _tapGoDebugLog(
      'AUTH TOKEN EXISTS: ${_dio.options.headers['Authorization'] != null}',
    );
    try {
      final response = await _dio.get<dynamic>(_apiPath('wallet'));
      _tapGoDebugLog('WALLET RESPONSE STATUS: ${response.statusCode}');
      _tapGoDebugLog('WALLET RESPONSE BODY: <redacted>');
      return _unwrapDynamic(response.data);
    } on DioException catch (error) {
      _tapGoDebugLog('WALLET ERROR: ${error.message}');
      _tapGoDebugLog('WALLET ERROR STATUS: ${error.response?.statusCode}');
      _tapGoDebugLog('WALLET ERROR BODY: <redacted>');
      rethrow;
    }
  }

  Future<List<Map<String, dynamic>>> membershipPackages() async {
    final data = await get('/membership/packages');
    return _items(data);
  }

  Future<Map<String, dynamic>> createMembershipOrder({
    required String packageId,
    required Map<String, dynamic> registrationData,
  }) {
    return post(
      '/membership/orders',
      body: {'packageId': packageId, 'registrationData': registrationData},
    );
  }

  Future<_TapGoPaymentIntent> payMembershipOrder(String orderId) async {
    final data = await post('/membership/orders/$orderId/pay');
    return _TapGoPaymentIntent.fromMap(data);
  }

  Future<Map<String, dynamic>> membershipOrder(String orderId) {
    return get('/membership/orders/$orderId');
  }

  Future<List<Map<String, dynamic>>> membershipOrders() async {
    final data = await get('/membership/orders/me');
    return _items(data);
  }

  Future<Map<String, dynamic>> invoice(String invoiceIdOrNumber) {
    return get('/invoices/$invoiceIdOrNumber');
  }

  Future<List<Map<String, dynamic>>> adminWithdrawals() async {
    final data = await get(
      '/admin/withdrawals',
      query: {'page': 1, 'pageSize': 50},
    );
    return _items(data);
  }

  Future<List<Map<String, dynamic>>> withdrawals() async {
    final data = await get(
      '/wallet/withdrawals',
      query: {'page': 1, 'pageSize': 50},
    );
    return _items(data);
  }

  Future<Map<String, dynamic>> bankAccount() {
    return get('/wallet/bank-account');
  }

  Future<Map<String, dynamic>> updateBankAccount({
    required String bankName,
    String? bankCode,
    required String accountNumber,
    required String accountHolderName,
  }) {
    return put(
      '/wallet/bank-account',
      body: {
        'bankName': bankName,
        if (bankCode != null && bankCode.isNotEmpty) 'bankCode': bankCode,
        'accountNumber': accountNumber,
        'accountHolderName': accountHolderName,
      },
    );
  }

  Future<Map<String, dynamic>> requestWithdrawal({
    required int amount,
    required String bankName,
    String? bankCode,
    required String accountNumber,
    required String accountHolderName,
  }) {
    return post(
      '/wallet/withdrawals',
      body: {
        'amount': amount,
        'bankName': bankName,
        if (bankCode != null && bankCode.isNotEmpty) 'bankCode': bankCode,
        'accountNumber': accountNumber,
        'accountHolderName': accountHolderName,
      },
    );
  }

  Future<Map<String, dynamic>> accountDeletionRequest() {
    return get('/account/delete-request');
  }

  Future<Map<String, dynamic>> submitAccountDeletionRequest({String? reason}) {
    return post(
      '/account/delete-request',
      body: {
        if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
      },
    );
  }

  Future<Map<String, dynamic>> submitContactMessage({
    required String name,
    required String contact,
    required String category,
    required String message,
  }) {
    return post(
      '/contact',
      body: {
        'name': name,
        'contact': contact,
        'category': category,
        'message': message,
      },
    );
  }

  Future<Map<String, dynamic>> memberIdentity() {
    return get('/member-identity/me');
  }

  Future<List<Map<String, dynamic>>> supportTickets() async {
    final data = await get('/support/tickets');
    return _items(data);
  }

  Future<Map<String, dynamic>> supportTicketDetail(String ticketId) {
    return get('/support/tickets/$ticketId');
  }

  Future<Map<String, dynamic>> createSupportTicket({
    required String category,
    required String subject,
    required String message,
  }) {
    return post(
      '/support/tickets',
      body: {'category': category, 'subject': subject, 'message': message},
    );
  }

  Future<List<Map<String, dynamic>>> adminProfitSharingPeriods() async {
    final data = await get('/admin/profit-sharing/periods');
    return _items(data);
  }

  Future<List<Map<String, dynamic>>> referralUplink() async {
    final data = await get('/referrals/uplink', query: {'maxLevel': 10});
    return _items(data);
  }

  Future<List<Map<String, dynamic>>> membershipOrdersMe() async {
    final data = await get('/membership/orders/me');
    return _items(data);
  }

  Future<Map<String, dynamic>> adminDashboardSummary() {
    return get('/admin/dashboard/summary');
  }

  Future<List<Map<String, dynamic>>> adminMembers() async {
    final data = await get(
      '/admin/members',
      query: {'page': 1, 'pageSize': 50},
    );
    return _items(data);
  }

  Future<List<Map<String, dynamic>>> adminPayments() async {
    final data = await get(
      '/admin/payments',
      query: {'page': 1, 'pageSize': 50},
    );
    return _items(data);
  }

  Future<List<Map<String, dynamic>>> adminInvoices() async {
    final data = await get(
      '/admin/invoices',
      query: {'page': 1, 'pageSize': 50},
    );
    return _items(data);
  }

  Future<List<Map<String, dynamic>>> adminCommissions() async {
    final data = await get(
      '/admin/commissions',
      query: {'page': 1, 'pageSize': 50},
    );
    return _items(data);
  }

  Future<Map<String, dynamic>> adminFounderPlatinum() {
    return get('/admin/founder-platinum');
  }

  Future<Map<String, dynamic>> adminFounderChairman() {
    return get('/admin/founder-chairman');
  }

  Future<Map<String, dynamic>> adminFounderPlatinumDetail(String founderId) {
    return get('/admin/founder-platinum/$founderId');
  }

  Future<Map<String, dynamic>> adminFounderChairmanDetail(String founderId) {
    return get('/admin/founder-chairman/$founderId');
  }

  Future<Map<String, dynamic>> updateFounderPlatinumStatus({
    required String founderId,
    required String status,
    String? reason,
  }) {
    return patch(
      '/admin/founder-platinum/$founderId/status',
      body: {
        'status': status,
        if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
      },
    );
  }

  Future<Map<String, dynamic>> updateFounderChairmanStatus({
    required String founderId,
    required String status,
    String? reason,
  }) {
    return patch(
      '/admin/founder-chairman/$founderId/status',
      body: {
        'status': status,
        if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
      },
    );
  }

  Future<List<Map<String, dynamic>>> adminMemberRequests() async {
    final data = await get(
      '/admin/member-requests',
      query: {'page': 1, 'pageSize': 50},
    );
    return _items(data);
  }

  Future<Map<String, dynamic>> approveMemberRequest(String id) {
    return post('/admin/member-requests/$id/approve');
  }

  Future<Map<String, dynamic>> rejectMemberRequest(
    String id, {
    String? reason,
  }) {
    return post(
      '/admin/member-requests/$id/reject',
      body: {
        if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
      },
    );
  }

  Future<Map<String, dynamic>> adminBonusReport({Map<String, dynamic>? query}) {
    return get(
      '/admin/reports/bonus',
      query: {'page': 1, 'pageSize': 50, ...?query},
    );
  }

  Future<Map<String, dynamic>> adminPpobReport({Map<String, dynamic>? query}) {
    return get(
      '/admin/reports/ppob',
      query: {'page': 1, 'pageSize': 50, ...?query},
    );
  }

  Future<Map<String, dynamic>> adminRewardReport({
    Map<String, dynamic>? query,
  }) {
    return get(
      '/admin/reports/reward',
      query: {'page': 1, 'pageSize': 50, ...?query},
    );
  }

  Future<List<Map<String, dynamic>>> adminDeleteRequests() async {
    final data = await get(
      '/admin/delete-requests',
      query: {'page': 1, 'pageSize': 50},
    );
    return _items(data);
  }

  Future<List<Map<String, dynamic>>> adminContactMessages() async {
    final data = await get(
      '/admin/contact-messages',
      query: {'page': 1, 'pageSize': 50},
    );
    return _items(data);
  }

  Future<List<Map<String, dynamic>>> adminWallets() async {
    final data = await get(
      '/admin/wallets',
      query: {'page': 1, 'pageSize': 50},
    );
    return _items(data);
  }

  Future<Map<String, dynamic>> approveWithdrawal(String id) {
    return post('/admin/withdrawals/$id/approve');
  }

  Future<Map<String, dynamic>> rejectWithdrawal(String id) {
    return post('/admin/withdrawals/$id/reject');
  }

  Future<Map<String, dynamic>> markWithdrawalPaid(String id) {
    return post('/admin/withdrawals/$id/paid');
  }

  Map<String, dynamic> _unwrap(Map<String, dynamic>? data) {
    if (data == null) {
      return {};
    }
    final payload = data['data'];
    if (payload is Map<String, dynamic>) {
      return payload;
    }
    return {'items': payload};
  }

  Map<String, dynamic> _unwrapDynamic(Object? data) {
    if (data is Map<String, dynamic>) {
      return _unwrap(data);
    }
    if (data is Map) {
      return _unwrap(data.cast<String, dynamic>());
    }
    return {};
  }

  String _apiPath(String path) {
    return path.startsWith('/') ? path.substring(1) : path;
  }

  String _fullApiUrl(String path) {
    return '${baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl}/${_apiPath(path)}';
  }

  List<Map<String, dynamic>> _items(Map<String, dynamic> data) {
    final items = data['items'];
    if (items is List) {
      return items
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList();
    }
    return const [];
  }
}

class _TapGoDeviceContext {
  const _TapGoDeviceContext({
    required this.deviceId,
    required this.deviceFingerprint,
    required this.appVersion,
    required this.platform,
  });

  final String deviceId;
  final String deviceFingerprint;
  final String appVersion;
  final String platform;

  Map<String, String> get headers => {
        'X-TapGo-Device-Id': deviceId,
        'X-TapGo-Device-Fingerprint': deviceFingerprint,
        'X-TapGo-App-Version': appVersion,
        'X-TapGo-Platform': platform,
      };
}

class _TapGoDeviceContextStore {
  _TapGoDeviceContextStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  static const _deviceIdKey = 'tapgo.device_id.v1';
  static const _deviceFingerprintKey = 'tapgo.device_fingerprint.v1';
  static const _appVersion = '1.0.3+4';

  static _TapGoDeviceContext fallbackContext() => _TapGoDeviceContext(
        deviceId: 'tapgo-session-${DateTime.now().millisecondsSinceEpoch}',
        deviceFingerprint:
            'tapgo:${Platform.operatingSystem}:session-unavailable',
        appVersion: _appVersion,
        platform: Platform.operatingSystem,
      );

  static Map<String, String> get fallbackHeaders => {
        'X-TapGo-App-Version': _appVersion,
        'X-TapGo-Platform': Platform.operatingSystem,
      };

  final FlutterSecureStorage _storage;
  final Map<String, String> _memoryCache = {};

  Future<_TapGoDeviceContext> load() async {
    if (tapGoDisablePersistenceForTests) {
      return const _TapGoDeviceContext(
        deviceId: 'tapgo-test-installation',
        deviceFingerprint: 'tapgo-test-fingerprint',
        appVersion: _appVersion,
        platform: 'test',
      );
    }

    final deviceId = await _readOrCreate(_deviceIdKey, _newDeviceId);
    final fingerprint = await _readOrCreate(
      _deviceFingerprintKey,
      () => 'tapgo:${Platform.operatingSystem}:$deviceId',
    );
    return _TapGoDeviceContext(
      deviceId: deviceId,
      deviceFingerprint: fingerprint,
      appVersion: _appVersion,
      platform: Platform.operatingSystem,
    );
  }

  Future<String> _readOrCreate(String key, String Function() create) async {
    final memoryValue = _memoryCache[key];
    if (memoryValue != null && memoryValue.trim().isNotEmpty) {
      return memoryValue;
    }
    String? saved;
    try {
      saved = await _storage
          .read(key: key)
          .timeout(const Duration(milliseconds: 700));
    } catch (error) {
      _tapGoDebugLog('[TapGo Device] secure read skipped for $key: $error');
    }
    if (saved != null && saved.trim().isNotEmpty) {
      _memoryCache[key] = saved;
      return saved;
    }
    final value = create();
    _memoryCache[key] = value;
    try {
      await _storage
          .write(key: key, value: value)
          .timeout(const Duration(milliseconds: 700));
    } catch (error) {
      _tapGoDebugLog('[TapGo Device] secure write skipped for $key: $error');
    }
    return value;
  }

  String _newDeviceId() {
    final random = Random.secure();
    final bytes = List<int>.generate(24, (_) => random.nextInt(256));
    return 'tapgo-${base64UrlEncode(bytes).replaceAll('=', '')}';
  }
}

class _TapGoProductionSnapshot {
  const _TapGoProductionSnapshot({
    required this.sessionPatch,
    required this.referralTree,
    required this.commissionTransactions,
    required this.loadedAt,
  });

  final DemoClientSession sessionPatch;
  final DemoReferralNode? referralTree;
  final List<WalletTransactionModel> commissionTransactions;
  final DateTime loadedAt;

  factory _TapGoProductionSnapshot.fromMaps({
    required Map<String, dynamic> membership,
    required Map<String, dynamic> wallet,
    required Map<String, dynamic> transactions,
    required Map<String, dynamic> referralSummary,
    required Map<String, dynamic> referralTree,
    required Map<String, dynamic> commissions,
  }) {
    final membershipData =
        (membership['membership'] as Map?)?.cast<String, dynamic>();
    final packageData =
        (membershipData?['membership'] as Map?)?.cast<String, dynamic>();
    final orderData =
        (membershipData?['order'] as Map?)?.cast<String, dynamic>();
    final invoiceData =
        (orderData?['invoice'] as Map?)?.cast<String, dynamic>();
    final membershipMetadata =
        (membershipData?['metadata'] as Map?)?.cast<String, dynamic>();
    final walletBalance = _intFrom(wallet['balance']);
    final txItems = _listFromPayload(
      transactions,
    ).map(_walletTransactionFromApi).toList(growable: false);
    final commissionItems = _listFromPayload(commissions);
    final commissionLedgerItems = commissionItems
        .map(_commissionTransactionFromApi)
        .toList(growable: false);
    final directSponsor = _intFrom(
      referralSummary['directDownlines'] ?? referralSummary['directSponsor'],
    );
    final totalDownline = _intFrom(
      referralSummary['totalDownlines'] ?? referralSummary['totalDownline'],
    );
    final activePackageName = _titleCase(
      packageData?['tier']?.toString() ??
          packageData?['name']?.toString() ??
          'Basic',
    );
    final ppobBalance = _intFrom(packageData?['ppobBalance']);
    final todayBonus = _todayBonusFrom(commissionItems);
    final founderRole = (membershipData?['founderRole'] ??
            membershipMetadata?['founderRole'] ??
            membershipData?['founderProgramRole'])
        ?.toString()
        .toUpperCase();
    final isFounderChairman = founderRole == 'FOUNDER_CHAIRMAN';
    final isFounderPlatinum = founderRole == 'FOUNDER_PLATINUM';

    return _TapGoProductionSnapshot(
      sessionPatch: DemoClientSession.initial().copyWith(
        activePackageName: activePackageName,
        isFounderChairman: isFounderChairman,
        isFounderPlatinum: isFounderPlatinum,
        walletBalance: walletBalance,
        ppobBalance: ppobBalance,
        directSponsor: directSponsor,
        downline: totalDownline,
        activeLevel: _activeLevelFromDirectSponsor(directSponsor),
        todayBonus: todayBonus,
        lastInvoiceNumber: invoiceData?['number']?.toString(),
        membershipJoinedAt: _dateLabel(membershipData?['activeAt']),
        transactions: txItems,
      ),
      referralTree: _referralTreeFromApi(referralTree),
      commissionTransactions: commissionLedgerItems,
      loadedAt: DateTime.now(),
    );
  }
}

/// Menyalakan fixture visual dashboard.
///
/// HANYA dipakai harness bukti visual. Nilainya default false dan tidak ada
/// satu pun jalur produksi yang menyetelnya, sehingga aplikasi yang dirilis
/// selalu memakai data server yang sebenarnya.
///
/// Tanpa fixture, tangkapan layar dashboard di lingkungan test menampilkan
/// "Data belum tersedia" dan "Gagal memuat data" — state gagal muat yang bukan
/// bagian dari apa yang ingin ditinjau.
bool tapGoDashboardVisualFixtureEnabled = false;

/// Label kejujuran yang wajib tampil saat fixture aktif.
const String tapGoDashboardFixtureLabel = 'DEMO DATA';

/// Snapshot tetap untuk fixture visual.
///
/// Dibangun lewat `fromMaps` yang sama dengan jalur produksi, sehingga yang
/// dipalsukan hanya sumber datanya — bukan cara aplikasi mengurainya.
_TapGoProductionSnapshot _tapGoDashboardVisualSnapshot() {
  return _TapGoProductionSnapshot.fromMaps(
    membership: const {
      'membership': {
        'membership': {'name': 'Basic', 'ppobBalance': 0},
        'activeAt': '2026-01-15T00:00:00.000Z',
        'order': {
          'invoice': {'number': 'INV-DEMO-0001'},
        },
      },
    },
    wallet: const {'balance': 125000},
    transactions: const {'items': <Map<String, dynamic>>[]},
    referralSummary: const {'directDownlines': 3, 'totalDownlines': 8},
    referralTree: const {},
    commissions: const {'items': <Map<String, dynamic>>[]},
  );
}

final _productionSnapshotProvider = FutureProvider<_TapGoProductionSnapshot>((
  ref,
) async {
  if (tapGoDashboardVisualFixtureEnabled) {
    return _tapGoDashboardVisualSnapshot();
  }
  final session = ref.read(_demoSessionProvider);
  if (session.accessToken == null || session.accessToken!.isEmpty) {
    throw StateError('Belum ada token backend.');
  }
  _apiClient.setAccessToken(session.accessToken);
  final snapshot = await _apiClient.productionSnapshot();
  final patched = session.copyWith(
    activePackageName: snapshot.sessionPatch.activePackageName,
    walletBalance: snapshot.sessionPatch.walletBalance,
    ppobBalance: snapshot.sessionPatch.ppobBalance,
    isFounderPlatinum: snapshot.sessionPatch.isFounderPlatinum,
    isFounderChairman: snapshot.sessionPatch.isFounderChairman,
    directSponsor: snapshot.sessionPatch.directSponsor,
    downline: snapshot.sessionPatch.downline,
    activeLevel: snapshot.sessionPatch.activeLevel,
    todayBonus: snapshot.sessionPatch.todayBonus,
    lastInvoiceNumber: snapshot.sessionPatch.lastInvoiceNumber,
    membershipJoinedAt: snapshot.sessionPatch.membershipJoinedAt,
    transactions: snapshot.sessionPatch.transactions,
    isDemoMode: false,
  );
  ref.read(_demoSessionProvider.notifier).state = patched;
  await _persistentStore.saveSession(patched);
  return snapshot;
});

Future<Map<String, dynamic>> _productionSnapshotPart(
  String label,
  Future<Map<String, dynamic>> Function() loader, {
  bool requiredPart = false,
}) async {
  try {
    return await loader();
  } catch (error) {
    _tapGoDebugLog('[TapGo Binding] $label unavailable: $error');
    if (requiredPart) {
      rethrow;
    }
    return const <String, dynamic>{};
  }
}

final _adminConsoleSnapshotProvider = FutureProvider<_AdminConsoleApiSnapshot>((
  ref,
) async {
  final session = ref.read(_demoSessionProvider);
  if (session.accessToken == null || session.accessToken!.isEmpty) {
    throw StateError('Belum ada token admin backend.');
  }
  if (!session.isAdmin) {
    throw StateError('Anda tidak memiliki akses admin.');
  }
  _apiClient.setAccessToken(session.accessToken);
  final summary = await _apiClient.adminDashboardSummary();
  final results = await Future.wait<Object>([
    _adminSnapshotPart(
      label: 'admin members',
      loader: _apiClient.adminMembers,
      fallback: const <Map<String, dynamic>>[],
    ),
    _adminSnapshotPart(
      label: 'admin payments',
      loader: _apiClient.adminPayments,
      fallback: const <Map<String, dynamic>>[],
    ),
    _adminSnapshotPart(
      label: 'admin invoices',
      loader: _apiClient.adminInvoices,
      fallback: const <Map<String, dynamic>>[],
    ),
    _adminSnapshotPart(
      label: 'admin commissions',
      loader: _apiClient.adminCommissions,
      fallback: const <Map<String, dynamic>>[],
    ),
    _adminSnapshotPart(
      label: 'admin wallets',
      loader: _apiClient.adminWallets,
      fallback: const <Map<String, dynamic>>[],
    ),
    _adminSnapshotPart(
      label: 'admin withdrawals',
      loader: _apiClient.adminWithdrawals,
      fallback: const <Map<String, dynamic>>[],
    ),
    _adminSnapshotPart(
      label: 'admin profit sharing periods',
      loader: _apiClient.adminProfitSharingPeriods,
      fallback: const <Map<String, dynamic>>[],
    ),
    session.isSuperAdmin
        ? _adminSnapshotPart(
            label: 'founder platinum',
            loader: _apiClient.adminFounderPlatinum,
            fallback: const <String, dynamic>{},
          )
        : Future.value(const <String, dynamic>{}),
  ]);
  return _AdminConsoleApiSnapshot(
    summary: summary,
    members: results[0] as List<Map<String, dynamic>>,
    payments: results[1] as List<Map<String, dynamic>>,
    invoices: results[2] as List<Map<String, dynamic>>,
    commissions: results[3] as List<Map<String, dynamic>>,
    wallets: results[4] as List<Map<String, dynamic>>,
    withdrawals: results[5] as List<Map<String, dynamic>>,
    profitSharingPeriods: results[6] as List<Map<String, dynamic>>,
    founderProgram: results[7] as Map<String, dynamic>,
  );
});

Future<T> _adminSnapshotPart<T>({
  required String label,
  required Future<T> Function() loader,
  required T fallback,
}) async {
  try {
    return await loader();
  } catch (error) {
    _tapGoDebugLog('[TapGo Admin] $label unavailable: $error');
    if (!_isTapGoDevelopmentBuild) {
      rethrow;
    }
    return fallback;
  }
}

class _AdminConsoleApiSnapshot {
  const _AdminConsoleApiSnapshot({
    required this.summary,
    required this.members,
    required this.payments,
    required this.invoices,
    required this.commissions,
    required this.wallets,
    required this.withdrawals,
    required this.profitSharingPeriods,
    required this.founderProgram,
  });

  final Map<String, dynamic> summary;
  final List<Map<String, dynamic>> members;
  final List<Map<String, dynamic>> payments;
  final List<Map<String, dynamic>> invoices;
  final List<Map<String, dynamic>> commissions;
  final List<Map<String, dynamic>> wallets;
  final List<Map<String, dynamic>> withdrawals;
  final List<Map<String, dynamic>> profitSharingPeriods;
  final Map<String, dynamic> founderProgram;
}

class _TapGoPaymentIntent {
  const _TapGoPaymentIntent({
    required this.snapToken,
    required this.redirectUrl,
    required this.orderId,
    required this.invoiceNumber,
    required this.paid,
    this.referenceId,
    this.expiredAt,
    this.gateway,
  });

  final String snapToken;
  final String redirectUrl;
  final String orderId;
  final String invoiceNumber;
  final bool paid;
  final String? referenceId;
  final String? expiredAt;
  final String? gateway;

  factory _TapGoPaymentIntent.fromMap(Map<String, dynamic> map) {
    final paymentUrl = map['paymentUrl']?.toString();
    return _TapGoPaymentIntent(
      snapToken: map['snapToken']?.toString() ?? '',
      redirectUrl: paymentUrl ?? map['redirectUrl']?.toString() ?? '',
      orderId: map['orderId']?.toString() ?? '',
      invoiceNumber: map['invoiceNumber']?.toString() ?? '',
      paid: map['paid'] == true,
      referenceId: map['referenceId']?.toString(),
      expiredAt: map['expiredAt']?.toString(),
      gateway: map['gateway']?.toString(),
    );
  }
}

class _TapGoAuthResult {
  const _TapGoAuthResult({
    required this.user,
    this.accessToken,
    this.refreshToken,
  });

  final _TapGoAuthUser user;
  final String? accessToken;
  final String? refreshToken;

  factory _TapGoAuthResult.fromMap(Map<String, dynamic> map) {
    return _TapGoAuthResult(
      user: _TapGoAuthUser.fromMap(
        (map['user'] as Map?)?.cast<String, dynamic>() ?? map,
      ),
      accessToken: map['accessToken']?.toString(),
      refreshToken: map['refreshToken']?.toString(),
    );
  }
}

class _TapGoHealthCheckResult {
  const _TapGoHealthCheckResult({
    required this.url,
    required this.statusCode,
    required this.message,
  });

  final String url;
  final int statusCode;
  final String message;
}

class _TapGoAuthUser {
  const _TapGoAuthUser({
    required this.id,
    required this.name,
    required this.phone,
    required this.role,
    this.email,
    this.referralCode,
    this.isFounderChairman = false,
    this.isFounderPlatinum = false,
  });

  final String id;
  final String name;
  final String phone;
  final String role;
  final String? email;
  final String? referralCode;
  final bool isFounderChairman;
  final bool isFounderPlatinum;

  factory _TapGoAuthUser.fromMap(Map<String, dynamic> map) {
    return _TapGoAuthUser(
      id: map['id']?.toString() ?? '',
      name: (map['fullName'] ?? map['name'] ?? 'Member TapGo').toString(),
      phone: map['phone']?.toString() ?? '',
      role: _normalizeUserRole(map['role']?.toString()),
      email: map['email']?.toString(),
      referralCode: map['referralCode']?.toString(),
      isFounderChairman:
          map['founderRole']?.toString().toUpperCase() == 'FOUNDER_CHAIRMAN' ||
              map['isFounderChairman'] == true,
      isFounderPlatinum:
          map['founderRole']?.toString().toUpperCase() == 'FOUNDER_PLATINUM' ||
              map['isFounderPlatinum'] == true,
    );
  }
}

String _normalizePhone(String phone) {
  final digits = phone.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.startsWith('0')) {
    return '+62${digits.substring(1)}';
  }
  if (digits.startsWith('62')) {
    return '+$digits';
  }
  if (phone.trim().startsWith('+')) {
    return phone.trim();
  }
  return '+62$digits';
}

String _normalizeApiBaseUrl(String value) {
  final rootUrl = _normalizeApiRootUrl(value);
  if (rootUrl.isEmpty) {
    return 'https://api.tapgolion.id/api/v1/';
  }
  return '$rootUrl/api/v1/';
}

String _normalizeApiRootUrl(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) {
    return '';
  }
  var normalized = trimmed.endsWith('/')
      ? trimmed.substring(0, trimmed.length - 1)
      : trimmed;
  if (normalized.endsWith('/api/v1')) {
    normalized = normalized.substring(0, normalized.length - '/api/v1'.length);
  } else if (normalized.endsWith('/api/v1/')) {
    normalized = normalized.substring(0, normalized.length - '/api/v1/'.length);
  }
  return normalized.endsWith('/')
      ? normalized.substring(0, normalized.length - 1)
      : normalized;
}

String _rootUrlFromApiBaseUrl(String value) {
  final rootUrl = _normalizeApiRootUrl(value);
  return rootUrl.isEmpty ? 'https://api.tapgolion.id' : rootUrl;
}

String _healthUrlFromApiBaseUrl(String value) {
  return '${_rootUrlFromApiBaseUrl(value)}/health';
}

class _TapGoServerConfigStore {
  static const _apiBaseUrlKey = 'tapgo.uat.apiBaseUrl.v1';

  Future<String?> loadApiBaseUrl() async {
    if (tapGoDisablePersistenceForTests) {
      return null;
    }
    final preferences = await SharedPreferences.getInstance();
    final saved = preferences.getString(_apiBaseUrlKey);
    if (saved == null || saved.trim().isEmpty) {
      return null;
    }
    final normalizedRoot = _normalizeApiRootUrl(saved);
    if (normalizedRoot != saved) {
      await preferences.setString(_apiBaseUrlKey, normalizedRoot);
    }
    return normalizedRoot;
  }

  Future<void> saveApiBaseUrl(String value) async {
    if (tapGoDisablePersistenceForTests) {
      return;
    }
    final preferences = await SharedPreferences.getInstance();
    await preferences.setString(_apiBaseUrlKey, _normalizeApiRootUrl(value));
  }

  Future<void> resetApiBaseUrl() async {
    if (tapGoDisablePersistenceForTests) {
      return;
    }
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove(_apiBaseUrlKey);
  }
}

String _normalizeUserRole(String? role) {
  final normalized = (role ?? 'USER').trim().toUpperCase();
  if (normalized == 'SUPER_ADMIN' ||
      normalized == 'ADMIN' ||
      normalized == 'MEMBER' ||
      normalized == 'USER') {
    return normalized == 'MEMBER' ? 'USER' : normalized;
  }
  return 'USER';
}

DemoClientSession _sessionFromAuthUser(
  _TapGoAuthUser user, {
  String? accessToken,
  String? refreshToken,
  DemoClientSession? fallback,
}) {
  return DemoClientSession.initial().copyWith(
    userId: user.id.isEmpty ? fallback?.userId : user.id,
    email: user.email,
    role: user.role,
    accessToken: accessToken,
    refreshToken: refreshToken,
    isDemoMode: false,
    userName: user.name,
    phone: user.phone.isEmpty ? fallback?.phone : user.phone,
    referralCode: user.referralCode ?? fallback?.referralCode ?? '-',
    isFounderChairman:
        user.isFounderChairman || (fallback?.isFounderChairman ?? false),
    isFounderPlatinum:
        user.isFounderPlatinum || (fallback?.isFounderPlatinum ?? false),
  );
}

class _TapGoEndpointCatalog {
  const _TapGoEndpointCatalog._();

  static const register = 'POST /api/v1/auth/register';
  static const login = 'POST /api/v1/auth/login';
  static const refresh = 'POST /api/v1/auth/refresh';
  static const logout = 'POST /api/v1/auth/logout';
  static const me = 'GET /api/v1/auth/me';
  static const membershipPlans = 'GET /api/v1/memberships/plans';
  static const membershipMe = 'GET /api/v1/membership/me';
  static const membershipUpgrade = 'POST /api/v1/memberships/upgrade';
  static const membershipPackages = 'GET /api/v1/membership/packages';
  static const membershipOrders = 'POST /api/v1/membership/orders';
  static const invoiceDetail = 'GET /api/v1/invoices/:id';
  static const membershipOrderPay = 'POST /api/v1/membership/orders/:id/pay';
  static const midtransNotification =
      'POST /api/v1/payments/midtrans/notification';
  static const referralSummary = 'GET /api/v1/referrals/summary';
  static const referralTree = 'GET /api/v1/referrals/downlines';
  static const referralCommissions = 'GET /api/v1/referrals/commissions';
  static const wallet = 'GET /api/v1/wallet';
  static const walletTransactions = 'GET /api/v1/wallet/transactions';
  static const bankAccount = 'GET /api/v1/wallet/bank-account';
  static const bankAccountUpdate = 'PUT /api/v1/wallet/bank-account';
  static const withdrawalRequest = 'POST /api/v1/wallet/withdrawals';
  static const withdrawalHistory = 'GET /api/v1/wallet/withdrawals';
  static const accountDeleteRequest = 'POST /api/v1/account/delete-request';
  static const contactMessage = 'POST /api/v1/contact';
  static const memberIdentity = 'GET /api/v1/member-identity/me';
  static const supportTickets = 'GET /api/v1/support/tickets';
  static const supportTicketCreate = 'POST /api/v1/support/tickets';
  static const adminMemberRequests = 'GET /api/v1/admin/member-requests';
  static const adminBonusReport = 'GET /api/v1/admin/reports/bonus';
  static const adminPpobReport = 'GET /api/v1/admin/reports/ppob';
  static const adminRewardReport = 'GET /api/v1/admin/reports/reward';
  static const adminWithdrawals = 'GET /api/v1/admin/withdrawals';
  static const adminDashboardSummary = 'GET /api/v1/admin/dashboard/summary';
  static const adminMembers = 'GET /api/v1/admin/members';
  static const adminMemberDetail = 'GET /api/v1/admin/members/:id';
  static const adminPayments = 'GET /api/v1/admin/payments';
  static const adminInvoices = 'GET /api/v1/admin/invoices';
  static const adminCommissions = 'GET /api/v1/admin/commissions';
  static const adminCommissionSettings =
      'GET /api/v1/admin/commission-settings';
  static const adminWallets = 'GET /api/v1/admin/wallets';
  static const adminWalletTransactions =
      'GET /api/v1/admin/wallets/:userId/transactions';
  static const adminApproveWithdrawal =
      'POST /api/v1/admin/withdrawals/:id/approve';
  static const adminRejectWithdrawal =
      'POST /api/v1/admin/withdrawals/:id/reject';
  static const adminPaidWithdrawal = 'POST /api/v1/admin/withdrawals/:id/paid';
  static const adminProfitSharingPeriods =
      'GET /api/v1/admin/profit-sharing/periods';
  static const adminProfitSharingApprove =
      'POST /api/v1/admin/profit-sharing/periods/:id/approve';
  static const adminProfitSharingDistribute =
      'POST /api/v1/admin/profit-sharing/periods/:id/distribute';
  static const adminRoleManagement = 'PUT /api/v1/admin/roles/:userId';
  static const adminAppSettings = 'PUT /api/v1/admin/app-settings';
  static const membershipPackageSettings =
      'PUT /api/v1/memberships/admin/plans/:tier';
}

List<Map<String, dynamic>> _listFromPayload(Map<String, dynamic> payload) {
  final items = payload['items'] ??
      payload['data'] ??
      payload['downlines'] ??
      payload['nodes'] ??
      payload['rows'] ??
      payload['results'];
  if (items is List) {
    return items
        .whereType<Map>()
        .map((item) => item.cast<String, dynamic>())
        .toList();
  }
  return const [];
}

int _intFrom(Object? value) {
  if (value is num) {
    return value.round();
  }
  if (value is String) {
    return double.tryParse(value)?.round() ?? 0;
  }
  return 0;
}

String _titleCase(String value) {
  final clean = value.trim();
  if (clean.isEmpty) {
    return 'Basic';
  }
  final lower = clean.toLowerCase();
  return lower[0].toUpperCase() + lower.substring(1);
}

int _activeLevelFromDirectSponsor(int directSponsor) {
  if (directSponsor >= 10) {
    return 10;
  }
  if (directSponsor >= 5) {
    return 5;
  }
  if (directSponsor >= 3) {
    return 3;
  }
  return 0;
}

int _todayBonusFrom(List<Map<String, dynamic>> commissions) {
  final now = DateTime.now();
  return commissions.fold<int>(0, (total, item) {
    final createdAt = DateTime.tryParse(item['createdAt']?.toString() ?? '');
    if (createdAt == null ||
        createdAt.year != now.year ||
        createdAt.month != now.month ||
        createdAt.day != now.day) {
      return total;
    }
    return total + _intFrom(item['amount']);
  });
}

WalletTransactionModel _walletTransactionFromApi(Map<String, dynamic> item) {
  final type = item['type']?.toString() ?? 'TRANSAKSI';
  return WalletTransactionModel(
    title: _labelFromType(type),
    description: item['referenceType']?.toString() ?? 'Ledger TapGo',
    amount: _intFrom(item['amount']),
    status: 'Sukses',
  );
}

WalletTransactionModel _commissionTransactionFromApi(
  Map<String, dynamic> item,
) {
  final type = item['type']?.toString() ?? 'KOMISI';
  return WalletTransactionModel(
    title: _labelFromType(type),
    description: item['triggerType']?.toString() ?? 'Komisi TapGo',
    amount: _intFrom(item['amount']),
    status: item['status']?.toString() ?? 'POSTED',
  );
}

String _labelFromType(String type) {
  return switch (type) {
    'REGISTRATION_BONUS' => 'Bonus Registrasi',
    'BASIC_REGISTER_BONUS' => 'Bonus Registrasi',
    'PPOB_BENEFIT' => 'Saldo PPOB',
    'SPONSOR_BONUS' => 'Bonus Sponsor',
    'BASIC_SPONSOR_BONUS' => 'Bonus Sponsor',
    'LEVEL_BONUS' => 'Level Bonus',
    'REWARD_BONUS' => 'Reward Bonus',
    'PROFIT_SHARING' => 'Profit Sharing',
    'WITHDRAWAL' => 'Withdraw',
    _ => type.replaceAll('_', ' '),
  };
}

String? _dateLabel(Object? value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '');
  if (parsed == null) {
    return null;
  }
  return '${parsed.day}/${parsed.month}/${parsed.year}';
}

DemoReferralNode? _referralTreeFromApi(Map<String, dynamic> payload) {
  final rows = _listFromPayload(payload);
  if (rows.isEmpty) {
    return null;
  }
  final rootMap = (payload['root'] as Map?)?.cast<String, dynamic>();
  final rootId = rootMap?['userId']?.toString() ??
      rootMap?['id']?.toString() ??
      rows
          .map((item) => item['sponsorId']?.toString())
          .firstWhere((id) => id != null && id.isNotEmpty, orElse: () => null);
  final childrenBySponsor = <String, List<Map<String, dynamic>>>{};
  for (final item in rows) {
    final sponsorMap = (item['sponsor'] as Map?)?.cast<String, dynamic>();
    final sponsorId = item['sponsorId']?.toString() ??
        item['sponsor_id']?.toString() ??
        sponsorMap?['id']?.toString() ??
        sponsorMap?['userId']?.toString();
    if (sponsorId == null || sponsorId.isEmpty) {
      continue;
    }
    childrenBySponsor.putIfAbsent(sponsorId, () => []).add(item);
  }

  DemoReferralNode nodeFromItem(Map<String, dynamic> item) {
    final userMap = (item['user'] as Map?)?.cast<String, dynamic>();
    final memberMap = (item['member'] as Map?)?.cast<String, dynamic>();
    final userId = item['userId']?.toString() ??
        item['user_id']?.toString() ??
        item['id']?.toString() ??
        userMap?['id']?.toString() ??
        memberMap?['id']?.toString() ??
        'api-${DateTime.now().microsecondsSinceEpoch}';
    final level = _intFrom(item['level'] ?? item['depth']);
    final children =
        (childrenBySponsor[userId] ?? const <Map<String, dynamic>>[])
            .map(nodeFromItem)
            .toList(growable: false);
    return DemoReferralNode(
      id: userId,
      name: item['fullName']?.toString() ??
          item['full_name']?.toString() ??
          item['name']?.toString() ??
          userMap?['fullName']?.toString() ??
          userMap?['name']?.toString() ??
          memberMap?['fullName']?.toString() ??
          memberMap?['name']?.toString() ??
          'Member TapGo',
      packageName: _titleCase(
        item['membershipTier']?.toString() ??
            item['membership_tier']?.toString() ??
            item['packageName']?.toString() ??
            'Basic',
      ),
      level: level == 0 ? 1 : level,
      bonus: _intFrom(item['bonus'] ?? item['totalBonus']),
      totalDownline: _intFrom(
        item['totalDownline'] ??
            item['totalDownlines'] ??
            item['downlineCount'] ??
            children.length,
      ),
      isExpanded: level <= 2,
      children: children,
    );
  }

  final nestedChildren = rootId == null
      ? const <DemoReferralNode>[]
      : (childrenBySponsor[rootId] ?? const <Map<String, dynamic>>[])
          .map(nodeFromItem)
          .toList(growable: false);
  final flatChildren = rows.take(20).map(nodeFromItem).toList(growable: false);

  return DemoReferralNode(
    id: rootId ?? 'backend-root',
    name: rootMap?['fullName']?.toString() ??
        rootMap?['name']?.toString() ??
        'Referral Anda',
    packageName: _titleCase(
      rootMap?['membershipTier']?.toString() ??
          rootMap?['packageName']?.toString() ??
          'Basic',
    ),
    level: 0,
    bonus: _intFrom(rootMap?['bonus']),
    totalDownline: _intFrom(
      rootMap?['totalDownline'] ?? rootMap?['totalDownlines'],
    ),
    isExpanded: true,
    children: nestedChildren.isEmpty ? flatChildren : nestedChildren,
  );
}
