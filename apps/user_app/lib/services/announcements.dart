part of '../main.dart';

/// Satu pengumuman pemilik TapGo yang tampil di ikon bel (dari GET /announcements).
///
/// Isinya SELALU teks polos: server menolak tautan, dan layar menampilkannya sebagai [Text] biasa
/// (bukan SelectableText/tautan yang dapat diketuk), sehingga pengumuman tidak dapat dipakai menyebar tautan.
class TapGoAnnouncement {
  const TapGoAnnouncement({
    required this.id,
    required this.title,
    required this.body,
    required this.unread,
    this.publishedAt,
  });

  final String id;
  final String title;
  final String body;
  final bool unread;
  final DateTime? publishedAt;

  /// Ucapan selamat datang bawaan aplikasi (bukan dari server).
  bool get isWelcome => id == kTapGoWelcomeAnnouncementId;

  static TapGoAnnouncement? tryParse(Object? value) {
    if (value is! Map) return null;
    final id = value['id'];
    final title = value['title'];
    final body = value['body'];
    if (id is! String || id.isEmpty) return null;
    if (title is! String || title.trim().isEmpty) return null;
    if (body is! String || body.trim().isEmpty) return null;
    final published = value['publishedAt'];
    return TapGoAnnouncement(
      id: id,
      title: title,
      body: body,
      unread: value['unread'] == true,
      publishedAt:
          published is String ? DateTime.tryParse(published)?.toLocal() : null,
    );
  }
}

class TapGoAnnouncementFeed {
  const TapGoAnnouncementFeed({
    this.items = const [],
    this.unreadCount = 0,
  });

  final List<TapGoAnnouncement> items;
  final int unreadCount;

  /// Jawaban server yang rusak atau tak lengkap tidak boleh merusak layar: item yang cacat dilewati.
  static TapGoAnnouncementFeed parse(Map<String, dynamic> data) {
    final rawItems = data['items'];
    final items = [
      if (rawItems is List)
        for (final row in rawItems)
          if (TapGoAnnouncement.tryParse(row) case final item?) item,
    ];
    final count = data['unreadCount'];
    final unread = count is num
        ? count.toInt()
        : items.where((item) => item.unread).length;
    return TapGoAnnouncementFeed(
      items: items,
      unreadCount: unread < 0 ? 0 : unread,
    );
  }
}

/// Seam uji: mengganti pembacaan pengumuman dari server.
@visibleForTesting
Future<Map<String, dynamic>> Function()? tapGoAnnouncementsLoaderForTests;

// ---------------------------------------------------------------------------------------------------------------------
// Ucapan selamat datang untuk pengguna yang BARU memasang aplikasi (permintaan Owner 16 Nov 2026).
//
// Bukan pengumuman dari server: ini bawaan aplikasi, tampil di daftar pengumuman (ikon bel) dengan titik merah sampai
// dibuka. Hanya untuk INSTALASI BARU: saat versi ini pertama kali berjalan, penanda "reset awal" yang ditulis setiap
// instalasi lama sudah ada, sedangkan instalasi baru belum punya; dari situ pengguna lama yang hanya memperbarui
// aplikasi tidak ikut menerima ucapan "selamat datang". Teks tanpa tautan (aturan yang sama dengan pengumuman server).
// ---------------------------------------------------------------------------------------------------------------------

const String kTapGoWelcomeAnnouncementId = 'local-welcome';
const String kTapGoWelcomeTitle = 'Selamat datang di TapGo!';
const String kTapGoWelcomeBody =
    'Terima kasih sudah memasang TapGo. Dari satu aplikasi Anda bisa memesan ojek, membayar tagihan dan pulsa, '
    'serta mengisi Saldo TapGo.\n\n'
    'Untuk memulai: lengkapi profil Anda di menu Akun, lalu coba pesan perjalanan pertama Anda dari Beranda.\n\n'
    'Butuh bantuan? Buka Akun > Tiket Bantuan atau tab Chat. Kabar penting dari TapGo akan selalu muncul di sini, '
    'di ikon bel.';

/// pending = instalasi baru dan belum dibuka; read = sudah dibuka (tetap tampil sebagai pengumuman lama);
/// none = pengguna lama yang memperbarui aplikasi, atau build non-produksi: tidak ada ucapan.
enum TapGoWelcomeState { pending, read, none }

/// Tempat status disimpan. Produksi memakai SharedPreferences; uji memakai versi di memori.
abstract class TapGoWelcomeStorage {
  Future<String?> readState();
  Future<int?> readInstalledAtMillis();
  Future<void> writeState(String state, {int? installedAtMillis});
}

class _PrefsWelcomeStorage implements TapGoWelcomeStorage {
  _PrefsWelcomeStorage(this._preferences);
  final SharedPreferences _preferences;

  static const stateKey = 'tapgo.welcome.state';
  static const installedAtKey = 'tapgo.welcome.installedAt';

  @override
  Future<String?> readState() async => _preferences.getString(stateKey);

  @override
  Future<int?> readInstalledAtMillis() async =>
      _preferences.getInt(installedAtKey);

  @override
  Future<void> writeState(String state, {int? installedAtMillis}) async {
    await _preferences.setString(stateKey, state);
    if (installedAtMillis != null) {
      await _preferences.setInt(installedAtKey, installedAtMillis);
    }
  }
}

/// Tanpa penyimpanan: tidak ada ucapan (dipakai uji lama dan layar tanpa persistensi).
class _NoWelcomeStorage implements TapGoWelcomeStorage {
  @override
  Future<String?> readState() async => null;
  @override
  Future<int?> readInstalledAtMillis() async => null;
  @override
  Future<void> writeState(String state, {int? installedAtMillis}) async {}
}

@visibleForTesting
TapGoWelcomeStorage? tapGoWelcomeStorageForTests;

Future<TapGoWelcomeStorage> _tapGoWelcomeStorage() async {
  final override = tapGoWelcomeStorageForTests;
  if (override != null) return override;
  if (tapGoDisablePersistenceForTests) return _NoWelcomeStorage();
  try {
    return _PrefsWelcomeStorage(await SharedPreferences.getInstance());
  } catch (_) {
    return _NoWelcomeStorage();
  }
}

/// Dicatat SEKALI per instalasi, sebelum penanda "reset awal" ditulis. [hadPreviousInstall] = penanda itu sudah ada.
@visibleForTesting
Future<void> tapGoRecordInstallKind(
  TapGoWelcomeStorage storage, {
  required bool hadPreviousInstall,
  DateTime? now,
}) async {
  if (await storage.readState() != null) return;
  await storage.writeState(
    hadPreviousInstall
        ? TapGoWelcomeState.none.name
        : TapGoWelcomeState.pending.name,
    installedAtMillis: (now ?? DateTime.now()).millisecondsSinceEpoch,
  );
}

Future<TapGoAnnouncement?> _tapGoWelcomeAnnouncement() async {
  try {
    final storage = await _tapGoWelcomeStorage();
    final state = await storage.readState();
    if (state != TapGoWelcomeState.pending.name &&
        state != TapGoWelcomeState.read.name) {
      return null;
    }
    final installedAt = await storage.readInstalledAtMillis();
    return TapGoAnnouncement(
      id: kTapGoWelcomeAnnouncementId,
      title: kTapGoWelcomeTitle,
      body: kTapGoWelcomeBody,
      unread: state == TapGoWelcomeState.pending.name,
      publishedAt: installedAt == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(installedAt),
    );
  } catch (_) {
    return null;
  }
}

/// Dipanggil saat layar pengumuman dibuka: ucapan selamat datang dianggap sudah dibaca.
Future<void> _tapGoMarkWelcomeRead() async {
  try {
    final storage = await _tapGoWelcomeStorage();
    if (await storage.readState() == TapGoWelcomeState.pending.name) {
      await storage.writeState(TapGoWelcomeState.read.name);
    }
  } catch (_) {
    // Gagal menyimpan tidak boleh mengganggu layar; ucapan tampil sebagai baru lagi pada pembukaan berikutnya.
  }
}

/// Menggabungkan ucapan selamat datang ke daftar server: di paling atas selama belum dibaca, sesudah itu urut menurut waktu.
Future<TapGoAnnouncementFeed> _tapGoWithWelcome(
  TapGoAnnouncementFeed feed,
) async {
  final welcome = await _tapGoWelcomeAnnouncement();
  if (welcome == null) return feed;
  final items = <TapGoAnnouncement>[
    if (welcome.unread) welcome,
    ...feed.items,
  ];
  if (!welcome.unread) {
    final at = welcome.publishedAt;
    var index = items.length;
    if (at != null) {
      index = items.indexWhere(
        (item) => (item.publishedAt ?? DateTime(1970)).isBefore(at),
      );
      if (index < 0) index = items.length;
    }
    items.insert(index, welcome);
  }
  return TapGoAnnouncementFeed(
    items: items,
    unreadCount: feed.unreadCount + (welcome.unread ? 1 : 0),
  );
}

/// Satu-satunya jalur membaca pengumuman (dipakai penyedia untuk titik merah dan layar saat dibuka).
Future<TapGoAnnouncementFeed> _tapGoLoadAnnouncements(
    String? accessToken) async {
  final loader = tapGoAnnouncementsLoaderForTests;
  if (loader != null) {
    return _tapGoWithWelcome(TapGoAnnouncementFeed.parse(await loader()));
  }
  if (tapGoDashboardVisualFixtureEnabledForTests) {
    return const TapGoAnnouncementFeed();
  }
  if (accessToken == null || accessToken.isEmpty) {
    return const TapGoAnnouncementFeed();
  }
  _apiClient.setAccessToken(accessToken);
  return _tapGoWithWelcome(
    TapGoAnnouncementFeed.parse(await _apiClient.announcements()),
  );
}

/// Celah uji: memuat daftar lewat jalur yang sama dengan penyedia (termasuk ucapan selamat datang).
@visibleForTesting
Future<TapGoAnnouncementFeed> tapGoLoadAnnouncementsForTests([
  String? accessToken,
]) =>
    _tapGoLoadAnnouncements(accessToken ?? 'token-uji');

/// Pengumuman milik akun yang sedang masuk. Dibersihkan saat sesi berganti (lihat TapGoUserApp) dan
/// disegarkan berkala oleh [_AnnouncementPoller]; titik merah pada ikon bel membacanya.
final _announcementsProvider = FutureProvider<TapGoAnnouncementFeed>((ref) {
  return _tapGoLoadAnnouncements(ref.read(_demoSessionProvider).accessToken);
});

/// Selang pembaruan jumlah belum dibaca selama aplikasi terbuka. Murah: satu permintaan kecil.
const tapGoAnnouncementPollInterval = Duration(seconds: 60);

/// Menyegarkan pengumuman selama aplikasi terbuka dan sudah masuk, supaya titik merah di bel muncul tanpa
/// pengguna harus membuka ulang aplikasi. Tidak berjalan saat aplikasi di latar belakang.
class _AnnouncementPoller extends ConsumerStatefulWidget {
  const _AnnouncementPoller({required this.child});

  final Widget child;

  @override
  ConsumerState<_AnnouncementPoller> createState() =>
      _AnnouncementPollerState();
}

class _AnnouncementPollerState extends ConsumerState<_AnnouncementPoller>
    with WidgetsBindingObserver {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    if (_tapGoRunningUnderTest) return;
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(tapGoAnnouncementPollInterval, (_) => _refresh());
  }

  void _refresh() {
    if (!mounted) return;
    final state = WidgetsBinding.instance.lifecycleState;
    if (state == null || state == AppLifecycleState.resumed) {
      ref.invalidate(_announcementsProvider);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Kembali ke aplikasi: segarkan segera, jangan menunggu detak berikutnya.
    if (state == AppLifecycleState.resumed) _refresh();
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

const _tapGoMonthShort = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

/// "15 Nov 2026, 21.25" dalam waktu setempat; kosong bila waktu tidak diketahui.
String tapGoAnnouncementDateLabel(DateTime? at) {
  if (at == null) return '';
  String two(int value) => value.toString().padLeft(2, '0');
  return '${at.day} ${_tapGoMonthShort[at.month - 1]} ${at.year}, '
      '${two(at.hour)}.${two(at.minute)}';
}
