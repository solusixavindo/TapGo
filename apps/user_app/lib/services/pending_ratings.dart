part of '../main.dart';

/// Penilaian yang BELUM terkirim (server belum menyediakan route penilaian,
/// jaringan putus, atau galat sementara). Disimpan di perangkat (penyimpanan
/// aman yang sama dengan sesi) dan dikirim ulang otomatis, sehingga penumpang
/// tidak pernah melihat galat merah untuk sesuatu yang bukan salahnya. Dihapus
/// saat keluar akun.
class TapGoPendingRating {
  const TapGoPendingRating({
    required this.reference,
    required this.stars,
    this.note,
  });

  final String reference;
  final int stars;
  final String? note;

  Map<String, dynamic> toJson() => {
        'reference': reference,
        'stars': stars,
        if (note != null) 'note': note,
      };

  static TapGoPendingRating? tryFromJson(Object? json) {
    if (json is! Map) return null;
    final reference = json['reference'];
    final stars = json['stars'];
    if (reference is! String ||
        !_rideReferencePattern.hasMatch(reference) ||
        stars is! num ||
        stars < 1 ||
        stars > 5 ||
        stars != stars.toInt()) {
      return null;
    }
    final note = json['note'];
    return TapGoPendingRating(
      reference: reference,
      stars: stars.toInt(),
      note: note is String && note.trim().isNotEmpty ? note.trim() : null,
    );
  }
}

class _TapGoPendingRatingsStore {
  _TapGoPendingRatingsStore()
      : _storage = const FlutterSecureStorage(
          aOptions: AndroidOptions(encryptedSharedPreferences: true),
        );

  static const _key = 'tapgo.ride.pending_ratings.v1';
  static const _limit = 20;
  final FlutterSecureStorage _storage;

  /// Saat uji (penyimpanan dimatikan) disimpan di memori proses.
  static List<TapGoPendingRating> _memory = [];

  Future<List<TapGoPendingRating>> load() async {
    if (tapGoDisablePersistenceForTests) return List.of(_memory);
    try {
      final raw = await _storage.read(key: _key);
      if (raw == null || raw.isEmpty) return [];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return [];
      return [
        for (final item in decoded)
          if (TapGoPendingRating.tryFromJson(item) case final rating?) rating,
      ];
    } catch (_) {
      return [];
    }
  }

  Future<void> _save(List<TapGoPendingRating> items) async {
    if (tapGoDisablePersistenceForTests) {
      _memory = items;
      return;
    }
    try {
      if (items.isEmpty) {
        await _storage.delete(key: _key);
      } else {
        await _storage.write(
          key: _key,
          value: jsonEncode(items.map((e) => e.toJson()).toList()),
        );
      }
    } catch (_) {}
  }

  /// Satu penilaian per perjalanan: yang baru menggantikan yang lama.
  Future<void> enqueue(TapGoPendingRating rating) async {
    final next = [
      for (final item in await load())
        if (item.reference != rating.reference) item,
      rating,
    ];
    await _save(next.length > _limit ? next.sublist(next.length - _limit) : next);
  }

  Future<void> remove(String reference) async =>
      _save([for (final i in await load()) if (i.reference != reference) i]);

  Future<void> clear() async {
    _memory = [];
    if (tapGoDisablePersistenceForTests) return;
    try {
      await _storage.delete(key: _key);
    } catch (_) {}
  }
}

final _pendingRatingsStore = _TapGoPendingRatingsStore();

/// Pintu uji untuk antrean penilaian.
@visibleForTesting
class TapGoPendingRatingsProbe {
  static Future<List<TapGoPendingRating>> load() => _pendingRatingsStore.load();
  static Future<void> enqueue(TapGoPendingRating r) => _pendingRatingsStore.enqueue(r);
  static Future<void> clear() => _pendingRatingsStore.clear();
}

/// Apa yang dilakukan pada kegagalan mengirim penilaian.
enum TapGoRatingFailure {
  /// Coba lagi nanti: route belum ada di server, jaringan, 429, 5xx.
  retryLater,

  /// Server sudah punya penilaian untuk perjalanan ini: selesai.
  alreadyDone,

  /// Permintaan tidak akan pernah berhasil (data tidak sah, bukan milik akun,
  /// perjalanan belum selesai): buang dari antrean.
  drop,

  /// Sesi berakhir: simpan dan hentikan pengiriman sampai login lagi.
  sessionExpired,
}

TapGoRatingFailure tapGoRatingFailureOf(Object error) {
  if (tapGoRideIsSessionExpired(error)) return TapGoRatingFailure.sessionExpired;
  if (error is DioException) {
    final response = error.response;
    if (response == null) return TapGoRatingFailure.retryLater;
    final status = response.statusCode ?? 0;
    final code = _authResponseDataMap(response.data)?['code']?.toString();
    if (code == 'RIDE_RATING_ALREADY_SUBMITTED') return TapGoRatingFailure.alreadyDone;
    if (code == 'ROUTE_NOT_FOUND') return TapGoRatingFailure.retryLater;
    if (status == 429 || status >= 500) return TapGoRatingFailure.retryLater;
    if (status == 400 || status == 403 || status == 404 || status == 409) {
      return TapGoRatingFailure.drop;
    }
  }
  return TapGoRatingFailure.retryLater;
}

bool _tapGoFlushingRatings = false;

/// Mengirim ulang penilaian yang menunggu. Mengembalikan jumlah yang terkirim
/// atau dianggap selesai. Aman dipanggil berulang (tidak tumpang-tindih).
Future<int> tapGoFlushPendingRatings({RideRatingRequest? request}) async {
  if (_tapGoFlushingRatings) return 0;
  _tapGoFlushingRatings = true;
  var done = 0;
  try {
    final send = request ?? _apiClient.rateRide;
    for (final item in await _pendingRatingsStore.load()) {
      try {
        await send(reference: item.reference, stars: item.stars, note: item.note);
        await _pendingRatingsStore.remove(item.reference);
        done += 1;
      } catch (error) {
        switch (tapGoRatingFailureOf(error)) {
          case TapGoRatingFailure.alreadyDone:
          case TapGoRatingFailure.drop:
            await _pendingRatingsStore.remove(item.reference);
            done += 1;
          case TapGoRatingFailure.sessionExpired:
            return done;
          case TapGoRatingFailure.retryLater:
            // Server belum siap: berhenti, coba lagi pada putaran berikutnya.
            return done;
        }
      }
    }
  } finally {
    _tapGoFlushingRatings = false;
  }
  return done;
}

/// Mengirim ulang penilaian yang menunggu selama pengguna masuk: sekali tak lama
/// setelah dashboard tampil, lalu tiap 90 detik. Tidak berjalan di uji.
class _PendingRatingsFlusher extends StatefulWidget {
  const _PendingRatingsFlusher({required this.child});

  final Widget child;

  @override
  State<_PendingRatingsFlusher> createState() => _PendingRatingsFlusherState();
}

class _PendingRatingsFlusherState extends State<_PendingRatingsFlusher> {
  Timer? _first;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    if (_tapGoRunningUnderTest) return;
    _first = Timer(const Duration(seconds: 4), () => unawaited(tapGoFlushPendingRatings()));
    _timer = Timer.periodic(
      const Duration(seconds: 90),
      (_) => unawaited(tapGoFlushPendingRatings()),
    );
  }

  @override
  void dispose() {
    _first?.cancel();
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Tag cepat penilaian (gaya aplikasi ojek): positif untuk 4-5 bintang, keluhan
/// untuk 1-3 bintang.
List<String> tapGoRatingTags(int stars) => stars >= 4
    ? const ['Ramah', 'Tepat waktu', 'Berkendara aman', 'Kendaraan bersih', 'Rute tepat']
    : stars >= 1
        ? const [
            'Kurang ramah',
            'Terlambat',
            'Berkendara kurang aman',
            'Kendaraan kurang bersih',
            'Rute kurang tepat',
          ]
        : const [];

/// Catatan yang dikirim ke server: tag terpilih lalu catatan bebas, maksimal 280
/// karakter (batas server).
String? tapGoComposeRatingNote(Iterable<String> tags, String note) {
  final parts = <String>[
    if (tags.isNotEmpty) tags.join(', '),
    if (note.trim().isNotEmpty) note.trim(),
  ];
  if (parts.isEmpty) return null;
  final text = parts.join(' - ');
  return text.length <= 280 ? text : text.substring(0, 280);
}
