part of '../main.dart';

class SuperMenuScreen extends StatefulWidget {
  const SuperMenuScreen({super.key});

  @override
  State<SuperMenuScreen> createState() => _SuperMenuScreenState();
}

class _SuperMenuScreenState extends State<SuperMenuScreen> {
  // TapGo Food/Mart, Tagihan, Membership, Reward, dan grup Komunitas
  // (Kelas Online/Webinar/Event/Support) dihapus total dari Super Menu atas
  // permintaan owner — belum ada implementasi layanan sungguhan di baliknya.
  static const _groups = [
    _SuperMenuGroup('Digital', [
      _SuperMenuItem('Pulsa', Icons.phone_iphone_rounded),
      _SuperMenuItem('Paket Data', Icons.wifi_rounded),
      _SuperMenuItem('Token PLN', Icons.bolt_rounded),
      _SuperMenuItem('E-Wallet', Icons.account_balance_wallet_rounded),
      _SuperMenuItem('BPJS', Icons.health_and_safety_rounded),
      _SuperMenuItem('PDAM', Icons.water_drop_rounded),
    ]),
    _SuperMenuGroup('Akun', [
      _SuperMenuItem('Kartu Anggota', Icons.badge_rounded),
      _SuperMenuItem('Profil', Icons.person_rounded),
      _SuperMenuItem('Tiket Bantuan', Icons.volunteer_activism_rounded),
      _SuperMenuItem('Hapus Akun', Icons.delete_outline_rounded),
    ]),
  ];

  @override
  Widget build(BuildContext context) {
    const groups = _groups;
    return _DemoScaffold(
      title: 'Super Menu',
      subtitle: 'Semua layanan TapGo dalam satu akses',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ...groups.map(
            (group) => Padding(
              padding: const EdgeInsets.only(bottom: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    group.title,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurface,
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 12),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: group.items.length,
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 4,
                      mainAxisSpacing: 14,
                      crossAxisSpacing: 8,
                      childAspectRatio: 0.62,
                    ),
                    itemBuilder: (context, index) {
                      final item = group.items[index];
                      return _SuperMenuTile(
                        item: item,
                        onTap: () => _openMenuDetail(context, item.label),
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _openMenuDetail(BuildContext context, String label) {
    final categoryCode = _ppobCategoryCodeForLabel(label);
    if (categoryCode != null) {
      unawaited(tapGoOpenPpobCategory(context, categoryCode, label: label));
      return;
    }
    final destination = _superMenuDestinationForLabel(label);
    if (destination != null) {
      _openDemo(context, destination);
    }
  }
}

String? tapGoPpobCategoryCodeForLabelForTests(String label) =>
    _ppobCategoryCodeForLabel(label);

/// Kode kategori backend untuk tile PPOB Super Menu (Pulsa, Paket Data,
/// Token PLN, E-Wallet, BPJS, PDAM) — dipetakan terpisah dari
/// _superMenuDestinationForLabel karena tujuannya butuh data async
/// (kategori dari ppobCatalogProvider), bukan Widget statis.
String? _ppobCategoryCodeForLabel(String label) => switch (label) {
      'Pulsa' => 'PULSA',
      'Paket Data' => 'DATA',
      'Token PLN' => 'PLN_PREPAID',
      'E-Wallet' => 'EWALLET',
      'BPJS' => 'BPJS',
      'PDAM' => 'PDAM',
      _ => null,
    };

List<String> tapGoSuperMenuLabelsForTests() => _SuperMenuScreenState._groups
    .expand((group) => group.items.map((item) => item.label))
    .toList(growable: false);

Widget? _superMenuDestinationForLabel(String label) {
  return switch (label) {
    'PPOB' => const PpobHomeScreen(),
    'Kartu Anggota' => const BasicMemberCardScreen(),
    'Profil' => const ProfileDetailsScreen(),
    'Tiket Bantuan' => const ContactUsScreen(),
    'Hapus Akun' => const DeleteAccountRequestScreen(),
    _ => null,
  };
}

Widget? tapGoSuperMenuDestinationForLabelForTests(String label) =>
    _superMenuDestinationForLabel(label);

const _tapGoPrivacyPolicyContent = '''
PT. TapGo Lion Indonesia mengumpulkan data yang diperlukan untuk menjalankan akun Basic dan layanan digital TapGo.

Data yang dikumpulkan dapat meliputi nama, nomor HP, alamat, nomor KTP jika digunakan, foto KTP jika digunakan, foto diri jika digunakan, serta riwayat permintaan layanan akun.

Data digunakan untuk registrasi, verifikasi akun, pengelolaan status Basic, keamanan akun, serta customer support.

TapGo menerapkan pembatasan akses, autentikasi, dan pencatatan transaksi untuk menjaga keamanan data. Data transaksi penting dapat disimpan sesuai kebutuhan hukum, audit, dan penyelesaian kewajiban layanan.

Pengguna dapat meminta penghapusan atau penonaktifan akun melalui menu Hapus Akun. Permintaan akan ditinjau agar tidak menghapus data transaksi penting yang wajib dipertahankan untuk audit dan kepatuhan.

Kontak support: support@tapgolion.id, WhatsApp +62 838-0025-5588, alamat Jalan Kp. Pasir Gendok No. 11, Desa Bojongleles, Kecamatan Rangkasbitung, Kabupaten Lebak, Banten, Indonesia.
''';

const _tapGoTermsContent = '''
Dengan menggunakan TapGo, pengguna menyetujui ketentuan layanan akun Basic dan layanan digital yang berlaku.

Paket Basic bersifat gratis sebagai status awal member.

Benefit akun ditampilkan sesuai layanan yang tersedia di aplikasi.

Pengguna dilarang membuat akun palsu, melakukan klaim ganda, atau memanipulasi data layanan. TapGo berhak membatasi, menolak, atau menangguhkan akun yang melanggar.

TapGo dapat memperbarui layanan, benefit, dan ketentuan dengan pemberitahuan yang wajar. PT. TapGo Lion Indonesia tidak bertanggung jawab atas kerugian yang timbul dari penyalahgunaan akun atau informasi yang tidak benar dari pengguna.
''';

class LegalInfoScreen extends StatelessWidget {
  const LegalInfoScreen({
    super.key,
    required this.title,
    required this.content,
  });

  final String title;
  final String content;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return _DemoScaffold(
      title: title,
      subtitle: 'PT. TapGo Lion Indonesia',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: colorScheme.surface,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: colorScheme.outlineVariant),
        ),
        child: Text(
          content,
          style: TextStyle(
            color: colorScheme.onSurface,
            height: 1.55,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class DeleteAccountRequestScreen extends ConsumerStatefulWidget {
  const DeleteAccountRequestScreen({super.key});

  @override
  ConsumerState<DeleteAccountRequestScreen> createState() =>
      _DeleteAccountRequestScreenState();
}

class _DeleteAccountRequestScreenState
    extends ConsumerState<DeleteAccountRequestScreen> {
  final _reasonController = TextEditingController();
  bool _submitting = false;
  Map<String, dynamic>? _latestRequest;

  @override
  void initState() {
    super.initState();
    _loadLatestRequest();
  }

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _loadLatestRequest() async {
    try {
      final data = await _apiClient.accountDeletionRequest();
      if (mounted) {
        setState(() => _latestRequest = data);
      }
    } catch (_) {
      // Empty state is acceptable when no request exists yet.
    }
  }

  Future<void> _submit() async {
    final confirmed = await _showTapGoDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Konfirmasi hapus akun'),
        content: const Text(
          'Permintaan ini akan ditinjau tim TapGo. Data transaksi penting '
          'seperti invoice, wallet ledger, dan withdrawal dapat tetap '
          'disimpan untuk audit dan kepatuhan.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Kirim Pengajuan'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) {
      return;
    }

    setState(() => _submitting = true);
    try {
      final data = await _apiClient.submitAccountDeletionRequest(
        reason: _reasonController.text,
      );
      if (!mounted) return;
      setState(() => _latestRequest = data);
      _TapGoSnackbar.success(context, 'Pengajuan hapus akun berhasil dikirim.');
    } catch (error) {
      if (!mounted) return;
      _TapGoSnackbar.error(
        context,
        'Pengajuan belum dapat dikirim. Silakan coba lagi.',
      );
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _latestRequest?['status']?.toString();
    return _DemoScaffold(
      title: 'Hapus Akun',
      subtitle: 'Ajukan penonaktifan akun sesuai kebijakan TapGo',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _StatusSurface(
            icon: Icons.info_outline_rounded,
            title: 'Penghapusan akun perlu ditinjau.',
            subtitle:
                'Data transaksi penting tidak langsung dihapus karena perlu disimpan untuk audit, kepatuhan, dan penyelesaian kewajiban.',
          ),
          if (status != null) ...[
            const SizedBox(height: 12),
            _InfoRow(label: 'Status request terakhir', value: status),
          ],
          const SizedBox(height: 16),
          TextField(
            controller: _reasonController,
            minLines: 3,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Alasan opsional',
              hintText: 'Tuliskan alasan penghapusan akun',
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _submitting ? null : _submit,
            icon: _submitting
                ? const _TapGoLoading(size: 18, strokeWidth: 2)
                : const Icon(Icons.send_rounded),
            label: Text(
              _submitting ? 'Mengirim...' : 'Ajukan Penghapusan Akun',
            ),
          ),
        ],
      ),
    );
  }
}

class ContactUsScreen extends ConsumerStatefulWidget {
  const ContactUsScreen({super.key});

  @override
  ConsumerState<ContactUsScreen> createState() => _ContactUsScreenState();
}

class _ContactUsScreenState extends ConsumerState<ContactUsScreen> {
  final _subjectController = TextEditingController();
  final _messageController = TextEditingController();
  bool _submitting = false;
  late Future<List<Map<String, dynamic>>> _ticketFuture;

  @override
  void initState() {
    super.initState();
    _ticketFuture = _loadTickets();
  }

  @override
  void dispose() {
    _subjectController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _loadTickets() async {
    final loader = tapGoSupportTicketsLoaderForTests;
    if (loader != null) {
      return loader();
    }
    if (tapGoDisablePersistenceForTests) {
      return const [];
    }
    return _apiClient.supportTickets();
  }

  Future<void> _submit() async {
    if (_subjectController.text.trim().length < 3 ||
        _messageController.text.trim().length < 10) {
      _TapGoSnackbar.warning(context, 'Lengkapi judul dan pesan bantuan.');
      return;
    }

    setState(() => _submitting = true);
    try {
      final createTicket = tapGoCreateSupportTicketForTests;
      await (createTicket != null
          ? createTicket(
              category: 'OTHER',
              subject: _subjectController.text,
              message: _messageController.text,
            )
          : _apiClient.createSupportTicket(
              category: 'OTHER',
              subject: _subjectController.text,
              message: _messageController.text,
            ));
      if (!mounted) return;
      _subjectController.clear();
      _messageController.clear();
      setState(() => _ticketFuture = _loadTickets());
      _TapGoSnackbar.success(context, 'Tiket bantuan berhasil dibuat.');
    } catch (error) {
      if (!mounted) return;
      _TapGoSnackbar.error(
        context,
        'Tiket bantuan belum dapat dibuat. Silakan coba lagi.',
      );
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: 'Bantuan TapGo',
      subtitle: 'Pusat bantuan member',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _StatusSurface(
            icon: Icons.support_agent_rounded,
            title: 'Support TapGo',
            subtitle:
                'Buat tiket bantuan untuk pertanyaan akun, membership Basic, atau kendala aplikasi.',
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _subjectController,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(labelText: 'Judul bantuan'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _messageController,
            minLines: 4,
            maxLines: 6,
            decoration: const InputDecoration(labelText: 'Pesan bantuan'),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _submitting ? null : _submit,
            icon: _submitting
                ? const _TapGoLoading(size: 18, strokeWidth: 2)
                : const Icon(Icons.send_rounded),
            label: Text(_submitting ? 'Mengirim...' : 'Kirim Pesan'),
          ),
          const SizedBox(height: 20),
          FutureBuilder<List<Map<String, dynamic>>>(
            future: _ticketFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: _TapGoLoading(size: 24));
              }
              if (snapshot.hasError) {
                return const _StatusSurface(
                  icon: Icons.wifi_off_rounded,
                  title: 'Riwayat bantuan belum dapat dimuat',
                  subtitle:
                      'Tiket baru tetap dapat dikirim saat koneksi tersedia.',
                );
              }
              final tickets = snapshot.data ?? const [];
              if (tickets.isEmpty) {
                return const _StatusSurface(
                  icon: Icons.mark_chat_unread_outlined,
                  title: 'Belum ada tiket bantuan',
                  subtitle: 'Tiket yang Anda kirim akan muncul di halaman ini.',
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionHeader(
                    title: 'Riwayat Bantuan',
                    subtitle: 'Status tiket yang pernah Anda kirim',
                  ),
                  const SizedBox(height: 10),
                  ...tickets.map(_SupportTicketCard.new),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _SupportTicketCard extends StatelessWidget {
  const _SupportTicketCard(this.ticket);

  final Map<String, dynamic> ticket;

  @override
  Widget build(BuildContext context) {
    final status = ticket['status']?.toString() ?? 'OPEN';
    final id = ticket['id']?.toString();
    final content = _InfoCard(
      icon: Icons.confirmation_number_rounded,
      title: ticket['subject']?.toString() ?? 'Tiket bantuan',
      subtitle:
          '${ticket['reference'] ?? '-'} • ${_supportStatusLabel(status)}',
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: id == null || id.isEmpty
          ? content
          : InkWell(
              borderRadius: BorderRadius.circular(22),
              onTap: () =>
                  _openDemo(context, SupportTicketDetailScreen(ticket: ticket)),
              child: content,
            ),
    );
  }
}

class SupportTicketDetailScreen extends StatefulWidget {
  const SupportTicketDetailScreen({required this.ticket, super.key});

  final Map<String, dynamic> ticket;

  @override
  State<SupportTicketDetailScreen> createState() =>
      _SupportTicketDetailScreenState();
}

class _SupportTicketDetailScreenState extends State<SupportTicketDetailScreen> {
  // Future di-cache sekali di initState (pola sama seperti perbaikan
  // ProfileDetailsScreen): sebelumnya widget ini StatelessWidget yang
  // memanggil _load() langsung di dalam build(), sehingga SETIAP rebuild
  // (mis. dipicu perubahan Theme app-wide saat ganti tema) membuat Future
  // baru dan berpotensi tabrakan dengan request lama yang masih berjalan
  // saat halaman ini dalam proses ditutup — sumber race Element-tree yang
  // sama dengan crash 'Simpan nomor HP'.
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Map<String, dynamic>> _load() async {
    final ticket = widget.ticket;
    final id = ticket['id']?.toString();
    if (id == null || id.isEmpty) {
      return ticket;
    }
    final loader = tapGoSupportTicketDetailLoaderForTests;
    if (loader != null) {
      return loader(id);
    }
    if (tapGoDisablePersistenceForTests) {
      return ticket;
    }
    return _apiClient.supportTicketDetail(id);
  }

  @override
  Widget build(BuildContext context) {
    final ticket = widget.ticket;
    return _DemoScaffold(
      title: 'Detail Tiket',
      subtitle: 'Status dan pesan bantuan',
      child: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: _TapGoLoading(size: 24));
          }
          if (snapshot.hasError) {
            return const _StatusSurface(
              icon: Icons.wifi_off_rounded,
              title: 'Detail tiket belum dapat dimuat',
              subtitle: 'Pastikan koneksi internet aktif, lalu coba lagi.',
            );
          }
          final data = snapshot.data ?? ticket;
          final status = data['status']?.toString() ?? 'OPEN';
          final messages = (data['messages'] is List)
              ? (data['messages'] as List)
                  .whereType<Map>()
                  .map((item) => item.cast<String, dynamic>())
                  .toList()
              : <Map<String, dynamic>>[];
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _StatusSurface(
                icon: Icons.confirmation_number_rounded,
                title: data['subject']?.toString() ?? 'Tiket bantuan',
                subtitle:
                    '${data['reference'] ?? '-'} • ${_supportStatusLabel(status)}',
              ),
              const SizedBox(height: 14),
              const _SectionHeader(
                title: 'Pesan',
                subtitle: 'Riwayat komunikasi terkait tiket ini',
              ),
              const SizedBox(height: 10),
              if (messages.isEmpty)
                const _StatusSurface(
                  icon: Icons.mark_chat_read_outlined,
                  title: 'Belum ada pesan tambahan',
                  subtitle: 'Balasan admin akan tampil di halaman ini.',
                )
              else
                ...messages.map(
                  (message) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _InfoCard(
                      icon: message['authorRole']?.toString() == 'USER'
                          ? Icons.person_rounded
                          : Icons.support_agent_rounded,
                      title: message['authorRole']?.toString() == 'USER'
                          ? 'Anda'
                          : 'Admin TapGo',
                      subtitle: message['body']?.toString() ?? '-',
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

String _supportStatusLabel(String status) {
  return switch (status.toUpperCase()) {
    'OPEN' => 'Terbuka',
    'IN_PROGRESS' => 'Diproses',
    'RESOLVED' => 'Selesai',
    'CLOSED' => 'Ditutup',
    _ => 'Terbuka',
  };
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: colorScheme.onSurface,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}
