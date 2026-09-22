part of '../../../main.dart';

/// Chat real-time antara driver dan penumpang selama perjalanan aktif
/// (Stage R2.10). Padanan RideChatScreen di user_app — protokol dan backend
/// yang sama (ChatService), UI disesuaikan gaya driver_app.
class RideChatScreen extends ConsumerStatefulWidget {
  const RideChatScreen({super.key, required this.rideReference});

  final String rideReference;

  @override
  ConsumerState<RideChatScreen> createState() => _RideChatScreenState();
}

class _RideChatScreenState extends ConsumerState<RideChatScreen> {
  final _messages = <Map<String, dynamic>>[];
  final _textController = TextEditingController();
  final _scrollController = ScrollController();
  io_client.Socket? _socket;

  bool _loadingHistory = true;
  bool _sending = false;
  bool _socketConnected = false;
  String? _historyError;

  @override
  void initState() {
    super.initState();
    _loadHistory();
    _connectSocket();
  }

  @override
  void dispose() {
    _socket?.dispose();
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

  void _connectSocket() {
    final token = ref.read(driverControllerProvider).session?.accessToken;
    if (token == null || token.isEmpty) {
      return;
    }
    final socket = io_client.io(
      _socketRootUrl(),
      io_client.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .disableAutoConnect()
          .build(),
    );
    socket.onConnect((_) {
      if (!mounted) return;
      setState(() => _socketConnected = true);
      socket.emitWithAck('ride:join', widget.rideReference, ack: (_) {});
    });
    socket.onDisconnect((_) {
      if (!mounted) return;
      setState(() => _socketConnected = false);
    });
    socket.on('chat:message', (data) {
      if (!mounted || data is! Map) return;
      setState(() {
        _messages.add(Map<String, dynamic>.from(data));
      });
      _scrollToBottom();
      unawaited(_repository.markChatRead(widget.rideReference));
    });
    socket.connect();
    _socket = socket;
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

  Future<void> _send() async {
    final text = _textController.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    _textController.clear();
    try {
      final socket = _socket;
      if (socket != null && _socketConnected) {
        final ackResult = await socket.emitWithAckAsync(
          'chat:send',
          {'rideId': widget.rideReference, 'message': text},
        ) as Map?;
        if (ackResult?['ok'] != true) {
          _showError('Pesan belum terkirim. Coba lagi.');
        }
      } else {
        await _repository.sendChatMessage(widget.rideReference, text);
        // REST fallback tidak mengembalikan bentuk pesan tersimpan (beda
        // dari user_app) — cukup muat ulang riwayat karena tidak ada
        // siaran socket yang akan diterima.
        await _loadHistory();
      }
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

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat Penumpang'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: (_socketConnected ? Colors.green : Colors.grey)
                      .withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  _socketConnected ? 'Live' : 'Offline',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: _socketConnected ? Colors.green : Colors.grey,
                  ),
                ),
              ),
            ),
          ),
        ],
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
                                        : Colors.white,
                                    borderRadius: BorderRadius.circular(16),
                                  ),
                                  child: Text(
                                    item['message']?.toString() ?? '',
                                    style: TextStyle(
                                      color: isMine
                                          ? colorScheme.onPrimary
                                          : Colors.black87,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
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

/// kApiBaseUrl selalu diakhiri "/api/v1" (lihat app_config.dart) — Socket.IO
/// menempel di root server yang sama, bukan di bawah prefiks REST tersebut.
String _socketRootUrl() {
  const suffix = '/api/v1';
  return kApiBaseUrl.endsWith(suffix)
      ? kApiBaseUrl.substring(0, kApiBaseUrl.length - suffix.length)
      : kApiBaseUrl;
}
