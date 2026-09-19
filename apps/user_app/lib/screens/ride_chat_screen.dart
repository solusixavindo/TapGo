part of '../main.dart';

/// Chat real-time antara penumpang dan driver selama perjalanan aktif
/// (Stage R2.10). Socket.IO untuk pesan real-time; REST dipakai untuk
/// riwayat awal dan sebagai jalur cadangan bila socket belum tersambung —
/// keduanya melewati ChatService yang sama di backend, jadi aturan
/// partisipan & jendela status ride selalu konsisten.
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

  Future<void> _loadHistory() async {
    try {
      final session = ref.read(_demoSessionProvider);
      _apiClient.setAccessToken(session.accessToken);
      final items = await _apiClient.chatMessages(widget.rideReference);
      if (!mounted) return;
      setState(() {
        _messages
          ..clear()
          ..addAll(items);
        _loadingHistory = false;
      });
      unawaited(_apiClient.markChatRead(widget.rideReference));
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
    final session = ref.read(_demoSessionProvider);
    final token = session.accessToken;
    if (token == null || token.isEmpty) {
      return;
    }
    final socket = io_client.io(
      _apiClient.rootUrl,
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
    // Server selalu menyiarkan ke SELURUH anggota room (termasuk pengirim),
    // jadi klien tidak pernah menambah pesan sendiri secara optimistik —
    // menghindari duplikasi. Lihat realtime/socket.ts di backend.
    socket.on('chat:message', (data) {
      if (!mounted || data is! Map) return;
      setState(() {
        _messages.add(Map<String, dynamic>.from(data));
      });
      _scrollToBottom();
      unawaited(_apiClient.markChatRead(widget.rideReference));
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
        if (ackResult?['ok'] != true && mounted) {
          _TapGoSnackbar.error(context, 'Pesan belum terkirim. Coba lagi.');
        }
      } else {
        // Socket belum tersambung — kirim lewat REST, lalu tambahkan sendiri
        // ke daftar karena tidak ada siaran socket yang akan diterima.
        final result = await _apiClient.sendChatMessage(
          widget.rideReference,
          text,
        );
        if (mounted && result['data'] is Map) {
          setState(() {
            _messages.add(Map<String, dynamic>.from(result['data'] as Map));
          });
          _scrollToBottom();
        }
      }
    } catch (error) {
      if (mounted) {
        _TapGoSnackbar.error(context, 'Pesan belum terkirim. Coba lagi.');
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat Perjalanan'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: (_socketConnected ? _brandGreenTone : Colors.grey)
                      .withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  _socketConnected ? 'Live' : 'Offline',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: _socketConnected ? _brandGreenTone : Colors.grey,
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
                ? const Center(child: _TapGoLoading(color: _brandBlue))
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
                              // Chat selalu tepat 2 pihak per ride (penumpang
                              // & driver): senderType cukup untuk menentukan
                              // sisi, tidak perlu tahu userId lawan bicara.
                              final isMine = item['senderType'] == 'USER';
                              return _ChatBubble(
                                message: item['message']?.toString() ?? '',
                                isMine: isMine,
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
                    child: Builder(
                      builder: (context) {
                        // fillColor putih tanpa style teks eksplisit
                        // sebelumnya mewarisi warna teks default tema — di
                        // mode gelap itu terang, sehingga teks nyaris tak
                        // terlihat di atas kotak putih. Disamakan ke pola
                        // colorScheme seperti _InputField.
                        final colorScheme = Theme.of(context).colorScheme;
                        return TextField(
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
                            hintStyle:
                                TextStyle(color: colorScheme.onSurfaceVariant),
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
                        );
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const _TapGoLoading(size: 18, strokeWidth: 2)
                        : const Icon(Icons.send_rounded),
                    style: IconButton.styleFrom(backgroundColor: _brandBlue),
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

const _brandGreenTone = Color(0xFF00A86B);

class _ChatBubble extends StatelessWidget {
  const _ChatBubble({required this.message, required this.isMine});

  final String message;
  final bool isMine;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        decoration: BoxDecoration(
          color: isMine ? _brandBlue : Colors.white,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          message,
          style: TextStyle(
            color: isMine ? Colors.white : const Color(0xFF263241),
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
