part of '../main.dart';

/// Chat real-time antara penumpang dan driver selama perjalanan aktif
/// (Stage R2.10). Socket.IO untuk pesan real-time; REST dipakai untuk
/// riwayat awal dan sebagai jalur cadangan bila socket belum tersambung —
/// keduanya melewati ChatService yang sama di backend, jadi aturan
/// partisipan & jendela status ride selalu konsisten.
class RideChatScreen extends ConsumerStatefulWidget {
  const RideChatScreen({
    super.key,
    required this.rideReference,
    this.canSend = true,
    this.pollInterval = const Duration(seconds: 4),
  });

  final String rideReference;

  /// false = percakapan hanya dapat dibaca (perjalanan selesai > 2 jam).
  final bool canSend;

  /// Selang polling REST. Socket.IO nonaktif di produksi (REALTIME_ENABLED),
  /// jadi polling adalah jalur utama pesan masuk; socket hanya mempercepat.
  final Duration pollInterval;

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
  late bool _canSend = widget.canSend;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _loadHistory();
    _connectSocket();
    if (!_tapGoRunningUnderTest ||
        widget.pollInterval < const Duration(seconds: 1)) {
      _pollTimer = Timer.periodic(widget.pollInterval, (_) => _poll());
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
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

  /// Menggabungkan pesan ke daftar tanpa duplikasi (socket, polling, dan
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
      if (message['senderType'] != 'USER') addedFromOther = true;
    }
    return addedFromOther;
  }

  bool _polling = false;

  Future<void> _poll() async {
    if (_polling || !mounted || _loadingHistory) return;
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    if (lifecycle != null && lifecycle != AppLifecycleState.resumed) return;
    _polling = true;
    try {
      final items = await _apiClient.chatMessages(widget.rideReference);
      if (!mounted) return;
      var fromOther = false;
      setState(() => fromOther = _mergeMessages(items));
      if (fromOther) {
        _scrollToBottom();
        unawaited(_apiClient.markChatRead(widget.rideReference));
        ref.invalidate(_chatConversationsProvider);
      }
    } catch (error) {
      _tapGoDebugLog('[TapGo Chat] polling dilewati: $error');
    } finally {
      _polling = false;
    }
  }

  void _connectSocket() {
    // Socket hanya mempercepat; polling REST adalah jalur utama. Tidak dicoba di
    // uji, dan dibatasi 3 percobaan sambung ulang agar tidak berputar tanpa akhir
    // bila realtime dinonaktifkan di server.
    if (_tapGoRunningUnderTest) {
      return;
    }
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
          .setReconnectionAttempts(3)
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
      setState(() => _mergeMessages([Map<String, dynamic>.from(data)]));
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

  Future<void> _send([String? quickReply]) async {
    final text = (quickReply ?? _textController.text).trim();
    if (text.isEmpty || _sending || !_canSend) return;
    setState(() => _sending = true);
    if (quickReply == null) _textController.clear();
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
        // post() sudah membuka pembungkus `data`: hasilnya adalah pesan itu sendiri.
        if (mounted && result['id'] != null) {
          setState(() => _mergeMessages([Map<String, dynamic>.from(result)]));
          _scrollToBottom();
        }
      }
    } catch (error) {
      if (mounted) {
        if (_isChatClosedError(error)) {
          setState(() => _canSend = false);
          _TapGoSnackbar.info(
            context,
            'Percakapan ini sudah ditutup dan hanya dapat dibaca.',
          );
        } else {
          _TapGoSnackbar.error(context, 'Pesan belum terkirim. Coba lagi.');
        }
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
          if (!_canSend)
            _closedBanner()
          else ...[
            _quickReplies(),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
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
                              hintStyle: TextStyle(
                                  color: colorScheme.onSurfaceVariant),
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
        ],
      ),
    );
  }

  Widget _quickReplies() {
    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 2),
        itemCount: tapGoQuickReplies.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final text = tapGoQuickReplies[index];
          final colorScheme = Theme.of(context).colorScheme;
          return ActionChip(
            key: ValueKey('quick_reply_$index'),
            label: Text(text),
            backgroundColor: colorScheme.surface,
            side: BorderSide(color: _brandBlue.withValues(alpha: 0.55)),
            shape: const StadiumBorder(),
            onPressed: _sending ? null : () => _send(text),
            labelStyle: TextStyle(
              color: Theme.of(context).colorScheme.onSurface,
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
            ),
          );
        },
      ),
    );
  }

  Widget _closedBanner() {
    final colorScheme = Theme.of(context).colorScheme;
    return SafeArea(
      top: false,
      child: Container(
        key: const ValueKey('chat_read_only_banner'),
        width: double.infinity,
        margin: const EdgeInsets.fromLTRB(12, 4, 12, 12),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: colorScheme.outlineVariant),
        ),
        child: Text(
          'Percakapan ini sudah ditutup dan hanya dapat dibaca.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: colorScheme.onSurfaceVariant,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

/// Server menolak pengiriman karena jendela balas sudah lewat.
bool _isChatClosedError(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    return data is Map && data['code'] == 'CHAT_RIDE_NOT_ACTIVE';
  }
  return false;
}

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
          color: isMine ? _brandBlue : Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          message,
          style: TextStyle(
            color:
                isMine ? Colors.white : Theme.of(context).colorScheme.onSurface,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
