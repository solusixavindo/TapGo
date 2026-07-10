part of '../main.dart';

void _openDemo(BuildContext context, Widget screen) {
  Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => screen),
  );
}

Widget _roleDashboardForContext(BuildContext context) {
  final session = ProviderScope.containerOf(context, listen: false)
      .read(_demoSessionProvider);
  if (session.isSuperAdmin) {
    return const SuperAdminDashboardScreen();
  }
  if (session.role == 'ADMIN') {
    return const AdminDashboardScreen();
  }
  return const TapGoDashboard();
}

void _safeBack(BuildContext context, {Widget? fallback}) {
  final navigator = Navigator.of(context);
  if (navigator.canPop()) {
    navigator.pop();
    return;
  }

  navigator.pushReplacement(
    MaterialPageRoute(
      builder: (_) => fallback ?? _roleDashboardForContext(context),
    ),
  );
}

Future<void> _confirmAndLogout(BuildContext context, WidgetRef ref) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Logout'),
      content: const Text('Apakah Anda yakin ingin keluar dari akun ini?'),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Batal'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          style: FilledButton.styleFrom(
            backgroundColor: _brandBlue,
            foregroundColor: Colors.white,
          ),
          child: const Text('Logout'),
        ),
      ],
    ),
  );

  if (confirmed != true || !context.mounted) {
    return;
  }

  _apiClient.setAccessToken(null);
  await _persistentStore.clearSession();
  ref.read(_demoSessionProvider.notifier).state = DemoClientSession.initial();
  ref.read(_isAuthenticatedProvider.notifier).state = false;

  if (!context.mounted) {
    return;
  }
  Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => const AuthScreen()),
    (_) => false,
  );
}

class _UploadDocumentField extends StatelessWidget {
  const _UploadDocumentField({
    required this.label,
    required this.emptyButtonLabel,
    required this.filledButtonLabel,
    required this.document,
    required this.onTap,
  });

  final String label;
  final String emptyButtonLabel;
  final String filledButtonLabel;
  final _PickedDemoDocument? document;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final uploaded = document != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OutlinedButton.icon(
          onPressed: onTap,
          icon: Icon(uploaded ? Icons.cached_rounded : Icons.upload_rounded),
          label: Text(uploaded ? filledButtonLabel : emptyButtonLabel),
          style: OutlinedButton.styleFrom(
            foregroundColor: uploaded ? const Color(0xFF00A86B) : _brandBlue,
            side: BorderSide(
              color: uploaded ? const Color(0xFF00A86B) : _brandBlue,
            ),
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          ),
        ),
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 220),
          child: uploaded
              ? _DocumentPreview(label: label, document: document!)
              : const SizedBox.shrink(),
        ),
      ],
    );
  }
}

class _DocumentPreview extends StatelessWidget {
  const _DocumentPreview({required this.label, required this.document});

  final String label;
  final _PickedDemoDocument document;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: ValueKey(document.fileName),
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEAF0F6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              height: 78,
              width: double.infinity,
              child: document.path == null
                  ? Container(
                      color: const Color(0xFFEAF7FF),
                      alignment: Alignment.center,
                      child: const Icon(
                        Icons.image_rounded,
                        color: _brandBlue,
                        size: 32,
                      ),
                    )
                  : Image.file(
                      File(document.path!),
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                        color: const Color(0xFFEAF7FF),
                        alignment: Alignment.center,
                        child: const Icon(
                          Icons.image_rounded,
                          color: _brandBlue,
                          size: 32,
                        ),
                      ),
                    ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            document.statusLabel,
            style: const TextStyle(
              color: Color(0xFF00A86B),
              fontSize: 11,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            document.fileName.isEmpty ? label : document.fileName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(0xFF718096),
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _DemoScaffold extends StatelessWidget {
  const _DemoScaffold({
    required this.title,
    required this.subtitle,
    required this.child,
    this.showBackButton = true,
  });

  final String title;
  final String subtitle;
  final Widget child;
  final bool showBackButton;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (showBackButton) ...[
                    IconButton.filledTonal(
                      onPressed: () => _safeBack(context),
                      icon: const Icon(Icons.arrow_back_rounded),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            color: Color(0xFF0A2A43),
                            fontSize: 24,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          subtitle,
                          style: const TextStyle(
                            color: Color(0xFF718096),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              child,
            ],
          ),
        ),
      ),
    );
  }
}

class _ProductionStatusTile extends ConsumerWidget {
  const _ProductionStatusTile({required this.state});

  final AsyncValue<_TapGoProductionSnapshot> state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (state.isLoading) {
      return const _StatusSurface(
        icon: Icons.sync_rounded,
        title: 'Memuat data backend',
        subtitle: 'Menyiapkan data production TapGo...',
      );
    }

    if (state.hasError) {
      return _RetryStatusSurface(
        icon: Icons.cloud_off_rounded,
        title: 'Data belum tersedia',
        subtitle: 'Koneksi data belum berhasil dimuat.',
        onRetry: () => ref.invalidate(_productionSnapshotProvider),
      );
    }

    return const _StatusSurface(
      icon: Icons.cloud_done_rounded,
      title: 'Data backend aktif',
      subtitle: 'Membership, referral, dan wallet tersinkron.',
    );
  }
}

class _RetryStatusSurface extends StatelessWidget {
  const _RetryStatusSurface({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onRetry,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFEAF0F6)),
      ),
      child: Row(
        children: [
          Icon(icon, color: _brandBlue, size: 26),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Color(0xFF0A2A43),
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: Color(0xFF718096),
                    fontSize: 12,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: onRetry,
            child: const Text('Muat Ulang'),
          ),
        ],
      ),
    );
  }
}

class _StatusSurface extends StatelessWidget {
  const _StatusSurface({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Icon(icon, color: _brandBlue),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Color(0xFF0A2A43),
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: Color(0xFF718096),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DemoMenuTile extends StatelessWidget {
  const _DemoMenuTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: const Color(0xFFEAF7FF),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Icon(icon, color: _brandBlue),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          color: Color(0xFF0A2A43),
                          fontWeight: FontWeight.w900,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        subtitle,
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
