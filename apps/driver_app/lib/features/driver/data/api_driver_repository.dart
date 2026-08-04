part of '../../../main.dart';

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
