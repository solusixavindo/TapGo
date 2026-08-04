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
