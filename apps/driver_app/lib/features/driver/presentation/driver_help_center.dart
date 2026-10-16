part of '../../../main.dart';

final driverSupportTicketsProvider =
    FutureProvider.autoDispose<List<DriverSupportTicket>>((ref) {
  return ref.watch(driverRepositoryProvider).supportTickets();
});

/// Pertanyaan yang paling sering diajukan driver. Angka (8%, Rp50.000) harus sama dengan aturan server dan
/// Pernyataan Kemitraan; bila aturan berubah, ubah di sini juga.
const _driverFaq = <(String, String)>[
  (
    'Berapa komisi TapGo dan bagaimana cara kerjanya?',
    'Komisi 8% dari tarif tiap perjalanan. Pesanan tunai: komisi ditahan dari Saldo TapGo saat Anda menerima pesanan, '
        'menjadi final saat perjalanan selesai, dan dikembalikan bila pesanan dibatalkan. '
        'Pesanan digital: penumpang membayar lewat TapGo, Anda menerima 92% ke saldo dan 8% menjadi komisi.',
  ),
  (
    'Mengapa saya tidak bisa menerima pesanan tunai?',
    'Pesanan tunai membutuhkan Saldo TapGo minimal Rp50.000 dan cukup untuk komisi pesanan itu. '
        'Isi saldo lewat tapgolion.id/topup, lalu tarik layar di halaman Pendapatan untuk menyegarkan saldo.',
  ),
  (
    'Bagaimana cara mengisi Saldo TapGo?',
    'Buka tapgolion.id/topup, masuk dengan nomor HP dan password tapgolion.id, pilih jumlah, lalu bayar. '
        'Biaya layanan pembayaran ditampilkan sebelum Anda membayar. Bila Anda masuk memakai Google, buat dulu password '
        'di Akun > Password tapgolion.id.',
  ),
  (
    'Bagaimana menarik penghasilan?',
    'Penghasilan dari perjalanan digital dapat ditarik lewat tapgolion.id (menu dompet), memakai password tapgolion.id '
        'dan rekening bank atas nama Anda. Penarikan tidak dilakukan di aplikasi ini.',
  ),
  (
    'Apa yang terjadi saat saya menekan SOS?',
    'Sinyal darurat beserta lokasi terakhir Anda dikirim ke tim TapGo yang memantau. Dalam bahaya langsung, hubungi 112 '
        'lebih dulu. Anda juga dapat menghubungi TapGo lewat WhatsApp pada menu ini.',
  ),
  (
    'Mengapa saya diminta verifikasi wajah?',
    'Verifikasi wajah dilakukan setiap hari sebelum online, dan sewaktu-waktu secara acak, untuk memastikan akun dipakai '
        'oleh pemiliknya. Selesaikan dulu bila diminta; tawaran baru muncul setelahnya.',
  ),
  (
    'Mengapa tawaran pesanan tidak muncul?',
    'Pastikan status Anda Online, GPS aktif dengan izin lokasi, kendaraan sudah terverifikasi, dan koneksi internet stabil. '
        'Tawaran hanya muncul dari penumpang di sekitar Anda.',
  ),
  (
    'Apa dampak membatalkan pesanan?',
    'Pembatalan oleh driver mengurangi tingkat penyelesaian Anda dan dapat memengaruhi status akun bila terlalu sering. '
        'Batalkan hanya bila perlu, dan pilih alasan yang sesuai.',
  ),
];

class DriverHelpCenterScreen extends ConsumerWidget {
  const DriverHelpCenterScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(driverSupportTicketsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Pusat Bantuan')),
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(driverSupportTicketsProvider.future),
        child: ListView(
          key: const ValueKey('help-scroll'),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            Text('Pertanyaan umum', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            for (final (question, answer) in _driverFaq)
              Card(
                child: ExpansionTile(
                  key: ValueKey('faq-$question'),
                  title: Text(question, style: const TextStyle(fontWeight: FontWeight.w700)),
                  childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  expandedCrossAxisAlignment: CrossAxisAlignment.start,
                  children: [Text(answer)],
                ),
              ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: Text('Pertanyaan Anda', style: Theme.of(context).textTheme.titleLarge),
                ),
                FilledButton.icon(
                  key: const ValueKey('help-new-ticket'),
                  onPressed: () async {
                    final sent = await showModalBottomSheet<bool>(
                      context: context,
                      isScrollControlled: true,
                      showDragHandle: true,
                      builder: (_) => const _NewTicketSheet(),
                    );
                    if (sent == true) ref.invalidate(driverSupportTicketsProvider);
                  },
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Tanya TapGo'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            tickets.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, _) => _EarningsError(
                error: error,
                onRetry: () => ref.invalidate(driverSupportTicketsProvider),
              ),
              data: (items) => items.isEmpty
                  ? const EmptyStateCard(
                      icon: Icons.forum_outlined,
                      title: 'Belum ada pertanyaan',
                      message:
                          'Pertanyaan yang Anda kirim ke tim TapGo dan balasannya akan muncul di sini.',
                    )
                  : Column(children: [for (final t in items) _TicketCard(ticket: t)]),
            ),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              key: const ValueKey('help-whatsapp'),
              onPressed: _openSupportWhatsApp,
              icon: const Icon(Icons.chat_bubble_outline_rounded),
              label: const Text('Mendesak? Hubungi lewat WhatsApp'),
            ),
          ],
        ),
      ),
    );
  }
}

class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.ticket});
  final DriverSupportTicket ticket;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ExpansionTile(
        key: ValueKey('ticket-${ticket.reference}'),
        title: Text(ticket.subject, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text('${ticket.reference} · ${ticket.statusLabel} · ${_shortDate(ticket.createdAt)}'),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final message in ticket.messages)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    message.fromAdmin ? 'Tim TapGo' : 'Anda',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      color: message.fromAdmin
                          ? Theme.of(context).colorScheme.primary
                          : Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  Text(message.body),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _NewTicketSheet extends ConsumerStatefulWidget {
  const _NewTicketSheet();

  @override
  ConsumerState<_NewTicketSheet> createState() => _NewTicketSheetState();
}

class _NewTicketSheetState extends ConsumerState<_NewTicketSheet> {
  static const _categories = <(String, String)>[
    ('ACCOUNT', 'Akun'),
    ('TECHNICAL', 'Masalah teknis'),
    ('MEMBERSHIP', 'Saldo dan pembayaran'),
    ('OTHER', 'Lainnya'),
  ];

  final _subject = TextEditingController();
  final _message = TextEditingController();
  String _category = 'OTHER';
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _subject.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final subject = _subject.text.trim();
    final message = _message.text.trim();
    if (subject.isEmpty || message.isEmpty) {
      setState(() => _error = 'Judul dan pesan wajib diisi.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(driverRepositoryProvider).createSupportTicket(
            category: _category,
            subject: subject,
            message: message,
          );
      if (mounted) Navigator.of(context).pop(true);
    } on DriverApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Tanya TapGo', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: const ValueKey('ticket-category'),
              isExpanded: true,
              initialValue: _category,
              decoration: const InputDecoration(labelText: 'Topik', border: OutlineInputBorder()),
              items: [
                for (final (value, label) in _categories)
                  DropdownMenuItem(value: value, child: Text(label)),
              ],
              onChanged: _sending ? null : (value) => setState(() => _category = value ?? 'OTHER'),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('ticket-subject'),
              controller: _subject,
              maxLength: 140,
              enabled: !_sending,
              decoration: const InputDecoration(labelText: 'Judul', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 4),
            TextField(
              key: const ValueKey('ticket-message'),
              controller: _message,
              maxLength: 2000,
              maxLines: 5,
              enabled: !_sending,
              decoration: const InputDecoration(
                labelText: 'Pesan',
                alignLabelWithHint: true,
                border: OutlineInputBorder(),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            FilledButton(
              key: const ValueKey('ticket-submit'),
              onPressed: _sending ? null : _submit,
              child: Text(_sending ? 'Mengirim...' : 'Kirim'),
            ),
          ],
        ),
      ),
    );
  }
}
