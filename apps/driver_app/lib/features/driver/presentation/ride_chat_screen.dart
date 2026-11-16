part of '../../../main.dart';

/// Chat real-time antara driver dan penumpang selama perjalanan aktif
/// (Stage R2.10). Padanan RideChatScreen di user_app — protokol dan backend
/// yang sama (ChatService), UI disesuaikan gaya driver_app.
class RideChatScreen extends ConsumerStatefulWidget {
  const RideChatScreen({
    super.key,
    required this.rideReference,
    this.pollInterval = const Duration(seconds: 4),
  });

  final String rideReference;

  /// Selang pengambilan pesan lewat REST selama layar ini terbuka (jalur utama pesan masuk; realtime Socket.IO
  /// tidak dipakai lagi di aplikasi ini).
  /// [Duration.zero] mematikan polling.
  final Duration pollInterval;

  @override
  ConsumerState<RideChatScreen> createState() => _RideChatScreenState();
}

class _RideChatScreenState extends ConsumerState<RideChatScreen> {
  final _messages = <Map<String, dynamic>>[];
  final _textController = TextEditingController();
  final _scrollController = ScrollController();

  bool _loadingHistory = true;
  bool _sending = false;
  String? _historyError;
  Timer? _pollTimer;
  bool _polling = false;

  @override
  void initState() {
    super.initState();
    driverOpenChatReference = widget.rideReference;
    _loadHistory();
    if (widget.pollInterval > Duration.zero) {
      _pollTimer = Timer.periodic(widget.pollInterval, (_) => _poll());
    }
  }

  @override
  void dispose() {
    if (driverOpenChatReference == widget.rideReference) {
      driverOpenChatReference = null;
    }
    _pollTimer?.cancel();
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  DriverRepository get _repository => ref.read(driverRepositoryProvider);

  Future<void> _loadHistory() async {
    try {
      final items = await _repository.chatMessages(widget.rideReference);
      if (!mounted) return;
      setState(() {
        _messages
          ..clear()
          ..addAll(items);
        _loadingHistory = false;
      });
      unawaited(_repository.markChatRead(widget.rideReference));
      _scrollToBottom();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _historyError = 'Riwayat chat belum dapat dimuat.';
        _loadingHistory = false;
      });
    }
  }

  /// Menggabungkan pesan ke daftar tanpa duplikasi (polling dan
  /// pengiriman REST dapat membawa pesan yang sama). Mengembalikan true bila
  /// ada pesan lawan bicara yang baru.
  bool _mergeMessages(Iterable<Map<String, dynamic>> incoming) {
    final known = {for (final m in _messages) m['id']?.toString()};
    var addedFromOther = false;
    for (final message in incoming) {
      final id = message['id']?.toString();
      if (id != null && known.contains(id)) continue;
      _messages.add(message);
      if (id != null) known.add(id);
      if (message['senderType'] != 'DRIVER') addedFromOther = true;
    }
    return addedFromOther;
  }

  /// Mengambil pesan terbaru lewat REST dan menggabungkannya tanpa duplikat.
  /// [force] melewati penjaga tumpang-tindih (dipakai setelah mengirim, supaya
  /// pesan yang baru dikirim langsung tampil).
  Future<void> _poll({bool force = false}) async {
    if (!mounted || _loadingHistory) return;
    if (_polling && !force) return;
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    if (lifecycle != null && lifecycle != AppLifecycleState.resumed) return;
    _polling = true;
    try {
      final items = await _repository.chatMessages(widget.rideReference);
      if (!mounted) return;
      var fromOther = false;
      var changed = false;
      setState(() {
        final before = _messages.length;
        fromOther = _mergeMessages(items);
        changed = _messages.length != before;
      });
      if (changed) _scrollToBottom();
      if (fromOther) {
        unawaited(_repository.markChatRead(widget.rideReference));
      }
    } catch (_) {
      // Polling hanya pelengkap: kegagalan sesaat dilewati, tick berikutnya mencoba lagi.
    } finally {
      _polling = false;
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _send([String? quickReply]) async {
    final text = (quickReply ?? _textController.text).trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    if (quickReply == null) _textController.clear();
    try {
      await _repository.sendChatMessage(widget.rideReference, text);
      // REST tidak mengembalikan bentuk pesan tersimpan: ambil ulang dan gabungkan.
      await _poll(force: true);
    } catch (error) {
      _showError(
        error is DriverApiException ? error.message : 'Pesan belum terkirim. Coba lagi.',
      );
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Widget _quickReplies() {
    final colorScheme = Theme.of(context).colorScheme;
    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 2),
        itemCount: driverQuickReplies.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final text = driverQuickReplies[index];
          return ActionChip(
            key: ValueKey('driver_quick_reply_$index'),
            label: Text(text),
            backgroundColor: colorScheme.surface,
            side: BorderSide(color: colorScheme.primary.withValues(alpha: 0.55)),
            shape: const StadiumBorder(),
            onPressed: _sending ? null : () => _send(text),
            labelStyle: TextStyle(
              color: colorScheme.onSurface,
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat Penumpang'),
      ),
      body: Column(
        children: [
          Expanded(
            child: _loadingHistory
                ? const Center(child: CircularProgressIndicator())
                : _historyError != null && _messages.isEmpty
                    ? Center(
                        child: Text(
                          _historyError!,
                          style: const TextStyle(color: Colors.grey),
                        ),
                      )
                    : _messages.isEmpty
                        ? const Center(
                            child: Padding(
                              padding: EdgeInsets.all(24),
                              child: Text(
                                'Belum ada pesan. Kirim pesan pertama Anda.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: Colors.grey),
                              ),
                            ),
                          )
                        : ListView.builder(
                            controller: _scrollController,
                            padding: const EdgeInsets.all(16),
                            itemCount: _messages.length,
                            itemBuilder: (context, index) {
                              final item = _messages[index];
                              // Chat selalu tepat 2 pihak per ride: senderType
                              // cukup untuk menentukan sisi.
                              final isMine = item['senderType'] == 'DRIVER';
                              return Align(
                                alignment: isMine
                                    ? Alignment.centerRight
                                    : Alignment.centerLeft,
                                child: Container(
                                  margin: const EdgeInsets.symmetric(vertical: 4),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 14,
                                    vertical: 10,
                                  ),
                                  constraints: BoxConstraints(
                                    maxWidth: MediaQuery.of(context).size.width * 0.75,
                                  ),
                                  decoration: BoxDecoration(
                                    color: isMine
                                        ? colorScheme.primary
                                        : colorScheme.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(16),
                                  ),
                                  child: Text(
                                    item['message']?.toString() ?? '',
                                    style: TextStyle(
                                      color: isMine
                                          ? colorScheme.onPrimary
                                          : colorScheme.onSurface,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
          ),
          _quickReplies(),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    // fillColor putih tanpa style teks eksplisit sebelumnya
                    // mewarisi warna teks default tema — di mode gelap itu
                    // terang, sehingga teks nyaris tak terlihat di atas
                    // kotak putih. Disamakan ke pola colorScheme.
                    child: TextField(
                      controller: _textController,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      maxLength: 1000,
                      buildCounter: (context,
                              {required currentLength,
                              required isFocused,
                              maxLength}) =>
                          null,
                      style: TextStyle(color: colorScheme.onSurface),
                      decoration: InputDecoration(
                        hintText: 'Tulis pesan...',
                        hintStyle: TextStyle(color: colorScheme.onSurfaceVariant),
                        filled: true,
                        fillColor: colorScheme.surface,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 12,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                          borderSide: BorderSide.none,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Balasan cepat dari sisi DRIVER: satu ketuk mengirim lewat jalur kirim yang
/// sama dengan pesan biasa. (Berbeda dari balasan cepat penumpang.)
const driverQuickReplies = <String>[
  'Saya menuju titik jemput',
  'Saya sudah sampai',
  'Mohon tunggu sebentar',
  'Baik, saya mengerti',
];
