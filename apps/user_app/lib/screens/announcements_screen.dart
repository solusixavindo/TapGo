part of '../main.dart';

/// Layar ikon bel: pengumuman dari pemilik TapGo (teks polos, tidak ada tautan yang dapat diketuk).
///
/// Penanda "Baru" mengikuti keadaan SAAT layar dibuka; begitu terbuka, server diberi tahu (POST /announcements/seen)
/// dan titik merah di bel padam, tetapi penanda di layar ini tetap tampil sampai pengguna menutupnya.
class AnnouncementsScreen extends ConsumerStatefulWidget {
  const AnnouncementsScreen({super.key});

  @override
  ConsumerState<AnnouncementsScreen> createState() =>
      _AnnouncementsScreenState();
}

class _AnnouncementsScreenState extends ConsumerState<AnnouncementsScreen> {
  TapGoAnnouncementFeed? _feed;
  bool _loading = true;
  bool _failed = false;
  bool _markedSeen = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final feed = await _tapGoLoadAnnouncements(
        ref.read(_demoSessionProvider).accessToken,
      );
      if (!mounted) return;
      setState(() {
        _feed = feed;
        _loading = false;
      });
      final welcomeUnread = feed.items.any((i) => i.isWelcome && i.unread);
      final serverUnread = feed.unreadCount - (welcomeUnread ? 1 : 0);
      if ((serverUnread > 0 || welcomeUnread) && !_markedSeen) {
        _markedSeen = true;
        unawaited(
          _markSeen(markServer: serverUnread > 0, markWelcome: welcomeUnread),
        );
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _failed = true;
        _loading = false;
      });
    }
  }

  /// Gagal menandai tidak mengganggu pembacaan; dicoba lagi saat layar dibuka berikutnya.
  Future<void> _markSeen({
    required bool markServer,
    required bool markWelcome,
  }) async {
    if (markWelcome) await _tapGoMarkWelcomeRead();
    if (markServer) {
      try {
        await _apiClient.markAnnouncementsSeen();
      } catch (_) {
        _markedSeen = false;
      }
    }
    if (mounted) ref.invalidate(_announcementsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final feed = _feed;
    return _DemoScaffold(
      title: 'Pengumuman',
      subtitle: 'Kabar terbaru dari TapGo',
      child: _loading && feed == null
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(
                child: CircularProgressIndicator(
                  key: ValueKey('announcements_loading'),
                ),
              ),
            )
          : _failed && feed == null
              ? _RetryStatusSurface(
                  icon: Icons.cloud_off_rounded,
                  title: 'Pengumuman belum dapat dimuat',
                  subtitle: 'Periksa koneksi internet Anda lalu coba lagi.',
                  onRetry: _load,
                )
              : feed == null || feed.items.isEmpty
                  ? const _AnnouncementsEmpty()
                  : Column(
                      key: const ValueKey('announcements_list'),
                      children: [
                        for (final item in feed.items)
                          _AnnouncementCard(item: item),
                      ],
                    ),
    );
  }
}

class _AnnouncementsEmpty extends StatelessWidget {
  const _AnnouncementsEmpty();

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      key: const ValueKey('announcements_empty'),
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 36),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Column(
        children: [
          Icon(
            Icons.notifications_none_rounded,
            size: 44,
            color: colorScheme.onSurfaceVariant,
          ),
          const SizedBox(height: 12),
          Text(
            'Belum ada pengumuman',
            style: TextStyle(
              color: colorScheme.onSurface,
              fontSize: 16,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Kabar penting dari TapGo akan muncul di sini.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _AnnouncementCard extends StatelessWidget {
  const _AnnouncementCard({required this.item});

  final TapGoAnnouncement item;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final date = tapGoAnnouncementDateLabel(item.publishedAt);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: item.unread ? colorScheme.primary : colorScheme.outlineVariant,
          width: item.unread ? 1.5 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  item.title,
                  style: TextStyle(
                    color: colorScheme.onSurface,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (item.unread) ...[
                const SizedBox(width: 8),
                Container(
                  key: ValueKey('announcement_new_${item.id}'),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: colorScheme.primary,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    'Baru',
                    style: TextStyle(
                      color: colorScheme.onPrimary,
                      fontSize: 11,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ],
          ),
          if (date.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              date,
              style: TextStyle(
                color: colorScheme.onSurfaceVariant,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
          const SizedBox(height: 10),
          // Teks polos: sengaja bukan SelectableText dan tanpa pengenal tautan.
          Text(
            item.body,
            style: TextStyle(
              color: colorScheme.onSurface,
              height: 1.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
