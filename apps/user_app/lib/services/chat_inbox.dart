part of '../main.dart';

/// Satu percakapan chat perjalanan pada kotak masuk (dari GET /chat/conversations).
class TapGoChatConversation {
  const TapGoChatConversation({
    required this.rideReference,
    required this.status,
    required this.canSend,
    required this.unreadCount,
    this.lastText,
    this.lastFromMe = false,
    this.lastAt,
  });

  final String rideReference;
  final String status;

  /// false = hanya bisa dibaca (perjalanan sudah selesai lebih dari 2 jam).
  final bool canSend;
  final int unreadCount;
  final String? lastText;
  final bool lastFromMe;
  final DateTime? lastAt;

  bool get isActive => status != 'COMPLETED';

  static TapGoChatConversation? tryParse(Object? value, {required bool asPassenger}) {
    if (value is! Map) return null;
    final reference = value['rideReference'];
    if (reference is! String || reference.isEmpty) return null;
    final last = value['lastMessage'];
    final lastMap = last is Map ? last : null;
    final senderType = lastMap?['senderType'];
    return TapGoChatConversation(
      rideReference: reference,
      status: value['status']?.toString() ?? '',
      canSend: value['canSend'] == true,
      unreadCount: value['unreadCount'] is num
          ? (value['unreadCount'] as num).toInt()
          : 0,
      lastText: lastMap?['text']?.toString(),
      lastFromMe: asPassenger ? senderType == 'USER' : senderType == 'DRIVER',
      lastAt: lastMap?['createdAt'] is String
          ? DateTime.tryParse(lastMap!['createdAt'] as String)?.toLocal()
          : null,
    );
  }
}

/// Kotak masuk chat perjalanan. Dibersihkan saat sesi berganti (lihat
/// TapGoUserApp) dan disegarkan berkala oleh [_ChatInboxPoller].
/// Seam uji: mengganti pembacaan kotak masuk dari server.
@visibleForTesting
Future<List<Map<String, dynamic>>> Function()? tapGoChatConversationsLoaderForTests;

final _chatConversationsProvider =
    FutureProvider<List<TapGoChatConversation>>((ref) async {
  final loader = tapGoChatConversationsLoaderForTests;
  if (loader != null) {
    return [
      for (final row in await loader())
        if (TapGoChatConversation.tryParse(row, asPassenger: true)
            case final conversation?)
          conversation,
    ];
  }
  if (tapGoDashboardVisualFixtureEnabledForTests) {
    return const [];
  }
  final session = ref.read(_demoSessionProvider);
  final token = session.accessToken;
  if (token == null || token.isEmpty) {
    return const [];
  }
  _apiClient.setAccessToken(token);
  final rows = await _apiClient.chatConversations();
  return [
    for (final row in rows)
      if (TapGoChatConversation.tryParse(row, asPassenger: true)
          case final conversation?)
        conversation,
  ];
});

/// Jumlah pesan lawan bicara yang belum dibaca di semua percakapan.
int _tapGoUnreadChatCount(AsyncValue<List<TapGoChatConversation>> value) {
  return (value.valueOrNull ?? const <TapGoChatConversation>[])
      .fold<int>(0, (sum, item) => sum + item.unreadCount);
}

/// Selang pembaruan kotak masuk: cepat (6 detik) selama ada percobaan chat
/// yang masih dapat dibalas (perjalanan berjalan), lambat (30 detik) bila tidak.
/// Murah: satu permintaan ke GET /chat/conversations.
Duration tapGoChatInboxDelay(List<TapGoChatConversation>? latest) {
  final hasLiveChat =
      latest?.any((c) => c.isActive && c.canSend) ?? false;
  return Duration(seconds: hasLiveChat ? 6 : 30);
}

/// Jam yang dipakai penjaga waktu peringatan chat; uji menggantinya karena
/// DateTime.now() tidak ikut waktu palsu flutter_test.
@visibleForTesting
DateTime Function() tapGoClockForTests = DateTime.now;

/// Membandingkan dua pembacaan kotak masuk dan memberi peringatan (popup + satu
/// bunyi) untuk perjalanan yang jumlah pesan belum dibacanya NAIK. TANPA
/// bergantung pada push FCM. Pembacaan pertama (previous == null) hanya menjadi
/// patokan: pesan lama yang sudah ada saat aplikasi dibuka tidak diperingatkan.
void tapGoHandleChatInboxUpdate(
  List<TapGoChatConversation>? previous,
  List<TapGoChatConversation>? next,
) {
  if (previous == null || next == null) return;
  final before = {for (final c in previous) c.rideReference: c.unreadCount};
  for (final conversation in next) {
    if (conversation.unreadCount > (before[conversation.rideReference] ?? 0)) {
      _tapGoAlertChat(
        const TapGoPushMessage(
          title: 'Pesan baru dari driver',
          body: 'Ketuk untuk membaca.',
        ),
        conversation.rideReference,
      );
    }
  }
}

/// Menyegarkan kotak masuk selama aplikasi terbuka dan sudah masuk: lencana
/// pesan baru, titik merah pada tombol chat, dan peringatan pesan baru yang
/// tidak bergantung pada FCM. Selang menyesuaikan [tapGoChatInboxDelay].
class _ChatInboxPoller extends ConsumerStatefulWidget {
  const _ChatInboxPoller({required this.child});

  final Widget child;

  @override
  ConsumerState<_ChatInboxPoller> createState() => _ChatInboxPollerState();
}

class _ChatInboxPollerState extends ConsumerState<_ChatInboxPoller> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    if (_tapGoRunningUnderTest) {
      return;
    }
    _schedule();
  }

  void _schedule() {
    _timer?.cancel();
    _timer = Timer(
      tapGoChatInboxDelay(ref.read(_chatConversationsProvider).valueOrNull),
      _tick,
    );
  }

  void _tick() {
    if (!mounted) return;
    final state = WidgetsBinding.instance.lifecycleState;
    if (state == null || state == AppLifecycleState.resumed) {
      ref.invalidate(_chatConversationsProvider);
    }
    _schedule();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AsyncValue<List<TapGoChatConversation>>>(
      _chatConversationsProvider,
      (previous, next) {
        final state = WidgetsBinding.instance.lifecycleState;
        if (state != null && state != AppLifecycleState.resumed) return;
        tapGoHandleChatInboxUpdate(previous?.valueOrNull, next.valueOrNull);
      },
    );
    return widget.child;
  }
}

/// Balasan cepat: satu ketuk mengirim, untuk situasi penjemputan yang terburu-buru.
const tapGoQuickReplies = <String>[
  'Saya sudah di titik jemput',
  'Tunggu sebentar ya',
  'Saya di seberang jalan',
  'Terima kasih',
];

String tapGoChatTimeLabel(DateTime? at, {DateTime? now}) {
  if (at == null) return '';
  final reference = now ?? DateTime.now();
  final diff = reference.difference(at);
  if (diff.inMinutes < 1) return 'Baru saja';
  if (diff.inHours < 1) return '${diff.inMinutes} mnt lalu';
  if (diff.inDays < 1) {
    return '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
  }
  return '${diff.inDays} hari lalu';
}
