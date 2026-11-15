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

/// Satu-satunya jalur membaca pengumuman (dipakai penyedia untuk titik merah dan layar saat dibuka).
Future<TapGoAnnouncementFeed> _tapGoLoadAnnouncements(
    String? accessToken) async {
  final loader = tapGoAnnouncementsLoaderForTests;
  if (loader != null) {
    return TapGoAnnouncementFeed.parse(await loader());
  }
  if (tapGoDashboardVisualFixtureEnabledForTests) {
    return const TapGoAnnouncementFeed();
  }
  if (accessToken == null || accessToken.isEmpty) {
    return const TapGoAnnouncementFeed();
  }
  _apiClient.setAccessToken(accessToken);
  return TapGoAnnouncementFeed.parse(await _apiClient.announcements());
}

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
