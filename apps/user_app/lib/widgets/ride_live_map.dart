part of '../main.dart';

/// Peta perjalanan hidup: titik jemput, tujuan, rute ke depan (bila server
/// mengirim), dan posisi driver yang bergerak halus di antara pembaruan.
///
/// Kamera mengikuti driver sampai pengguna menggeser peta sendiri; tombol
/// "Pusatkan" mengembalikannya.
class _RideLiveMap extends StatefulWidget {
  const _RideLiveMap({
    required this.pickup,
    required this.dropoff,
    required this.fix,
    required this.isCar,
  });

  final LatLng pickup;
  final LatLng dropoff;
  final RideDriverFix? fix;
  final bool isCar;

  @override
  State<_RideLiveMap> createState() => _RideLiveMapState();
}

class _RideLiveMapState extends State<_RideLiveMap>
    with SingleTickerProviderStateMixin {
  final MapController _controller = MapController();
  late final AnimationController _move = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  );
  LatLng? _from;
  LatLng? _to;
  bool _follow = true;
  bool _mapReady = false;

  LatLng? get _driver {
    final to = _to;
    if (to == null) {
      return null;
    }
    final from = _from ?? to;
    final t = Curves.easeOutCubic.transform(_move.value);
    return LatLng(
      from.latitude + (to.latitude - from.latitude) * t,
      from.longitude + (to.longitude - from.longitude) * t,
    );
  }

  LatLng get _target =>
      widget.fix?.toDropoff == true ? widget.dropoff : widget.pickup;

  @override
  void initState() {
    super.initState();
    _to = widget.fix?.point;
    _move.value = 1;
  }

  @override
  void didUpdateWidget(covariant _RideLiveMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final next = widget.fix?.point;
    if (next == null) {
      return;
    }
    if (_to == null) {
      _to = next;
      _from = next;
      _move.value = 1;
    } else if (_to != next) {
      _from = _driver ?? _to;
      _to = next;
      if (!_TapGoMotion.reduce(context)) {
        _move
          ..value = 0
          ..forward();
      } else {
        _move.value = 1;
      }
    }
    _refit();
  }

  @override
  void dispose() {
    _move.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _refit() {
    if (!_follow || !_mapReady) {
      return;
    }
    final driver = _to;
    final points = [
      if (driver != null) driver,
      _target,
    ];
    if (points.length < 2) {
      return;
    }
    _controller.fitCamera(
      CameraFit.coordinates(
        coordinates: points,
        padding: const EdgeInsets.all(56),
        maxZoom: 17,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final fix = widget.fix;
    final route = fix?.routePolyline == null
        ? const <LatLng>[]
        : tapGoDecodePolyline(fix!.routePolyline!);
    final all = <LatLng>[
      widget.pickup,
      widget.dropoff,
      if (_to != null) _to!,
    ];
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: SizedBox(
        height: 240,
        child: Stack(
          children: [
            Positioned.fill(
              child: AnimatedBuilder(
                animation: _move,
                builder: (context, _) {
                  final driver = _driver;
                  return FlutterMap(
                    mapController: _controller,
                    options: MapOptions(
                      initialCameraFit: CameraFit.bounds(
                        bounds: LatLngBounds.fromPoints(all),
                        padding: const EdgeInsets.all(56),
                        maxZoom: 17,
                      ),
                      onMapReady: () {
                        _mapReady = true;
                        _refit();
                      },
                      onPositionChanged: (camera, hasGesture) {
                        if (hasGesture && _follow) {
                          setState(() => _follow = false);
                        }
                      },
                    ),
                    children: [
                      // Uji tidak boleh menembak server tile sungguhan.
                      if (!_tapGoRunningUnderTest)
                        TileLayer(
                          urlTemplate:
                              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                          userAgentPackageName: 'com.xavindo.tapgo',
                        ),
                      if (route.length > 1)
                        PolylineLayer(
                          polylines: [
                            Polyline(
                              points: route,
                              strokeWidth: 5,
                              color: _brandBlue.withValues(alpha: 0.85),
                            ),
                          ],
                        ),
                      MarkerLayer(
                        markers: [
                          Marker(
                            point: widget.pickup,
                            width: 30,
                            height: 30,
                            child: const Icon(
                              Icons.trip_origin_rounded,
                              size: 22,
                              color: Color(0xFF16A66A),
                            ),
                          ),
                          Marker(
                            point: widget.dropoff,
                            width: 32,
                            height: 32,
                            child: const Icon(
                              Icons.location_on_rounded,
                              size: 30,
                              color: Color(0xFFEC3F54),
                            ),
                          ),
                          if (driver != null)
                            Marker(
                              point: driver,
                              width: 44,
                              height: 44,
                              child: Opacity(
                                opacity: fix?.stale == true ? 0.45 : 1,
                                child: Container(
                                  decoration: BoxDecoration(
                                    color: _brandBlue,
                                    shape: BoxShape.circle,
                                    border: Border.all(
                                      color: Colors.white,
                                      width: 3,
                                    ),
                                    boxShadow: const [
                                      BoxShadow(
                                        color: Color(0x55000000),
                                        blurRadius: 8,
                                        offset: Offset(0, 3),
                                      ),
                                    ],
                                  ),
                                  child: Icon(
                                    widget.isCar
                                        ? Icons.local_taxi_rounded
                                        : Icons.two_wheeler_rounded,
                                    color: Colors.white,
                                    size: 22,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ],
                  );
                },
              ),
            ),
            const Positioned(
              left: 0,
              bottom: 0,
              child: TapGoMapAttributionButton(),
            ),
            if (!_follow)
              Positioned(
                right: 10,
                bottom: 10,
                child: FloatingActionButton.small(
                  heroTag: null,
                  tooltip: 'Pusatkan peta',
                  backgroundColor: Colors.white,
                  foregroundColor: _brandBlue,
                  onPressed: () {
                    setState(() => _follow = true);
                    _refit();
                  },
                  child: const Icon(Icons.my_location_rounded),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
