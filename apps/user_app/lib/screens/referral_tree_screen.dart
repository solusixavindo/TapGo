part of '../main.dart';

class ReferralTreeScreen extends ConsumerStatefulWidget {
  const ReferralTreeScreen({super.key});

  @override
  ConsumerState<ReferralTreeScreen> createState() => _ReferralTreeScreenState();
}

class _ReferralTreeScreenState extends ConsumerState<ReferralTreeScreen> {
  late DemoReferralNode _root;
  _ReferralTreeFilter _selectedFilter = _ReferralTreeFilter.all;
  DateTime? _lastBackendTreeAt;
  final Set<String> _collapsedNodeIds = <String>{};

  @override
  void initState() {
    super.initState();
    final session = ref.read(_demoSessionProvider);
    _root = tapGoDisablePersistenceForTests || _isTapGoDevelopmentBuild
        ? _demoReferralTreeRoot()
        : DemoReferralNode(
            id: session.userId ?? 'root',
            name: session.userName,
            packageName: session.activePackageName,
            level: 0,
            bonus: 0,
            totalDownline: session.downline,
            children: const [],
          );
    ref.listenManual(_productionSnapshotProvider, (_, next) {
      final tree = next.valueOrNull?.referralTree;
      final loadedAt = next.valueOrNull?.loadedAt;
      if (tree == null || loadedAt == null || loadedAt == _lastBackendTreeAt) {
        return;
      }
      setState(() {
        final session = ref.read(_demoSessionProvider);
        _root = DemoReferralNode(
          id: session.userId ?? tree.id,
          name: session.userName,
          packageName: session.activePackageName,
          level: 0,
          bonus: 0,
          totalDownline: session.downline,
          isExpanded: true,
          children: tree.children,
        );
        _lastBackendTreeAt = loadedAt;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final production = ref.watch(_productionSnapshotProvider);
    final session = ref.watch(_demoSessionProvider);
    final backendTree = production.valueOrNull?.referralTree;
    final displayedRoot = backendTree == null
        ? _root
        : _applyExpansionState(_rootFromBackendTree(backendTree, session));
    return _DemoScaffold(
      title: 'Jaringan Referral',
      subtitle: production.hasValue
          ? 'Jaringan unilevel TapGo'
          : 'Jaringan unilevel TapGo 10 level',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _ProductionStatusTile(state: production),
          const SizedBox(height: 12),
          _ReferralTreeSummary(
            session: session,
          ),
          const SizedBox(height: 16),
          _ReferralFilterChips(
            selected: _selectedFilter,
            onSelected: (filter) => setState(() => _selectedFilter = filter),
          ),
          const SizedBox(height: 16),
          _ReferralTreeNodeWidget(
            node: displayedRoot,
            depth: 0,
            selectedFilter: _selectedFilter,
            onToggle: _toggleNode,
          ),
          if (displayedRoot.children.isEmpty) ...[
            const SizedBox(height: 12),
            const _EmptyState(
              icon: Icons.account_tree_rounded,
              title: 'Belum ada referral',
              subtitle:
                  'Downline akan muncul setelah member memakai kode referral.',
            ),
          ],
        ],
      ),
    );
  }

  void _toggleNode(String id) {
    setState(() {
      if (!_collapsedNodeIds.add(id)) {
        _collapsedNodeIds.remove(id);
      }
      _root = _toggleNodeById(_root, id);
    });
  }

  DemoReferralNode _rootFromBackendTree(
    DemoReferralNode tree,
    DemoClientSession session,
  ) {
    return DemoReferralNode(
      id: session.userId ?? tree.id,
      name: session.userName,
      packageName: session.activePackageName,
      level: 0,
      bonus: tree.bonus,
      totalDownline: session.downline,
      isExpanded: true,
      children: tree.children,
    );
  }

  DemoReferralNode _applyExpansionState(DemoReferralNode node) {
    return node.copyWith(
      isExpanded: !_collapsedNodeIds.contains(node.id),
      children: node.children.map(_applyExpansionState).toList(growable: false),
    );
  }

  DemoReferralNode _toggleNodeById(DemoReferralNode node, String id) {
    if (node.id == id) {
      return node.copyWith(isExpanded: !node.isExpanded);
    }
    return node.copyWith(
      children: node.children
          .map((child) => _toggleNodeById(child, id))
          .toList(growable: false),
    );
  }
}

class _ReferralTreeSummary extends StatelessWidget {
  const _ReferralTreeSummary({required this.session});

  final DemoClientSession session;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(
            color: Color(0x10000000),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _MiniMetric(
                  label: 'Direct Sponsor',
                  value: '${session.directSponsor}',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MiniMetric(
                  label: 'Total Downline',
                  value: '${session.downline}',
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _MiniMetric(
                  label: 'Level Aktif',
                  value: '${session.activeLevel}',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MiniMetric(
                  label: tapGoIsPlayDistribution
                      ? 'Status Referral'
                      : 'Estimasi Bonus',
                  value: tapGoIsPlayDistribution
                      ? 'Aktif'
                      : formatRupiah(session.todayBonus),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ReferralFilterChips extends StatelessWidget {
  const _ReferralFilterChips({
    required this.selected,
    required this.onSelected,
  });

  final _ReferralTreeFilter selected;
  final ValueChanged<_ReferralTreeFilter> onSelected;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: _ReferralTreeFilter.values
            .map(
              (filter) => Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text(filter.label),
                  selected: selected == filter,
                  selectedColor: _brandBlue,
                  labelStyle: TextStyle(
                    color: selected == filter
                        ? Colors.white
                        : const Color(0xFF263241),
                    fontWeight: FontWeight.w800,
                  ),
                  onSelected: (_) => onSelected(filter),
                ),
              ),
            )
            .toList(),
      ),
    );
  }
}
