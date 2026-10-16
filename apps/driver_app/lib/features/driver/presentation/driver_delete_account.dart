part of '../../../main.dart';

final driverDeletionRequestProvider =
    FutureProvider.autoDispose<DriverDeletionRequest?>((ref) {
  return ref.watch(driverRepositoryProvider).accountDeletionRequest();
});

/// Hapus akun (wajib ada di dalam aplikasi menurut kebijakan Google Play). Pengajuan ditinjau tim TapGo; data transaksi
/// disimpan untuk audit dan kepatuhan hukum. Alamat web yang sama: https://tapgolion.id/hapus-akun.
class DriverDeleteAccountScreen extends ConsumerStatefulWidget {
  const DriverDeleteAccountScreen({super.key});

  @override
  ConsumerState<DriverDeleteAccountScreen> createState() => _DriverDeleteAccountScreenState();
}

class _DriverDeleteAccountScreenState extends ConsumerState<DriverDeleteAccountScreen> {
  final _reason = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Ajukan hapus akun?'),
        content: const Text(
          'Setelah ditinjau dan disetujui, akun driver Anda dinonaktifkan dan tidak dapat menerima pesanan lagi. '
          'Pastikan saldo penghasilan sudah Anda tarik di tapgolion.id.',
        ),
        actions: [
          TextButton(
            key: const ValueKey('delete-account-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Batal'),
          ),
          FilledButton(
            key: const ValueKey('delete-account-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Ajukan'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(driverRepositoryProvider).submitAccountDeletionRequest(reason: _reason.text);
      ref.invalidate(driverDeletionRequestProvider);
    } on DriverApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final latest = ref.watch(driverDeletionRequestProvider);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Hapus Akun')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Penghapusan akun ditinjau tim TapGo.', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          const Text(
            'Sebelum mengajukan, tarik saldo penghasilan Anda di tapgolion.id. Setelah disetujui, akun dinonaktifkan dan data pribadi '
            'dihapus atau dianonimkan sesuai kebijakan privasi. Data transaksi penting (perjalanan, saldo, komisi, penarikan) '
            'tetap disimpan untuk audit dan kepatuhan hukum. Dokumen identitas (KTP/SIM/STNK) sudah dihapus otomatis paling lama 72 jam setelah diunggah.',
          ),
          const SizedBox(height: 16),
          latest.when(
            loading: () => const SizedBox.shrink(),
            error: (_, __) => const SizedBox.shrink(),
            data: (request) => request == null
                ? const SizedBox.shrink()
                : Card(
                    key: const ValueKey('delete-account-status'),
                    child: ListTile(
                      leading: const Icon(Icons.info_outline_rounded),
                      title: const Text('Pengajuan terakhir'),
                      subtitle: Text('${request.statusLabel} · ${_shortDate(request.createdAt)}'),
                    ),
                  ),
          ),
          const SizedBox(height: 12),
          if (latest.valueOrNull?.isOpen != true) ...[
            TextField(
              key: const ValueKey('delete-account-reason'),
              controller: _reason,
              maxLines: 3,
              maxLength: 1000,
              enabled: !_sending,
              decoration: const InputDecoration(
                labelText: 'Alasan (opsional)',
                border: OutlineInputBorder(),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
              ),
            FilledButton.icon(
              key: const ValueKey('delete-account-submit'),
              onPressed: _sending ? null : _submit,
              icon: const Icon(Icons.delete_outline_rounded),
              label: Text(_sending ? 'Mengirim...' : 'Ajukan hapus akun'),
              style: FilledButton.styleFrom(backgroundColor: theme.colorScheme.error),
            ),
          ] else
            const Text('Pengajuan Anda sedang diproses. Tim TapGo akan menghubungi Anda bila ada yang perlu dilengkapi.'),
        ],
      ),
    );
  }
}
