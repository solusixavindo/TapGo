part of '../main.dart';

String _formatCompactRupiah(int value) {
  if (value >= 1000000) {
    final compact = value / 1000000;
    final text = compact == compact.roundToDouble()
        ? compact.toStringAsFixed(0)
        : compact.toStringAsFixed(1).replaceAll('.', ',');
    return 'Rp$text jt';
  }
  if (value >= 1000) {
    return 'Rp${(value / 1000).round()} rb';
  }
  return formatRupiah(value);
}

class _PlayStatusPill extends StatelessWidget {
  const _PlayStatusPill({required this.label, this.emphasized = false});

  final String label;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
      decoration: BoxDecoration(
        // Emas TapGo (D4AF37), sama dengan Kartu Anggota resmi — sebelumnya
        // kuning (FFD166) dan terbaca sebagai warna berbeda dari logo.
        color: emphasized
            ? const Color(0xFFD4AF37)
            : Colors.white.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: emphasized
              ? const Color(0xFF9C7C1E)
              : Colors.white.withValues(alpha: 0.38),
        ),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: emphasized ? const Color(0xFF5A3D00) : Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w900,
          decoration: TextDecoration.none,
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    // Dipakai langsung di atas latar Scaffold (bukan di dalam kartu putih),
    // jadi warna teks harus ikut tema — sebelumnya navy/abu-abu hardcode di
    // sini nyaris tak terbaca di atas Scaffold gelap.
    final colorScheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: TextStyle(
            color: colorScheme.onSurface,
            fontSize: 26,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: TextStyle(
            color: colorScheme.onSurfaceVariant,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _SearchBox extends StatelessWidget {
  const _SearchBox({required this.hint});

  final String hint;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 54,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Row(
        children: [
          const Icon(Icons.search_rounded, color: _brandBlue),
          const SizedBox(width: 10),
          Expanded(
            child: Text(hint, style: const TextStyle(color: Color(0xFF718096))),
          ),
        ],
      ),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.item});

  final _ActivityItem item;

  @override
  Widget build(BuildContext context) {
    final amountColor = item.amount?.startsWith('-') ?? false
        ? const Color(0xFFE51E3E)
        : const Color(0xFF00A86B);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: _brandBlue.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(15),
            ),
            child: Icon(item.icon, color: _brandBlue),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: const TextStyle(
                    color: Color(0xFF0A2A43),
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  item.description,
                  style: const TextStyle(
                    color: Color(0xFF718096),
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  '${item.status} • ${item.date}',
                  style: const TextStyle(
                    color: Color(0xFF718096),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          if (item.amount != null)
            Text(
              item.amount!,
              style: TextStyle(color: amountColor, fontWeight: FontWeight.w900),
            ),
        ],
      ),
    );
  }
}

class _AccountHero extends StatelessWidget {
  const _AccountHero({required this.session, this.avatarBytes});

  final DemoClientSession session;
  final Uint8List? avatarBytes;

  @override
  Widget build(BuildContext context) {
    // Sengaja dibuat berbeda secara struktural dari kartu menu putih di
    // bawahnya (bukan cuma beda warna) — sudut lebih besar, aksen emas
    // brand TapGo, cincin bercahaya di sekitar avatar, dan sapuan cahaya
    // berjalan (_ShineSweep) — supaya terasa seperti "kartu identitas",
    // bukan salah satu baris menu. Owner sebelumnya menilai versi flat
    // sebelumnya kurang menarik dan tidak cukup beda dari menu di bawahnya.
    //
    // Palet emas SAMA PERSIS dengan Kartu Anggota resmi (F6D47C/D4AF37/
    // 9C7C1E, lihat _MemberCardEmvChip di dashboard_screen.dart) — owner
    // menilai gradien kuning-oranye sebelumnya (FFD166/FFB000) terbaca
    // "kuning", bukan emas TapGo. Border emas tipis + watermark logo
    // ditambahkan supaya kartu ini terasa sekelas kartu anggota, bukan
    // sekadar header halaman.
    return Container(
      key: const ValueKey('play_profile_header'),
      width: double.infinity,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        border: Border.all(
          color: const Color(0xFFD4AF37).withValues(alpha: 0.6),
          width: 1.4,
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x400B3A6E),
            blurRadius: 30,
            offset: Offset(0, 16),
          ),
          BoxShadow(
            color: Color(0x33D4AF37),
            blurRadius: 20,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: Stack(
          children: [
            const Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Color(0xFF061A2E),
                      Color(0xFF0B3A6E),
                      Color(0xFF0569E8),
                    ],
                  ),
                ),
              ),
            ),
            const Positioned.fill(child: _ShineSweep()),
            // Watermark logo, samar di pojok kanan bawah — bahasa visual
            // yang sama dengan Kartu Anggota resmi (basic_member_card_surface).
            Positioned(
              right: -18,
              bottom: -18,
              child: IgnorePointer(
                child: Opacity(
                  opacity: 0.10,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(20),
                    child: Image.asset(
                      'assets/images/tapgo_logo.jpeg',
                      width: 96,
                      height: 96,
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
              ),
            ),
            // Garis aksen emas tipis di tepi atas — menyatukan warna biru
            // korporat dengan emas logo TapGo, sekaligus jadi pembeda
            // visual instan dari kartu putih polos di bawahnya.
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: Container(
                height: 4,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      Color(0xFFF6D47C),
                      Color(0xFFD4AF37),
                      Color(0xFF9C7C1E),
                    ],
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 24, 18, 30),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: const LinearGradient(
                        colors: [
                          Color(0xFFF6D47C),
                          Color(0xFFD4AF37),
                          Color(0xFF9C7C1E),
                        ],
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFFD4AF37).withValues(
                            alpha: 0.5,
                          ),
                          blurRadius: 16,
                          spreadRadius: 1,
                        ),
                      ],
                    ),
                    child: ClipOval(
                      child: SizedBox(
                        width: 72,
                        height: 72,
                        child: avatarBytes != null
                            ? Image.memory(
                                avatarBytes!,
                                width: 72,
                                height: 72,
                                fit: BoxFit.cover,
                              )
                            : const PremiumTapGoIcon(
                                label: 'Profil',
                                fallbackIcon: Icons.person_rounded,
                                size: 72,
                                padding: 3,
                              ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          session.userName,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            height: 1.12,
                            fontWeight: FontWeight.w900,
                            decoration: TextDecoration.none,
                          ),
                        ),
                        const SizedBox(height: 12),
                        const Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            _PlayStatusPill(label: 'Basic', emphasized: true),
                            _PlayStatusPill(label: 'Aktif'),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AccountMenuTile extends StatelessWidget {
  const _AccountMenuTile(this.title, this.icon, this.onTap, {this.subtitle});

  final String title;
  final IconData icon;
  final VoidCallback onTap;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return _DemoMenuTile(
      icon: icon,
      title: title,
      subtitle: subtitle ?? 'Lihat detail $title',
      onTap: onTap,
    );
  }
}


class _SuperMenuTile extends StatelessWidget {
  const _SuperMenuTile({required this.item, required this.onTap});

  final _SuperMenuItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final style = _serviceIconStyle(item.label);
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(22),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 4),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _ServiceAssetIcon(
                label: item.label,
                icon: item.icon,
                style: style,
                size: 72,
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: 76,
                height: 18,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    item.label,
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.visible,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFF263241),
                      fontSize: 12.5,
                      height: 1,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final reduced = _TapGoMotion.reduce(context);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: reduced ? 1 : 0, end: 1),
      duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
      curve: _TapGoMotion.standardCurve,
      builder: (context, value, child) => Opacity(
        opacity: value,
        child: Transform.translate(
          offset: Offset(0, (1 - value) * 8),
          child: child,
        ),
      ),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
          border:
              Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        ),
        child: Column(
          children: [
            Icon(icon, color: _brandBlue, size: 44),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF0A2A43),
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF718096)),
            ),
          ],
        ),
      ),
    );
  }
}
