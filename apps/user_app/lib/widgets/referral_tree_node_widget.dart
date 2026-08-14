part of '../main.dart';

class _ReferralTreeNodeWidget extends StatelessWidget {
  const _ReferralTreeNodeWidget({
    required this.node,
    required this.depth,
    required this.selectedFilter,
    required this.onToggle,
  });

  final DemoReferralNode node;
  final int depth;
  final _ReferralTreeFilter selectedFilter;
  final ValueChanged<String> onToggle;

  @override
  Widget build(BuildContext context) {
    final isVisibleByFilter = selectedFilter.level == null ||
        node.level == 0 ||
        node.level <= selectedFilter.level!;

    return AnimatedSize(
      duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
      curve: _TapGoMotion.standardCurve,
      alignment: Alignment.topCenter,
      child: !isVisibleByFilter
          ? const SizedBox.shrink()
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: EdgeInsets.only(left: depth * 18.0, bottom: 10),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (depth > 0) const _TreeConnector(),
                      Expanded(
                        child: _ReferralNodeCard(
                          node: node,
                          onTap: node.hasChildren
                              ? () => onToggle(node.id)
                              : () {},
                        ),
                      ),
                    ],
                  ),
                ),
                AnimatedSwitcher(
                  duration: _TapGoMotion.duration(
                    context,
                    _TapGoMotion.standard,
                  ),
                  switchInCurve: _TapGoMotion.standardCurve,
                  switchOutCurve: _TapGoMotion.exitCurve,
                  transitionBuilder: (child, animation) => SizeTransition(
                    sizeFactor: animation,
                    alignment: Alignment.topCenter,
                    child: FadeTransition(opacity: animation, child: child),
                  ),
                  child: node.isExpanded
                      ? Column(
                          key: ValueKey('${node.id}-expanded'),
                          children: node.children
                              .map(
                                (child) => _ReferralTreeNodeWidget(
                                  node: child,
                                  depth: depth + 1,
                                  selectedFilter: selectedFilter,
                                  onToggle: onToggle,
                                ),
                              )
                              .toList(growable: false),
                        )
                      : SizedBox.shrink(key: ValueKey('${node.id}-collapsed')),
                ),
              ],
            ),
    );
  }
}

class _ReferralNodeCard extends StatelessWidget {
  const _ReferralNodeCard({required this.node, required this.onTap});

  final DemoReferralNode node;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final accent = _packageAccent(node.packageName);

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFEAF0F6)),
            boxShadow: const [
              BoxShadow(
                color: Color(0x0C000000),
                blurRadius: 14,
                offset: Offset(0, 8),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Text(
                  _initials(node.name),
                  style: TextStyle(color: accent, fontWeight: FontWeight.w900),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            node.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF0A2A43),
                              fontSize: 15,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        _ReferralLevelBadge(level: node.level),
                      ],
                    ),
                    const SizedBox(height: 7),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        _ReferralMetaChip(
                          icon: Icons.workspace_premium_rounded,
                          label: node.packageName,
                          color: accent,
                        ),
                        _ReferralMetaChip(
                          icon: Icons.account_tree_rounded,
                          label: '${node.totalDownline} downline',
                          color: _brandBlue,
                        ),
                        _ReferralMetaChip(
                          icon: Icons.payments_rounded,
                          label: formatRupiah(node.bonus),
                          color: const Color(0xFF00A86B),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              if (node.hasChildren)
                AnimatedRotation(
                  turns: node.isExpanded ? 0.5 : 0,
                  duration: _TapGoMotion.duration(context, _TapGoMotion.quick),
                  child: const Icon(
                    Icons.keyboard_arrow_down_rounded,
                    color: Color(0xFF718096),
                  ),
                )
              else
                const Icon(Icons.circle, size: 7, color: Color(0xFFCBD5E1)),
            ],
          ),
        ),
      ),
    );
  }
}

class _TreeConnector extends StatelessWidget {
  const _TreeConnector();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 18,
      height: 58,
      child: CustomPaint(painter: _TreeConnectorPainter()),
    );
  }
}

class _TreeConnectorPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFFCBD5E1)
      ..strokeWidth = 1.6
      ..style = PaintingStyle.stroke;
    final path = Path()
      ..moveTo(size.width / 2, 0)
      ..lineTo(size.width / 2, size.height / 2)
      ..lineTo(size.width, size.height / 2);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _ReferralLevelBadge extends StatelessWidget {
  const _ReferralLevelBadge({required this.level});

  final int level;

  @override
  Widget build(BuildContext context) {
    final label = level == 0 ? 'Root' : 'Level $level';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: level == 0 ? _brandOrange : _brandBlue,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 10,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _ReferralMetaChip extends StatelessWidget {
  const _ReferralMetaChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

Color _packageAccent(String packageName) {
  return switch (packageName) {
    'Platinum' => const Color(0xFF0A2A43),
    'Gold' => _brandOrange,
    'Silver' => _brandBlue,
    _ => const Color(0xFF697386),
  };
}

String _initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+'));
  if (parts.length == 1) {
    return parts.first.characters.take(2).toString().toUpperCase();
  }
  return '${parts.first.characters.first}${parts.last.characters.first}'
      .toUpperCase();
}
