part of '../../../main.dart';

/// Verifikasi wajah harian sebelum online — dipush dari
/// [DriverController.checkAndGoOnline], mengembalikan `true` lewat
/// Navigator.pop bila lolos, sebab lain (batal/gagal) dianggap belum lolos.
///
/// Mode demo (kDriverDemoMode) SAMA SEKALI tidak menyentuh camera/
/// google_mlkit_face_detection/tflite_flutter — cabangnya terjadi di awal
/// build(), bukan di dalam pipeline, karena plugin native ini bisa
/// crash/hang tanpa kamera sungguhan (mis. saat flutter test/CI).
class DriverFaceCheckScreen extends ConsumerStatefulWidget {
  const DriverFaceCheckScreen({super.key});

  @override
  ConsumerState<DriverFaceCheckScreen> createState() => _DriverFaceCheckScreenState();
}

enum _Stage { initializing, ready, capturing, blocked, error }

class _DriverFaceCheckScreenState extends ConsumerState<DriverFaceCheckScreen> {
  static const _navy = Color(0xFF061A2F);
  static const _gold = Color(0xFFFFC857);

  CameraController? _camera;
  DriverFaceReferenceEmbedding? _reference;
  final _pipeline = FaceCheckPipeline();

  _Stage _stage = _Stage.initializing;
  String? _errorMessage;
  int _attemptsRemaining = 3;

  @override
  void initState() {
    super.initState();
    if (!kDriverDemoMode) {
      unawaited(_init());
    }
  }

  Future<void> _init() async {
    try {
      final reference = await ref.read(driverControllerProvider.notifier).faceCheckReference();
      final cameras = await availableCameras();
      final front = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );
      final controller = CameraController(front, ResolutionPreset.medium, enableAudio: false);
      await controller.initialize();
      if (!mounted) return;
      setState(() {
        _reference = reference;
        _camera = controller;
        _stage = _Stage.ready;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _stage = _Stage.error;
        _errorMessage = error is DriverApiException
            ? error.message
            : 'Kamera tidak dapat dibuka. Periksa izin kamera lalu coba lagi.';
      });
    }
  }

  @override
  void dispose() {
    unawaited(_camera?.dispose());
    super.dispose();
  }

  Future<void> _captureAndVerify() async {
    final camera = _camera;
    final reference = _reference;
    if (camera == null || reference == null || _stage != _Stage.ready) return;

    setState(() => _stage = _Stage.capturing);
    try {
      final photo = await camera.takePicture();
      final liveness = await _pipeline.checkLiveness(photo.path);
      if (!liveness.passed) {
        if (!mounted) return;
        setState(() {
          _stage = _Stage.ready;
          _errorMessage = liveness.reason;
        });
        return;
      }

      final similarity = await _pipeline.matchSimilarity(
        imagePath: photo.path,
        referenceEmbedding: reference.embedding,
      );

      final snapshot = await ref.read(driverControllerProvider.notifier).submitFaceCheckAttempt(
            similarityScore: similarity,
            livenessPassed: true,
            modelVersion: reference.modelVersion,
          );

      if (!mounted) return;
      if (snapshot.status == DriverFaceCheckStatus.passed) {
        Navigator.of(context).pop(true);
        return;
      }
      if (snapshot.status == DriverFaceCheckStatus.blocked) {
        setState(() => _stage = _Stage.blocked);
        return;
      }
      setState(() {
        _stage = _Stage.ready;
        _attemptsRemaining = snapshot.attemptsRemaining;
        _errorMessage = 'Wajah tidak cocok. Sisa percobaan: ${snapshot.attemptsRemaining}.';
      });
    } on FaceCheckModelUnavailableException {
      if (!mounted) return;
      setState(() {
        _stage = _Stage.error;
        _errorMessage = 'Model verifikasi wajah belum tersedia di aplikasi ini. Hubungi admin TapGo.';
      });
    } on DriverApiException catch (error) {
      if (!mounted) return;
      if (error.code == 'RIDE_DRIVER_FACE_CHECK_BLOCKED') {
        setState(() => _stage = _Stage.blocked);
        return;
      }
      setState(() {
        _stage = _Stage.ready;
        _errorMessage = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _stage = _Stage.ready;
        _errorMessage = 'Verifikasi belum dapat diproses. Coba lagi.';
      });
    }
  }

  Future<void> _submitDemo() async {
    final snapshot = await ref.read(driverControllerProvider.notifier).submitFaceCheckAttempt(
          similarityScore: 1.0,
          livenessPassed: true,
          modelVersion: 'demo',
        );
    if (!mounted) return;
    if (snapshot.status == DriverFaceCheckStatus.passed) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (kDriverDemoMode) return _buildDemo(context);

    return Scaffold(
      backgroundColor: _navy,
      appBar: AppBar(
        backgroundColor: _navy,
        foregroundColor: Colors.white,
        title: const Text('Verifikasi Wajah'),
      ),
      body: switch (_stage) {
        _Stage.initializing => const Center(child: CircularProgressIndicator(color: _gold)),
        _Stage.blocked => _buildBlocked(),
        _Stage.error => _buildError(),
        _Stage.ready || _Stage.capturing => _buildCamera(),
      },
    );
  }

  Widget _buildDemo(BuildContext context) {
    return Scaffold(
      backgroundColor: _navy,
      appBar: AppBar(
        backgroundColor: _navy,
        foregroundColor: Colors.white,
        title: const Text('Verifikasi Wajah'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.face_retouching_natural_rounded, color: _gold, size: 72),
            const SizedBox(height: 16),
            const Text(
              'DATA CONTOH — mode demo, tidak menyentuh kamera atau server sungguhan.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 24),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: _gold,
                foregroundColor: _navy,
                minimumSize: const Size.fromHeight(52),
              ),
              onPressed: _submitDemo,
              child: const Text('Simulasi verifikasi wajah (mode demo)'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCamera() {
    final camera = _camera;
    if (camera == null || !camera.value.isInitialized) {
      return const Center(child: CircularProgressIndicator(color: _gold));
    }
    return Column(
      children: [
        Expanded(
          child: Stack(
            fit: StackFit.expand,
            children: [
              CameraPreview(camera),
              Center(
                child: Container(
                  width: 220,
                  height: 280,
                  decoration: BoxDecoration(
                    border: Border.all(color: _gold, width: 3),
                    borderRadius: BorderRadius.circular(140),
                  ),
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              if (_errorMessage != null) ...[
                Text(
                  _errorMessage!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.amberAccent),
                ),
                const SizedBox(height: 12),
              ],
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: _gold,
                  foregroundColor: _navy,
                  minimumSize: const Size.fromHeight(52),
                ),
                onPressed: _stage == _Stage.capturing ? null : _captureAndVerify,
                icon: _stage == _Stage.capturing
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: _navy),
                      )
                    : const Icon(Icons.camera_alt_rounded),
                label: Text(_stage == _Stage.capturing ? 'Memeriksa…' : 'Ambil Foto'),
              ),
              const SizedBox(height: 8),
              Text(
                'Sisa percobaan hari ini: $_attemptsRemaining',
                style: const TextStyle(color: Colors.white54, fontSize: 12),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildBlocked() {
    return const Padding(
      padding: EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.lock_clock_rounded, color: _gold, size: 72),
          SizedBox(height: 16),
          Text(
            'Percobaan verifikasi wajah hari ini sudah habis.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16),
          ),
          SizedBox(height: 8),
          Text(
            'Hubungi admin TapGo untuk membuka kembali, atau coba lagi besok.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white70),
          ),
        ],
      ),
    );
  }

  Widget _buildError() {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline_rounded, color: _gold, size: 72),
          const SizedBox(height: 16),
          Text(
            _errorMessage ?? 'Verifikasi belum dapat diproses.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white),
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            style: OutlinedButton.styleFrom(foregroundColor: Colors.white),
            onPressed: _retry,
            child: const Text('Coba lagi'),
          ),
        ],
      ),
    );
  }

  void _retry() {
    setState(() {
      _stage = _Stage.initializing;
      _errorMessage = null;
    });
    unawaited(_init());
  }
}
