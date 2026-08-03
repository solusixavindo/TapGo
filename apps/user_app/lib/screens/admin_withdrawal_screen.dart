part of '../main.dart';

class AdminWithdrawalScreen extends ConsumerStatefulWidget {
  const AdminWithdrawalScreen({super.key});

  @override
  ConsumerState<AdminWithdrawalScreen> createState() =>
      _AdminWithdrawalScreenState();
}

class _AdminWithdrawalScreenState extends ConsumerState<AdminWithdrawalScreen> {
  late final Map<String, String> _statuses = _isTapGoDevelopmentBuild
      ? {
          for (final withdrawal in _demoAdminWithdrawals)
            withdrawal.id: withdrawal.status,
        }
      : <String, String>{};

  @override
  void initState() {
    super.initState();
    _restoreStatuses();
  }

  @override
  Widget build(BuildContext context) {
    final adminSnapshot = ref.watch(_adminConsoleSnapshotProvider);
    final apiWithdrawals =
        adminSnapshot.valueOrNull?.withdrawals
            .map(DemoAdminWithdrawal.fromApi)
            .toList(growable: false) ??
        const <DemoAdminWithdrawal>[];
    final withdrawals = adminSnapshot.hasValue
        ? apiWithdrawals
        : (_isTapGoDevelopmentBuild
              ? _demoAdminWithdrawals
              : const <DemoAdminWithdrawal>[]);
    final canMarkPaid = ref.watch(_demoSessionProvider).isSuperAdmin;
    return _DemoScaffold(
      title: 'Withdrawal',
      subtitle: adminSnapshot.hasValue
          ? 'Live Data approve/reject withdrawal'
          : 'Pengajuan withdrawal TapGo',
      child: Column(
        children: [
          if (adminSnapshot.isLoading)
            const _StatusSurface(
              icon: Icons.sync_rounded,
              title: 'Memuat withdrawal',
              subtitle: 'Mengambil daftar withdrawal...',
            )
          else if (withdrawals.isEmpty)
            const _StatusSurface(
              icon: Icons.payments_rounded,
              title: 'Belum ada withdrawal',
              subtitle: 'Pengajuan member akan muncul di sini.',
            )
          else
            ...withdrawals.map(
              (withdrawal) => _WithdrawalApprovalCard(
                withdrawal: withdrawal,
                status: _statuses[withdrawal.id] ?? withdrawal.status,
                canMarkPaid: canMarkPaid,
                onApprove: () => _processWithdrawal(
                  withdrawal.id,
                  'Approved',
                  () => _apiClient.approveWithdrawal(withdrawal.id),
                  adminSnapshot.hasValue,
                ),
                onReject: () => _processWithdrawal(
                  withdrawal.id,
                  'Rejected',
                  () => _apiClient.rejectWithdrawal(withdrawal.id),
                  adminSnapshot.hasValue,
                ),
                onPaid: () => _processWithdrawal(
                  withdrawal.id,
                  'Paid',
                  () => _apiClient.markWithdrawalPaid(withdrawal.id),
                  adminSnapshot.hasValue,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _processWithdrawal(
    String id,
    String status,
    Future<Map<String, dynamic>> Function() action,
    bool useApi,
  ) async {
    if (!useApi) {
      if (_isTapGoDevelopmentBuild) {
        _setStatus(id, status);
      }
      return;
    }

    try {
      final session = ref.read(_demoSessionProvider);
      _apiClient.setAccessToken(session.accessToken);
      await action();
      _setStatus(id, status);
      ref.invalidate(_adminConsoleSnapshotProvider);
      if (!mounted) {
        return;
      }
      _TapGoSnackbar.success(context, 'Withdrawal $status berhasil diproses.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      _TapGoSnackbar.error(context, 'Gagal proses withdrawal: $error');
    }
  }

  void _setStatus(String id, String status) {
    setState(() => _statuses[id] = status);
    if (_isTapGoDevelopmentBuild) {
      _persistentStore.saveWithdrawalStatuses(_statuses);
    }
  }

  Future<void> _restoreStatuses() async {
    if (!_isTapGoDevelopmentBuild) {
      return;
    }
    final saved = await _persistentStore.restoreWithdrawalStatuses();
    if (!mounted || saved.isEmpty) {
      return;
    }
    setState(() => _statuses.addAll(saved));
  }
}

class _WithdrawalApprovalCard extends StatelessWidget {
  const _WithdrawalApprovalCard({
    required this.withdrawal,
    required this.status,
    required this.canMarkPaid,
    required this.onApprove,
    required this.onReject,
    required this.onPaid,
  });

  final DemoAdminWithdrawal withdrawal;
  final String status;
  final bool canMarkPaid;
  final VoidCallback onApprove;
  final VoidCallback onReject;
  final VoidCallback onPaid;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      'Approved' => const Color(0xFF00A86B),
      'Rejected' => const Color(0xFFE51E3E),
      'Paid' => _brandBlue,
      _ => _brandOrange,
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  withdrawal.memberName,
                  style: const TextStyle(
                    color: Color(0xFF0A2A43),
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
              ),
              _LevelChip(label: status, active: true),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '${formatRupiah(withdrawal.amount)} • ${withdrawal.bank} • ${withdrawal.date}',
            style: TextStyle(color: color, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onReject,
                  icon: const Icon(Icons.close_rounded),
                  label: const Text('Reject'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: status == 'Approved'
                      ? (canMarkPaid ? onPaid : null)
                      : onApprove,
                  icon: const Icon(Icons.check_rounded),
                  label: Text(status == 'Approved' ? 'Paid' : 'Approve'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
