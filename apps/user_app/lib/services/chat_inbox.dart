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
final _chatConversationsProvider =
    FutureProvider<List<TapGoChatConversation>>((ref) async {
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

/// Menyegarkan kotak masuk tiap 30 detik selama aplikasi terbuka dan sudah masuk,
/// agar lencana pesan baru muncul tanpa membuka tab Chat.
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
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      final state = WidgetsBinding.instance.lifecycleState;
      if (state != null && state != AppLifecycleState.resumed) {
        return;
      }
      ref.invalidate(_chatConversationsProvider);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
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
