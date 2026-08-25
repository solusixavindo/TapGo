part of '../main.dart';

class DemoDriverRepository implements DriverRepository {
  DemoDriverRepository({DriverScenario initialScenario = DriverScenario.login})
      : _scenario = initialScenario;

  DriverScenario _scenario;
  DriverSession? _session;
  DriverAvailability _availability = DriverAvailability.offline;
  int networkCalls = 0;

  DriverAvailability get currentAvailability => _availability;

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
          code: 'RIDE_DRIVER_SUSPENDED',
          message: 'Akses driver sedang dihentikan.',
          statusCode: 403,
        );
      case DriverScenario.rejected:
        throw const DriverApiException(
          code: 'RIDE_DRIVER_REJECTED',
          message: 'Pengajuan driver tidak dapat dilanjutkan.',
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

  /// Dokumen demo disimpan di memori saja dan TIDAK pernah menyentuh jaringan.
  /// Mode demo dipakai untuk tinjauan tampilan; mengirim foto identitas sungguhan
  /// dari mode ini akan menjadi kejutan yang tidak seorang pun minta.
  final Map<DriverDocumentKind, DriverDocumentSummary> _demoDocuments = {};

  @override
  Future<List<DriverDocumentSummary>> documents() async {
    final list = _demoDocuments.values.toList()
      ..sort((a, b) => a.kind.api.compareTo(b.kind.api));
    return list;
  }

  @override
  Future<List<DriverDocumentSummary>> uploadDocument({
    required DriverDocumentKind kind,
    required Uint8List bytes,
    required String contentType,
  }) async {
    final now = DateTime.now();
    _demoDocuments[kind] = DriverDocumentSummary(
      kind: kind,
      review: DriverDocumentReview.pending,
      available: true,
      uploadedAt: now,
      // Masa simpan demo mengikuti kebijakan sungguhan supaya hitungan mundur
      // di layar terlihat sebagaimana adanya nanti.
      expiresAt: now.add(const Duration(hours: 24)),
      sizeBytes: bytes.length,
    );
    return documents();
  }

  DriverApplicationInfo? _demoApplication;

  @override
  Future<DriverApplicationSnapshot> myApplication() async {
    return DriverApplicationSnapshot(
      application: _demoApplication,
      documentsComplete: _demoDocuments.length == DriverDocumentKind.values.length,
      vehiclePlateMasked: _demoApplication == null ? null : 'B 1234 ***',
    );
  }

  @override
  Future<DriverApplicationSnapshot> submitApplication({
    required String serviceType,
    required String plateNumber,
    String? brand,
    String? model,
    String? color,
  }) async {
    _demoApplication = const DriverApplicationInfo(
      id: 'demo-application',
      cycleNumber: 1,
      status: DriverApplicationStatus.submitted,
    );
    return myApplication();
  }

  @override
  Future<DriverApplicationSnapshot> withdrawApplication() async {
    _demoApplication = null;
    return myApplication();
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
