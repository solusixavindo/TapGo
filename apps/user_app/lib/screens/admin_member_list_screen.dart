part of '../main.dart';

class AdminMemberListScreen extends ConsumerStatefulWidget {
  const AdminMemberListScreen({super.key});

  @override
  ConsumerState<AdminMemberListScreen> createState() =>
      _AdminMemberListScreenState();
}

class _AdminMemberListScreenState extends ConsumerState<AdminMemberListScreen> {
  late Future<List<DemoAdminMember>> _registeredUsersFuture;

  @override
  void initState() {
    super.initState();
    _registeredUsersFuture = _isTapGoDevelopmentBuild
        ? _persistentStore.restoreRegisteredUsers()
        : Future.value(const <DemoAdminMember>[]);
  }

  @override
  Widget build(BuildContext context) {
    final adminSnapshot = ref.watch(_adminConsoleSnapshotProvider);
    final apiMembers = adminSnapshot.valueOrNull?.members
            .map(DemoAdminMember.fromApi)
            .toList(growable: false) ??
        const <DemoAdminMember>[];
    return _DemoScaffold(
      title: 'Member Management',
      subtitle: adminSnapshot.hasValue
          ? 'Live Data member backend'
          : 'Data member TapGo',
      child: FutureBuilder<List<DemoAdminMember>>(
        future: _registeredUsersFuture,
        builder: (context, snapshot) {
          final realUsers = snapshot.data ?? const <DemoAdminMember>[];
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _SearchBox(hint: 'Cari member, sponsor, atau paket...'),
              const SizedBox(height: 14),
              if (adminSnapshot.isLoading) ...[
                const _AdminListSectionLabel('Memuat Admin API...'),
              ] else if (apiMembers.isNotEmpty) ...[
                const _AdminListSectionLabel('Backend Members'),
                ...apiMembers.map((member) => _AdminMemberTile(member: member)),
                const SizedBox(height: 10),
              ],
              if (_isTapGoDevelopmentBuild && realUsers.isNotEmpty) ...[
                const _AdminListSectionLabel('Real Registered Users'),
                ...realUsers.map(
                  (member) => _AdminMemberTile(member: member),
                ),
                const SizedBox(height: 10),
              ],
              if (!adminSnapshot.isLoading &&
                  apiMembers.isEmpty &&
                  realUsers.isEmpty &&
                  !(_isTapGoDevelopmentBuild && !adminSnapshot.hasValue))
                _StatusSurface(
                  icon: adminSnapshot.hasError
                      ? Icons.cloud_off_rounded
                      : Icons.groups_rounded,
                  title: adminSnapshot.hasError
                      ? 'Data belum tersedia'
                      : 'Belum ada data member',
                  subtitle: adminSnapshot.hasError
                      ? 'Silakan muat ulang daftar member.'
                      : 'Member akan muncul setelah registrasi berhasil.',
                ),
              if (_isTapGoDevelopmentBuild && !adminSnapshot.hasValue) ...[
                const _AdminListSectionLabel('Data Sementara'),
                ..._demoAdminMembers.map(
                  (member) => _AdminMemberTile(member: member),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _AdminListSectionLabel extends StatelessWidget {
  const _AdminListSectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF718096),
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _AdminMemberTile extends StatelessWidget {
  const _AdminMemberTile({required this.member});

  final DemoAdminMember member;

  @override
  Widget build(BuildContext context) {
    final color = _packageAccent(member.packageName);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          onTap: () =>
              _openDemo(context, AdminMemberDetailScreen(member: member)),
          borderRadius: BorderRadius.circular(18),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: color.withValues(alpha: 0.12),
                  child: Text(
                    _initials(member.name),
                    style: TextStyle(color: color, fontWeight: FontWeight.w900),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        member.name,
                        style: const TextStyle(
                          color: Color(0xFF0A2A43),
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${member.packageName} • ${member.paymentStatus} • ${member.totalDownline} downline',
                        style: const TextStyle(
                          color: Color(0xFF718096),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded,
                    color: Color(0xFF718096)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
