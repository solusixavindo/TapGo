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

  /// Menukar refresh token menjadi pasangan token baru (rotasi di server).
  /// Dipanggil otomatis oleh _request saat access token kedaluwarsa (401),
  /// sehingga driver tidak dipaksa login ulang setiap ~15 menit. Gagal refresh
  /// (refresh token ikut gugur/dicabut) mengosongkan sesi -> login ulang.
  Future<bool> _refreshSession() async {
    final refreshToken = _session?.refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) return false;
    try {
      final response = await _dio.post<dynamic>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
        options: Options(headers: {'Authorization': null}),
      );
      final body = response.data;
      if (body is! Map) return false;
      final data = body['data'];
      if (data is! Map) return false;
      final access = '${data['accessToken'] ?? ''}';
      final refresh = '${data['refreshToken'] ?? ''}';
      if (access.isEmpty || refresh.isEmpty) return false;
      final next = DriverSession(
        accessToken: access,
        refreshToken: refresh,
        driverName: _session?.driverName ?? 'Driver TapGo',
      );
      _session = next;
      _applyToken();
      await _storage.save(next);
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Membersihkan sesi lokal + header. Dipakai saat refresh gagal total.
  Future<void> _expireLocalSession() async {
    _session = null;
    _applyToken();
    await _storage.clear();
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

  @override
  Future<List<DriverDocumentSummary>> documents() async {
    final data = await _request(() => _dio.get<dynamic>('/driver/documents'));
    return _documentsFrom(data);
  }

  @override
  Future<List<DriverDocumentSummary>> uploadDocument({
    required DriverDocumentKind kind,
    required Uint8List bytes,
    required String contentType,
  }) async {
    await _request(
      () => _dio.post<dynamic>(
        '/driver/documents/${kind.api}',
        data: Stream<List<int>>.fromIterable([bytes]),
        options: Options(
          headers: {
            Headers.contentTypeHeader: contentType,
            // Dio tidak dapat menghitung panjang aliran sendiri, sedangkan
            // parser mentah di backend menuntutnya. Tanpa header ini
            // permintaannya menggantung sampai timeout.
            Headers.contentLengthHeader: bytes.length,
          },
        ),
      ),
    );

    // Daftar dibaca ulang dari server, bukan disusun dari tebakan lokal:
    // masa simpan dan status pemeriksaan ditentukan backend, dan hanya backend
    // yang tahu nilainya setelah unggahan diterima.
    return documents();
  }

  List<DriverDocumentSummary> _documentsFrom(Map<String, dynamic> data) {
    final items = data['items'] is List ? data['items'] as List : const [];
    final result = <DriverDocumentSummary>[];
    for (final item in items) {
      if (item is! Map) continue;
      final parsed =
          DriverDocumentSummary.fromJson(Map<String, dynamic>.from(item));
      if (parsed != null) result.add(parsed);
    }
    return result;
  }

  Future<DriverRide> _rideMutation(String path) async {
    final data = await _request(() => _dio.post<dynamic>(path));
    return DriverRide.fromJson(data);
  }

  /// Pembungkus request dengan retry-otomatis setelah refresh token.
  Future<Map<String, dynamic>> _request(
      Future<Response<dynamic>> Function() call) {
    return _performRequest(call, retriedAfterRefresh: false);
  }

  Future<Map<String, dynamic>> _performRequest(
      Future<Response<dynamic>> Function() call,
      {required bool retriedAfterRefresh}) async {
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
      // Access token kedaluwarsa (401) bukan akhir sesi bila refresh token masih
      // hidup: refresh sekali lalu ulangi permintaan aslinya. Hanya bila refresh
      // ikut gagal (token dicabut / ganti password) sesi lokal dikosongkan.
      final is401 = error.response?.statusCode == 401;
      if (is401 &&
          !retriedAfterRefresh &&
          _session?.refreshToken.isNotEmpty == true) {
        final refreshed = await _refreshSession();
        if (refreshed) {
          return _performRequest(call, retriedAfterRefresh: true);
        }
        await _expireLocalSession();
        throw const DriverApiException(
          code: 'AUTH_REQUIRED',
          message: 'Sesi berakhir. Silakan login kembali.',
          statusCode: 401,
        );
      }
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

  void _applyToken() {
    if (_session?.accessToken case final token?) {
      _dio.options.headers['Authorization'] = 'Bearer $token';
    } else {
      _dio.options.headers.remove('Authorization');
    }
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
    // Kode di bawah datang dari jalur unggah dokumen. Pesannya ditulis ulang
    // agar menyebutkan apa yang harus driver lakukan, bukan sekadar menolak.
    case 'DRIVER_PROFILE_NOT_FOUND':
      return 'Profil mitra driver belum terdaftar. Hubungi admin TapGo.';
    case 'DRIVER_DOCUMENT_TYPE_INVALID':
      return 'Berkas harus berupa foto JPG atau PNG. Coba potret ulang.';
    case 'DRIVER_DOCUMENT_TOO_LARGE':
      return 'Ukuran foto melebihi 5 MB. Potret ulang dengan kualitas lebih rendah.';
    case 'DRIVER_DOCUMENT_TYPE_UNKNOWN':
      return 'Jenis dokumen tidak dikenal. Perbarui aplikasi Anda.';
    case 'DRIVER_KYC_ALREADY_APPROVED':
      return 'Verifikasi Anda sudah disetujui, dokumen tidak dapat diubah lagi.';
    case 'MEMBERSHIP_DOCUMENT_SECRET_UNAVAILABLE':
      return 'Layanan unggah dokumen sedang tidak tersedia. Coba beberapa saat lagi.';
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
