part of '../../../main.dart';

// --- Trust-anchor pinning ---------------------------------------------------
// Anchor dibundel di core/security/tls_pinning.dart (tanpa --dart-define dan
// tanpa nilai dari environment). Lihat docs/release/TLS_TRUST_ANCHORS.md.

/// Mencatat penolakan sertifikat oleh callback. Dio mengeluarkan
/// DioExceptionType.unknown + HandshakeException untuk SEMUA kegagalan TLS,
/// jadi penyebabnya tidak dapat dikenali dari tipe galat. Callback sertifikat
/// buruk yang tahu (ia menerima sertifikat pada titik gagal), maka ia yang
/// mencatatnya; tiap permintaan menandai hitungan awalnya
/// (RequestOptions.extra) dan dianggap ditolak bila hitungan bertambah selama
/// permintaan itu berjalan.
class _CertificateRejectionLog {
  static const _startKey = 'tapgo_cert_rejections_at_start';
  int _count = 0;
  TapGoCertificateRejection? _last;

  void record(TapGoCertificateRejection reason) {
    _count += 1;
    _last = reason;
  }

  void markStart(RequestOptions options) => options.extra[_startKey] = _count;

  /// Alasan penolakan terakhir selama permintaan ini, atau null bila callback
  /// tidak dipanggil (kegagalan handshake lain).
  TapGoCertificateRejection? rejectionDuring(RequestOptions options) {
    final atStart = options.extra[_startKey];
    return atStart is int && _count > atStart ? _last : null;
  }
}

/// Memasang trust-anchor pinning pada [dio] untuk build rilis: hanya rantai
/// yang berujung di [anchorPems] yang diterima; validasi (rantai, masa berlaku,
/// hostname) dikerjakan BoringSSL, dan callback sertifikat buruk selalu menolak.
///
/// Fail-closed PENUH: bila [anchorPems] kosong ATAU adapter bukan
/// IOHttpClientAdapter (tidak bisa dipin sama sekali — mis. target web),
/// SEMUA permintaan jaringan ditolak (lewat interceptor, sebelum TLS
/// handshake pun dimulai) — bukan diam-diam berjalan tanpa proteksi.
void _applyTlsPinning(
  Dio dio,
  List<String> anchorPems, {
  _CertificateRejectionLog? rejections,
}) {
  if (anchorPems.isEmpty) {
    _rejectAllRequestsForTlsPinning(
      dio,
      'Trust anchor TLS kosong pada build rilis ini — permintaan jaringan '
      'ditolak (fail-closed).',
    );
    return;
  }
  final adapter = dio.httpClientAdapter;
  if (adapter is! IOHttpClientAdapter) {
    _rejectAllRequestsForTlsPinning(
      dio,
      'Adapter jaringan build ini tidak mendukung certificate pinning — '
      'permintaan jaringan ditolak (fail-closed) daripada berjalan tanpa '
      'proteksi.',
    );
    return;
  }
  adapter.createHttpClient = () {
    final client = HttpClient(context: tapGoBuildTrustAnchorContext(anchorPems));
    client.badCertificateCallback = (X509Certificate cert, String host, int port) {
      rejections?.record(tapGoClassifyRejectedCertificate(cert, DateTime.now()));
      return false;
    };
    return client;
  };
  if (rejections != null) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          rejections.markStart(options);
          handler.next(options);
        },
      ),
    );
  }
}

/// Pinning tidak dapat ditegakkan pada build ini (anchor kosong / adapter tidak
/// mendukung). Tipe khusus supaya _performRequest dapat membedakannya dari
/// gangguan jaringan biasa dan menampilkan diagnosis yang benar.
class _TlsPinningUnavailable implements Exception {
  const _TlsPinningUnavailable(this.message);
  final String message;
  @override
  String toString() => message;
}

void _rejectAllRequestsForTlsPinning(Dio dio, String message) {
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        handler.reject(
          DioException(
            requestOptions: options,
            type: DioExceptionType.unknown,
            error: _TlsPinningUnavailable(message),
          ),
        );
      },
    ),
  );
}

/// Kegagalan sertifikat/handshake TLS — berbeda dari "tidak ada sinyal".
bool _isTlsFailure(DioException error) =>
    error.type == DioExceptionType.badCertificate ||
    error.error is TlsException;

bool _tlsFailureReported = false;

/// Laporan sekali per proses ke Sentry (no-op bila Sentry tidak aktif). Hanya
/// kode dan host — tanpa token, nomor HP, atau isi permintaan.
void _reportTlsFailureOnce(String code, String host) {
  if (_tlsFailureReported) return;
  _tlsFailureReported = true;
  try {
    unawaited(Sentry.captureMessage(
      'driver_app TLS: $code host=$host',
      level: SentryLevel.error,
    ));
  } catch (_) {
    // Pelaporan tidak boleh mengganggu alur login.
  }
}

class ApiDriverRepository implements DriverRepository {
  ApiDriverRepository({
    required String baseUrl,
    required SessionStore storage,
    // Hanya untuk tes: memaksa pinning aktif (atau mati) di luar kReleaseMode
    // dan menyuntikkan trust anchor, supaya handshake TLS sungguhan dapat diuji.
    @visibleForTesting bool? enforceTlsPinning,
    @visibleForTesting List<String>? tlsTrustAnchorsOverride,
  })  : _storage = storage,
        _pinningEnforced = enforceTlsPinning ?? kReleaseMode,
        _dio = Dio(
          BaseOptions(
            baseUrl: _normalizeBaseUrl(baseUrl),
            connectTimeout: const Duration(seconds: 8),
            receiveTimeout: const Duration(seconds: 12),
            headers: {
              'Accept': 'application/json',
              // E4 (DRIVER_APP_READINESS_PLAN.md): sebelum ini driver_app
              // tidak mengirim header identitas sama sekali, jadi APK lama
              // tidak pernah bisa ditolak server. 'X-TapGo-App': 'driver'
              // membedakannya dari user_app di backend (lihat
              // legacyMobileClientGate.ts) supaya nomor build driver TIDAK
              // PERNAH dibandingkan dengan ambang batas milik user_app.
              'X-TapGo-App': 'driver',
              'X-TapGo-Platform': Platform.operatingSystem,
              // Distribusi Play-saja (E5) — sama seperti user_app, lihat
              // catatan _tapGoDistributionHeader di user_app/lib/main.dart.
              'X-TapGo-Distribution': 'play',
            },
          ),
        ) {
    // Audit keamanan 30 September 2026 (M4): sama seperti user_app, hanya
    // ditegakkan pada build rilis. Lihat _applyTlsPinning untuk perilaku
    // fail-closed bila anchor kosong pada rilis.
    if (_pinningEnforced) {
      _applyTlsPinning(
        _dio,
        tlsTrustAnchorsOverride ?? kTapGoTrustAnchorPems,
        rejections: _certRejections,
      );
    }
    unawaited(_loadAppVersionHeader());
  }

  /// Versi+build sungguhan dari APK terpasang. Dibaca sekali secara async
  /// (PackageInfo tidak tersedia sinkron) dan ditempel ke header default —
  /// permintaan yang terjadi SEBELUM ini selesai berjalan tanpa header versi,
  /// yang oleh gerbang server diperlakukan sama seperti versi tak terbaca
  /// (fail-open, tidak pernah salah tolak).
  Future<void> _loadAppVersionHeader() async {
    try {
      final info =
          await PackageInfo.fromPlatform().timeout(const Duration(seconds: 2));
      if (info.version.isNotEmpty) {
        _dio.options.headers['X-TapGo-App-Version'] =
            '${info.version}+${info.buildNumber}';
      }
    } catch (_) {
      // Diam-diam gagal: header versi opsional, tidak boleh menghalangi app.
    }
  }

  final Dio _dio;
  final SessionStore _storage;
  final bool _pinningEnforced;
  final _CertificateRejectionLog _certRejections = _CertificateRejectionLog();
  DriverSession? _session;

  // SEMUA penukaran refresh token lewat koordinator ini (lihat
  // token_refresh_coordinator.dart): satu penukaran pada satu waktu, token
  // yang sudah dikonsumsi tidak pernah dikirim lagi, dan pasangan baru
  // disimpan sebelum kunci dilepas. Ini menutup balapan antara poll tawaran
  // (12 detik) dan kirim lokasi (15 detik) yang bisa membuat server mencabut
  // seluruh sesi (driver dipaksa login ulang padahal tidak logout).
  late final TokenRefreshCoordinator _refreshCoordinator =
      TokenRefreshCoordinator(
    network: _networkRefresh,
    persist: (tokens) async {
      final next = DriverSession(
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        driverName: _session?.driverName ?? 'Driver TapGo',
      );
      _session = next;
      _applyToken();
      await _storage.save(next);
    },
    readStored: () async {
      final stored = await _storage.read();
      if (stored == null) return null;
      return (
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
      );
    },
  );

  @override
  Future<DriverSession?> restoreSession() async {
    _session = await _restoreLocalSessionWithRetry(_storage);
    _applyToken();
    if (_session == null) return null;
    try {
      await currentRide();
      return _session;
    } on DriverApiException catch (error) {
      // Hanya kegagalan auth sungguhan yang menghapus sesi. Status
      // kapabilitas (profil belum lengkap/akun nonaktif) tetap punya sesi
      // sah — token TIDAK dihapus, supaya app tidak memaksa login ulang di
      // buka berikutnya selagi status kapabilitasnya masih sama.
      if (error.isAuthFailure) {
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
  Future<GoogleAuthResult> loginWithGoogle({required String idToken}) async {
    final data = await _request(
      () => _dio.post<dynamic>('/auth/google', data: {'idToken': idToken}),
    );
    if (data['needsPhone'] == true) {
      return GoogleAuthResult.needsPhone(
        suggestedFullName: data['suggestedFullName']?.toString(),
      );
    }
    final session = _sessionFrom(data);
    _session = session;
    _applyToken();
    await _storage.save(session);
    return GoogleAuthResult.session(session);
  }

  @override
  Future<DriverSession> completeGoogleRegistration({
    required String idToken,
    required String phone,
    String? fullName,
  }) async {
    final data = await _request(
      () => _dio.post<dynamic>(
        '/auth/google/complete',
        data: {
          'idToken': idToken,
          'phone': _normalizePhone(phone),
          if (fullName != null && fullName.trim().isNotEmpty)
            'fullName': fullName.trim(),
        },
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
  /// sehingga driver tidak dipaksa login ulang setiap ~15 menit. Penukaran
  /// sesungguhnya dilakukan oleh _refreshCoordinator (single-flight — lihat
  /// catatan di atasnya); method ini hanya menerjemahkan hasilnya.
  /// Hasil: true = token baru tersimpan (dari jaringan ATAU dari storage bila
  /// pemanggil lain sudah menukarnya lebih dulu); false = server MENOLAK
  /// refresh token (dicabut / ganti password) -> sesi boleh dikosongkan;
  /// null = gangguan jaringan / 5xx -> sesi HARUS dipertahankan agar driver
  /// tidak dipaksa login ulang hanya karena koneksi putus.
  Future<bool?> _refreshSession() async {
    final refreshToken = _session?.refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) return false;
    final outcome = await _refreshCoordinator.refresh(refreshToken);
    switch (outcome.status) {
      case DriverRefreshStatus.refreshed:
        final tokens = outcome.tokens;
        if (tokens == null) return null;
        // persist() pada koordinator sudah memperbarui _session bila
        // penukaran ini yang menang; jaga-jaga bila hasilnya datang dari
        // jalur token-basi/storage (persist tidak dipanggil ulang di sana).
        if (_session?.accessToken != tokens.accessToken) {
          _session = DriverSession(
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            driverName: _session?.driverName ?? 'Driver TapGo',
          );
          _applyToken();
        }
        return true;
      case DriverRefreshStatus.rejected:
        return false;
      case DriverRefreshStatus.unreachable:
      case DriverRefreshStatus.conflict:
        return null;
    }
  }

  /// Satu-satunya pemanggilan HTTP ke /auth/refresh (hanya dipanggil
  /// koordinator). Header Authorization sengaja dikosongkan: endpoint ini
  /// hanya butuh refreshToken di body, dan mengirim access token kedaluwarsa
  /// bisa ikut ditolak 401.
  Future<DriverRefreshOutcome> _networkRefresh(String refreshToken) async {
    try {
      final response = await _dio.post<dynamic>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
        options: Options(headers: {'Authorization': null}),
      );
      final body = response.data;
      if (body is! Map) {
        return (status: DriverRefreshStatus.unreachable, tokens: null);
      }
      final data = body['data'];
      if (data is! Map) {
        return (status: DriverRefreshStatus.unreachable, tokens: null);
      }
      final access = '${data['accessToken'] ?? ''}';
      final refresh = '${data['refreshToken'] ?? ''}';
      if (access.isEmpty || refresh.isEmpty) {
        return (status: DriverRefreshStatus.unreachable, tokens: null);
      }
      return (
        status: DriverRefreshStatus.refreshed,
        tokens: (accessToken: access, refreshToken: refresh),
      );
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      if (status == 401 || status == 403) {
        return (status: DriverRefreshStatus.rejected, tokens: null);
      }
      // 409 TOKEN_ROTATED: pemanggil lain sudah menukar token yang sama
      // barusan — bukan kegagalan, koordinator akan memakai hasil yang
      // sudah tersimpan (lihat token_refresh_coordinator.dart).
      if (status == 409) {
        return (status: DriverRefreshStatus.conflict, tokens: null);
      }
      return (status: DriverRefreshStatus.unreachable, tokens: null);
    } catch (_) {
      return (status: DriverRefreshStatus.unreachable, tokens: null);
    }
  }

  /// Membersihkan sesi lokal + header. Dipakai saat refresh gagal total.
  Future<void> _expireLocalSession() async {
    _session = null;
    _applyToken();
    await _storage.clear();
  }

  @override
  Future<DriverAvailability> fetchAvailability() async {
    final data =
        await _request(() => _dio.get<dynamic>('/driver/availability'));
    final raw = '${data['availability'] ?? ''}';
    // Nilai tak dikenal TIDAK boleh diam-diam menjadi offline (kartu beranda
    // akan berbohong): lapor sebagai tak diketahui supaya klien mempertahankan
    // keadaan sebelumnya.
    if (raw != 'ONLINE' && raw != 'OFFLINE' && raw != 'BUSY') {
      throw const DriverApiException(
        code: 'AVAILABILITY_UNKNOWN',
        message: 'Status ketersediaan dari server tidak dikenali.',
      );
    }
    return _availabilityFrom(raw);
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
  Future<List<DriverRide>> rideHistory({int limit = 20}) async {
    final data = await _request(
      () => _dio.get<dynamic>(
        '/driver/rides/history',
        queryParameters: {'limit': limit},
      ),
    );
    final items = data['items'] is List
        ? data['items'] as List
        : data['data'] as List? ?? const [];
    return items
        .whereType<Map>()
        .map((e) => DriverRide.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  @override
  Future<DriverEarningsSummary> earningsSummary({String range = 'today'}) async {
    final data = await _request(
      () => _dio.get<dynamic>(
        '/driver/earnings/summary',
        queryParameters: {'range': range},
      ),
    );
    return DriverEarningsSummary.fromJson(data);
  }

  @override
  Future<DriverWalletSummary> walletSummary() async {
    final data = await _request(() => _dio.get<dynamic>('/driver/wallet'));
    return DriverWalletSummary.fromJson(data);
  }

  @override
  Future<DriverPerformanceSummary> performanceSummary() async {
    final data = await _request(() => _dio.get<dynamic>('/driver/performance'));
    return DriverPerformanceSummary.fromJson(data);
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

  @override
  Future<DriverApplicationSnapshot> myApplication() async {
    final data =
        await _request(() => _dio.get<dynamic>('/driver/applications/mine'));
    return _applicationSnapshotFrom(data);
  }

  @override
  Future<DriverApplicationSnapshot> submitApplication({
    required String serviceType,
    required String plateNumber,
    String? brand,
    String? model,
    String? color,
    String? fullName,
    String? dateOfBirth,
    String? address,
    String? emergencyContactName,
    String? emergencyContactPhone,
    required bool declarationAccepted,
  }) async {
    await _request(
      () => _dio.post<dynamic>(
        '/driver/applications',
        data: {
          'serviceType': serviceType,
          'plateNumber': plateNumber,
          if (brand != null && brand.isNotEmpty) 'brand': brand,
          if (model != null && model.isNotEmpty) 'model': model,
          if (color != null && color.isNotEmpty) 'color': color,
          if (fullName != null && fullName.isNotEmpty) 'fullName': fullName,
          if (dateOfBirth != null && dateOfBirth.isNotEmpty)
            'dateOfBirth': dateOfBirth,
          if (address != null && address.isNotEmpty) 'address': address,
          if (emergencyContactName != null && emergencyContactName.isNotEmpty)
            'emergencyContactName': emergencyContactName,
          if (emergencyContactPhone != null &&
              emergencyContactPhone.isNotEmpty)
            'emergencyContactPhone': emergencyContactPhone,
          'declarationAccepted': declarationAccepted,
        },
      ),
    );
    // Status dibaca ulang dari server: versi, nomor siklus, dan kelengkapan
    // dokumen adalah keputusan backend, bukan asumsi klien.
    return myApplication();
  }

  @override
  Future<DriverApplicationSnapshot> withdrawApplication() async {
    await _request(
        () => _dio.post<dynamic>('/driver/applications/withdraw'));
    return myApplication();
  }

  @override
  Future<List<Map<String, dynamic>>> chatConversations() async {
    final data = await _request(() => _dio.get<dynamic>('/chat/conversations'));
    final items = data['items'] is List
        ? data['items'] as List
        : data['data'] as List? ?? const [];
    return items
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  @override
  Future<List<Map<String, dynamic>>> chatMessages(String rideReference) async {
    final data = await _request(
      () => _dio.get<dynamic>(
        '/chat/rides/$rideReference/messages',
        queryParameters: {'page': 1, 'pageSize': 100},
      ),
    );
    final items = data['items'] is List
        ? data['items'] as List
        : data['data'] as List? ?? const [];
    return items
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  @override
  Future<void> sendChatMessage(String rideReference, String message) async {
    await _request(
      () => _dio.post<dynamic>(
        '/chat/rides/$rideReference/messages',
        data: {'message': message},
      ),
    );
  }

  @override
  Future<void> markChatRead(String rideReference) async {
    await _request(
      () => _dio.post<dynamic>('/chat/rides/$rideReference/read'),
    );
  }

  @override
  Future<DriverFaceCheckSnapshot> faceCheckToday() async {
    final data = await _request(() => _dio.get<dynamic>('/driver/face-check/today'));
    return DriverFaceCheckSnapshot.fromJson(data);
  }

  @override
  Future<DriverFaceReferenceEmbedding> faceCheckReference() async {
    final data = await _request(() => _dio.get<dynamic>('/driver/face-check/reference'));
    return DriverFaceReferenceEmbedding.fromJson(data);
  }

  @override
  Future<DriverFaceCheckSnapshot> submitFaceCheckAttempt({
    required double similarityScore,
    required bool livenessPassed,
    required String modelVersion,
  }) async {
    final data = await _request(
      () => _dio.post<dynamic>(
        '/driver/face-check/attempt',
        data: {
          'similarityScore': similarityScore,
          'livenessPassed': livenessPassed,
          'modelVersion': modelVersion,
        },
      ),
    );
    return DriverFaceCheckSnapshot.fromJson(data);
  }

  @override
  Future<void> registerPushToken(String token) async {
    await _request(
      () => _dio.post<dynamic>(
        '/notifications/push-token',
        data: {'token': token, 'platform': 'android'},
      ),
    );
  }

  @override
  Future<void> unregisterPushToken(String token) async {
    await _request(
      () => _dio.delete<dynamic>(
        '/notifications/push-token',
        data: {'token': token},
      ),
    );
  }

  @override
  Future<void> sendLocation({
    required double lat,
    required double lng,
    required int accuracyMeters,
    required DateTime capturedAt,
  }) async {
    await _request(
      () => _dio.post<dynamic>(
        '/driver/location',
        data: {
          'lat': lat,
          'lng': lng,
          'accuracyMeters': accuracyMeters,
          'capturedAt': capturedAt.toUtc().toIso8601String(),
        },
      ),
    );
  }

  @override
  Future<void> triggerSos({
    required double lat,
    required double lng,
    int? accuracyMeters,
    String? rideReference,
  }) async {
    await _request(
      () => _dio.post<dynamic>(
        '/driver/sos',
        data: {
          'lat': lat,
          'lng': lng,
          if (accuracyMeters != null) 'accuracyMeters': accuracyMeters,
          if (rideReference != null) 'rideReference': rideReference,
        },
      ),
    );
  }

  @override
  Future<DriverSafetyStatus> safetyStatus() async {
    final data = await _request(() => _dio.get<dynamic>('/driver/safety-status'));
    return DriverSafetyStatus.fromJson(data);
  }

  @override
  Future<DriverFaceCheckSnapshot> submitRecheckAttempt({
    required double similarityScore,
    required bool livenessPassed,
    required String modelVersion,
  }) async {
    final data = await _request(
      () => _dio.post<dynamic>(
        '/driver/face-check/recheck-attempt',
        data: {
          'similarityScore': similarityScore,
          'livenessPassed': livenessPassed,
          'modelVersion': modelVersion,
        },
      ),
    );
    return DriverFaceCheckSnapshot.fromJson(data);
  }

  DriverApplicationSnapshot _applicationSnapshotFrom(
      Map<String, dynamic> data) {
    final rawApplication = data['application'];
    final vehicle = data['vehicle'];
    return DriverApplicationSnapshot(
      application: rawApplication is Map
          ? DriverApplicationInfo.fromJson(
              Map<String, dynamic>.from(rawApplication))
          : null,
      documentsComplete: data['documentsComplete'] == true,
      vehiclePlateMasked:
          vehicle is Map ? vehicle['plateMasked'] as String? : null,
    );
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
        if (refreshed == true) {
          return _performRequest(call, retriedAfterRefresh: true);
        }
        if (refreshed == null) {
          // Refresh tidak dapat diverifikasi (jaringan/5xx): JANGAN kosongkan
          // sesi. Laporkan sebagai gangguan koneksi agar driver coba lagi
          // tanpa kehilangan login.
          throw const DriverApiException(
            code: 'NETWORK_ERROR',
            message: 'Koneksi belum stabil. Silakan coba lagi.',
          );
        }
        await _expireLocalSession();
        throw const DriverApiException(
          code: 'AUTH_REQUIRED',
          message: 'Sesi berakhir. Silakan login kembali.',
          statusCode: 401,
        );
      }
      final body = error.response?.data;
      final tlsCode = _tlsDiagnosis(error);
      if (tlsCode != null) {
        _reportTlsFailureOnce(tlsCode, Uri.parse(_dio.options.baseUrl).host);
        throw DriverApiException(
            code: tlsCode, message: _friendlyMessage(tlsCode, ''));
      }
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

  /// Kode diagnosis untuk kegagalan TLS, atau null bila bukan masalah TLS.
  String? _tlsDiagnosis(DioException error) {
    if (error.error is _TlsPinningUnavailable) return 'TLS_PIN_NOT_CONFIGURED';
    if (!_isTlsFailure(error)) return null;
    // TLS_PIN_MISMATCH hanya bila sertifikat ditolak karena TIDAK DIPERCAYA
    // (rantai tidak berujung di anchor, atau hostname tidak cocok): pesannya
    // menyuruh memperbarui dari Google Play. Kegagalan TLS lain — sertifikat
    // kedaluwarsa/belum berlaku (jam HP salah) dan kegagalan handshake lain —
    // TLS_CERTIFICATE_INVALID, yang BUKAN otomatis berarti aplikasi harus
    // diperbarui.
    final rejection = _pinningEnforced
        ? _certRejections.rejectionDuring(error.requestOptions)
        : null;
    return rejection == TapGoCertificateRejection.untrusted
        ? 'TLS_PIN_MISMATCH'
        : 'TLS_CERTIFICATE_INVALID';
  }

  void _applyToken() {
    if (_session?.accessToken case final token?) {
      _dio.options.headers['Authorization'] = 'Bearer $token';
    } else {
      _dio.options.headers.remove('Authorization');
    }
  }
}

/// Baca sesi awal dengan percobaan ulang + timeout longgar — dipakai HANYA
/// untuk pemulihan sesi saat cold start.
///
/// Android bisa lambat menginisialisasi Keystore/EncryptedSharedPreferences
/// saat plugin native lain (Geolocator, kamera, dll) ikut berebut inisialisasi
/// di frame yang sama. Tanpa percobaan ulang, pembacaan yang lambat (BUKAN
/// sesi yang benar-benar hilang) disalahartikan sebagai "belum pernah
/// login", memaksa driver login ulang padahal sesinya masih sah. Pola sama
/// dengan _restoreLocalStateWithRetry di user_app.
Future<DriverSession?> _restoreLocalSessionWithRetry(SessionStore storage) async {
  const timeout = Duration(seconds: 6);
  for (var attempt = 1; attempt <= 2; attempt++) {
    try {
      return await storage.read().timeout(timeout);
    } on TimeoutException {
      // dicoba lagi pada iterasi berikutnya.
    }
  }
  return null;
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
      isAuthFailure ||
      code == 'RIDE_DRIVER_PROFILE_REQUIRED' ||
      code == 'RIDE_DRIVER_NOT_ACTIVE' ||
      code == 'RIDE_DRIVER_ACCOUNT_INACTIVE';

  /// Sesi benar-benar tidak valid (token ditolak/kedaluwarsa) — berbeda dari
  /// status KAPABILITAS driver (mis. profil belum lengkap, akun nonaktif)
  /// yang tetap punya sesi sah, hanya belum boleh mengakses fitur tertentu.
  /// Membedakan ini penting: hanya kegagalan auth sungguhan yang boleh
  /// menghapus token tersimpan — status kapabilitas tidak boleh, karena
  /// token itu masih sah dan menghapusnya memaksa login ulang tiap buka app
  /// selama status kapabilitas belum berubah (lihat restoreSession()).
  bool get isAuthFailure => statusCode == 401 || code == 'AUTH_REQUIRED';
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
    // Sebelumnya jatuh ke pesan mentah server berbahasa Inggris ("Too many
    // authentication attempts...") — regresi Owner 29 Sep 2026, muncul saat
    // menguji login berulang dari 1 perangkat dalam waktu singkat.
    case 'RATE_LIMITED':
    case 'AUTH_RECOVERY_RATE_LIMITED':
    case 'REGISTER_PHONE_RATE_LIMITED':
      return 'Terlalu banyak percobaan. Silakan tunggu beberapa menit lalu coba lagi.';
    // Kode backend (AuthService.ts, errorHandler.ts) yang pesan aslinya
    // berbahasa Inggris. Tanpa ini pesan mentah server tampil ke driver.
    case 'INVALID_CREDENTIALS':
      return 'Nomor HP atau password salah.';
    case 'ACCOUNT_INACTIVE':
      return 'Akun Anda tidak aktif. Hubungi dukungan TapGo.';
    case 'VALIDATION_ERROR':
      return 'Data yang dikirim tidak valid. Periksa isian Anda lalu coba lagi.';
    case 'ROUTE_NOT_FOUND':
      return 'Fitur ini belum tersedia di server. Perbarui aplikasi atau coba lagi nanti.';
    case 'TLS_PIN_MISMATCH':
      return 'Koneksi aman ke server TapGo tidak dapat diverifikasi. '
          'Perbarui aplikasi dari Google Play. Jika masih terjadi, hubungi dukungan TapGo.';
    case 'TLS_PIN_NOT_CONFIGURED':
      return 'Aplikasi ini belum dikonfigurasi dengan benar untuk terhubung ke server. '
          'Pasang versi terbaru dari Google Play atau hubungi dukungan TapGo.';
    case 'TLS_CERTIFICATE_INVALID':
      return 'Koneksi aman ke server TapGo gagal diverifikasi. '
          'Periksa tanggal dan jam HP Anda, lalu coba lagi. '
          'Ini belum tentu berarti aplikasi harus diperbarui.';
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
    case 'RIDE_DRIVER_FACE_CHECK_REQUIRED':
      return 'Verifikasi wajah harian diperlukan sebelum online.';
    case 'RIDE_DRIVER_FACE_CHECK_BLOCKED':
      return 'Percobaan verifikasi wajah hari ini sudah habis. Hubungi admin TapGo.';
    case 'RIDE_DRIVER_FACE_CHECK_MISMATCH':
      return 'Wajah tidak cocok. Silakan coba lagi.';
    case 'RIDE_DRIVER_FACE_REFERENCE_MISSING':
      return 'Foto referensi wajah belum tersedia. Hubungi admin TapGo.';
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
