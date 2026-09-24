part of '../../../main.dart';

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
  Timer? _locationTimer;
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

  /// Langkah 1 Daftar/Masuk dengan Google. Mengembalikan hasilnya ke
  /// pemanggil (LoginScreen) supaya UI dapat memutuskan menampilkan
  /// formulir nomor HP atau langsung berhasil — beda dari [login] yang
  /// tidak perlu itu karena hasilnya selalu sesi langsung.
  Future<GoogleAuthResult?> loginWithGoogle(String idToken) async {
    if (!_startFlight('loginWithGoogle')) return null;
    state = state.copyWith(isBusy: true, clearMessage: true);
    try {
      final result = await _repository.loginWithGoogle(idToken: idToken);
      if (!result.needsPhone) {
        state = state.copyWith(session: result.session);
        await refreshWorkspace();
      }
      return result;
    } on DriverApiException catch (error) {
      state = state.copyWith(
        status: error.statusCode == 401
            ? DriverWorkspaceStatus.sessionExpired
            : DriverWorkspaceStatus.unauthenticated,
        message: error.message,
      );
      return null;
    } finally {
      _endFlight('loginWithGoogle');
      state = state.copyWith(isBusy: false);
    }
  }

  /// Langkah 2, dipanggil setelah [loginWithGoogle] mengembalikan
  /// needsPhone: true dan pengguna mengisi nomor HP-nya.
  Future<bool> completeGoogleRegistration({
    required String idToken,
    required String phone,
    String? fullName,
  }) async {
    if (!_startFlight('completeGoogleRegistration')) return false;
    state = state.copyWith(isBusy: true, clearMessage: true);
    try {
      final session = await _repository.completeGoogleRegistration(
        idToken: idToken,
        phone: phone,
        fullName: fullName,
      );
      state = state.copyWith(session: session);
      await refreshWorkspace();
      return true;
    } on DriverApiException catch (error) {
      state = state.copyWith(
        status: error.statusCode == 401
            ? DriverWorkspaceStatus.sessionExpired
            : DriverWorkspaceStatus.unauthenticated,
        message: error.message,
      );
      return false;
    } finally {
      _endFlight('completeGoogleRegistration');
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
      final availability = switch (_repository) {
        DemoDriverRepository demo => demo.currentAvailability,
        _ => state.availability,
      };
      state = state.copyWith(
        status: DriverWorkspaceStatus.active,
        clearActiveRide: true,
        offers: offers,
        availability: availability,
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

  /// Jalur yang dipakai tombol toggle untuk arah offline->online SAJA —
  /// offline tetap memanggil [setAvailability] langsung, tidak butuh
  /// verifikasi wajah.
  ///
  /// SENGAJA tidak lewat _applyCapabilityError/DriverWorkspaceStatus untuk
  /// kondisi "belum verifikasi hari ini": pola itu mengganti SELURUH tampilan
  /// workspace (menyembunyikan tab pesanan/pendapatan/riwayat), cocok untuk
  /// kapabilitas yang benar-benar hilang (suspended/rejected) tapi salah di
  /// sini — driver yang cuma belum sempat swafoto hari ini tetap harus bisa
  /// melihat dashboardnya sendiri selagi offline.
  Future<void> checkAndGoOnline(BuildContext context) async {
    if (!_startFlight('availability')) return;
    try {
      final snapshot = await _repository.faceCheckToday();
      if (snapshot.status == DriverFaceCheckStatus.blocked) {
        state = state.copyWith(
          message: 'Percobaan verifikasi wajah hari ini sudah habis. Hubungi admin TapGo.',
        );
        return;
      }
      if (snapshot.status != DriverFaceCheckStatus.passed) {
        if (!context.mounted) return;
        final passed = await Navigator.of(context).push<bool>(
          MaterialPageRoute(builder: (_) => const DriverFaceCheckScreen()),
        );
        if (passed != true) return;
      }
    } on DriverApiException catch (error) {
      // Flag DRIVER_FACE_CHECK_ENABLED mati di server -> 503 di sini berarti
      // fitur belum aktif sama sekali: lanjut seperti sebelum fitur ini ada,
      // bukan memblokir online karena kondisi yang bukan kesalahan driver.
      if (error.code != 'DRIVER_FACE_CHECK_DISABLED') {
        _applyCapabilityError(error);
        return;
      }
    } finally {
      _endFlight('availability');
    }
    await setAvailability(DriverAvailability.online);
  }

  /// Referensi wajah (embedding, bukan foto) untuk dicocokkan lokal di layar
  /// verifikasi. Passthrough tipis — tidak mengubah state, layar yang
  /// menangani siklus hidup kamera/ML sendiri.
  Future<DriverFaceReferenceEmbedding> faceCheckReference() =>
      _repository.faceCheckReference();

  /// Mengirim hasil yang sudah diputuskan di perangkat. Server menegakkan
  /// ulang ambang batas — lihat DriverFaceCheckService.submitAttempt di
  /// backend.
  Future<DriverFaceCheckSnapshot> submitFaceCheckAttempt({
    required double similarityScore,
    required bool livenessPassed,
    required String modelVersion,
  }) =>
      _repository.submitFaceCheckAttempt(
        similarityScore: similarityScore,
        livenessPassed: livenessPassed,
        modelVersion: modelVersion,
      );

  /// Memuat ulang ringkasan dokumen.
  ///
  /// Kegagalan di sini SENGAJA tidak mengubah status ruang kerja: dokumen
  /// adalah bagian tambahan, dan kendala memuatnya tidak boleh melempar driver
  /// keluar dari layar perjalanannya.
  Future<void> refreshDocuments() async {
    if (!_startFlight('documents')) return;
    try {
      final items = await _repository.documents();
      state = state.copyWith(documents: items);
    } on DriverApiException catch (error) {
      if (error.statusCode == 401) {
        _applyCapabilityError(error);
      } else {
        state = state.copyWith(message: error.message);
      }
    } finally {
      _endFlight('documents');
    }
  }

  Future<void> uploadDocument({
    required DriverDocumentKind kind,
    required Uint8List bytes,
    required String contentType,
  }) async {
    if (!_startFlight('upload-${kind.api}')) return;
    state = state.copyWith(uploadingDocument: kind, clearMessage: true);
    try {
      final items = await _repository.uploadDocument(
        kind: kind,
        bytes: bytes,
        contentType: contentType,
      );
      state = state.copyWith(
        documents: items,
        message: '${kind.label} berhasil dikirim dan menunggu pemeriksaan.',
      );
    } on DriverApiException catch (error) {
      if (error.statusCode == 401) {
        _applyCapabilityError(error);
      } else {
        // Pesan dari lapisan API sudah diterjemahkan menjadi kalimat yang
        // memberi tahu apa yang harus dilakukan; dipakai apa adanya.
        state = state.copyWith(message: error.message);
      }
    } finally {
      _endFlight('upload-${kind.api}');
      state = state.copyWith(clearUploadingDocument: true);
    }
  }

  /// Memuat status pengajuan mitra (H1). Seperti dokumen, kegagalan di sini
  /// tidak mengubah status ruang kerja.
  Future<void> refreshApplication() async {
    if (!_startFlight('application')) return;
    try {
      final snapshot = await _repository.myApplication();
      state = state.copyWith(
        application: snapshot.application,
        clearApplication: snapshot.application == null,
        documentsComplete: snapshot.documentsComplete,
        vehiclePlateMasked: snapshot.vehiclePlateMasked,
        clearVehiclePlate: snapshot.vehiclePlateMasked == null,
      );
    } on DriverApiException catch (error) {
      if (error.statusCode == 401) {
        _applyCapabilityError(error);
      } else {
        state = state.copyWith(message: error.message);
      }
    } finally {
      _endFlight('application');
    }
  }

  Future<void> submitApplication({
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
    if (!_startFlight('application-submit')) return;
    state = state.copyWith(isBusy: true, clearMessage: true);
    try {
      final snapshot = await _repository.submitApplication(
        serviceType: serviceType,
        plateNumber: plateNumber,
        brand: brand,
        model: model,
        color: color,
        fullName: fullName,
        dateOfBirth: dateOfBirth,
        address: address,
        emergencyContactName: emergencyContactName,
        emergencyContactPhone: emergencyContactPhone,
        declarationAccepted: declarationAccepted,
      );
      state = state.copyWith(
        application: snapshot.application,
        documentsComplete: snapshot.documentsComplete,
        vehiclePlateMasked: snapshot.vehiclePlateMasked,
        message: 'Pengajuan terkirim. Tim kami akan meninjaunya.',
      );
    } on DriverApiException catch (error) {
      if (error.statusCode == 401) {
        _applyCapabilityError(error);
      } else {
        state = state.copyWith(message: error.message);
      }
    } finally {
      _endFlight('application-submit');
      state = state.copyWith(isBusy: false);
    }
  }

  Future<void> withdrawApplication() async {
    if (!_startFlight('application-withdraw')) return;
    state = state.copyWith(isBusy: true, clearMessage: true);
    try {
      final snapshot = await _repository.withdrawApplication();
      state = state.copyWith(
        clearApplication: snapshot.application == null,
        application: snapshot.application,
        documentsComplete: snapshot.documentsComplete,
        clearVehiclePlate: snapshot.vehiclePlateMasked == null,
        message: 'Pengajuan ditarik. Anda bisa mengajukan lagi kapan saja.',
      );
    } on DriverApiException catch (error) {
      if (error.statusCode == 401) {
        _applyCapabilityError(error);
      } else {
        state = state.copyWith(message: error.message);
      }
    } finally {
      _endFlight('application-withdraw');
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
    // Pengaman untuk race (mis. hari kalender WIB berganti tepat di antara
    // pengecekan lokal checkAndGoOnline dan setAvailability sungguhan di
    // server) — TIDAK boleh mengubah state.status: tanpa cabang ini kode
    // jatuh ke default networkError, yang salah DAN mengganti seluruh
    // tampilan workspace padahal driver cuma perlu verifikasi ulang.
    if (error.code == 'RIDE_DRIVER_FACE_CHECK_REQUIRED' ||
        error.code == 'RIDE_DRIVER_FACE_CHECK_BLOCKED') {
      state = state.copyWith(message: error.message);
      return;
    }
    _stopPolling();
    final status = switch (error.code) {
      'RIDE_DRIVER_PROFILE_REQUIRED' => DriverWorkspaceStatus.profileRequired,
      'RIDE_DRIVER_NOT_ACTIVE' => DriverWorkspaceStatus.pending,
      'RIDE_DRIVER_SUSPENDED' => DriverWorkspaceStatus.suspended,
      'RIDE_DRIVER_REJECTED' => DriverWorkspaceStatus.rejected,
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
    _startLocationUpdates();
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
    if (mounted) state = state.copyWith(isPolling: false);
    _stopLocationUpdates();
  }

  /// Kirim lokasi berkala selama driver online/punya perjalanan aktif —
  /// tepat mengikuti kondisi yang sama dengan polling tawaran di atas, jadi
  /// dimulai/dihentikan dari titik yang sama (bukan orkestrasi terpisah).
  ///
  /// Detak 5 detik: saat ada perjalanan aktif lokasi dikirim tiap detak agar
  /// penumpang melihat posisi bergerak; saat hanya online tanpa perjalanan,
  /// dikirim tiap 3 detak (15 detik) seperti sebelumnya.
  void _startLocationUpdates() {
    _locationTimer ??= Timer.periodic(
      const Duration(seconds: 5),
      (_) => unawaited(_sendLocationSilently()),
    );
  }

  int _locationTicks = 0;

  void _stopLocationUpdates() {
    _locationTimer?.cancel();
    _locationTimer = null;
  }

  /// Berbeda dari [sendLocationIfAvailable]: dipanggil sendiri oleh timer,
  /// bukan atas permintaan UI, jadi kegagalan (izin ditolak, GPS mati,
  /// jaringan) tidak boleh menulis state.message — itu akan menimpa pesan
  /// lain yang lebih penting (mis. galat tawaran) setiap 15 detik. Lokasi
  /// bersifat best-effort.
  Future<void> _sendLocationSilently() async {
    final ride = state.activeRide;
    final onRide = ride != null && !ride.isTerminal;
    final tick = _locationTicks++;
    if (!onRide && tick % 3 != 0) return;
    try {
      if (!await _locationPort.isAvailable) return;
      await _locationPort.sendCurrentLocation();
    } catch (_) {
      // Diam sengaja — lihat catatan di atas.
    }
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
