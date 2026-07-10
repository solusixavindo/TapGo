part of '../main.dart';

enum _ReferralTreeFilter {
  all('Semua', null),
  level1('Level 1', 1),
  level3('Level 3', 3),
  level5('Level 5', 5),
  level10('Level 10', 10);

  const _ReferralTreeFilter(this.label, this.level);

  final String label;
  final int? level;
}

class DemoReferralNode {
  const DemoReferralNode({
    required this.id,
    required this.name,
    required this.packageName,
    required this.level,
    required this.bonus,
    required this.totalDownline,
    required this.children,
    this.isExpanded = true,
  });

  final String id;
  final String name;
  final String packageName;
  final int level;
  final int bonus;
  final int totalDownline;
  final List<DemoReferralNode> children;
  final bool isExpanded;

  bool get hasChildren => children.isNotEmpty;

  DemoReferralNode copyWith({
    List<DemoReferralNode>? children,
    bool? isExpanded,
  }) {
    return DemoReferralNode(
      id: id,
      name: name,
      packageName: packageName,
      level: level,
      bonus: bonus,
      totalDownline: totalDownline,
      children: children ?? this.children,
      isExpanded: isExpanded ?? this.isExpanded,
    );
  }
}

DemoReferralNode _demoReferralTreeRoot() {
  return const DemoReferralNode(
    id: 'root',
    name: 'Solusi Digital',
    packageName: 'Platinum',
    level: 0,
    bonus: 1300000,
    totalDownline: 124,
    children: [
      DemoReferralNode(
        id: 'budi',
        name: 'Budi Santoso',
        packageName: 'Platinum',
        level: 1,
        bonus: 400000,
        totalDownline: 18,
        children: [
          DemoReferralNode(
            id: 'andi-budi',
            name: 'Andi Budi',
            packageName: 'Gold',
            level: 2,
            bonus: 180000,
            totalDownline: 9,
            children: [
              DemoReferralNode(
                id: 'maya-andini',
                name: 'Maya Andini',
                packageName: 'Silver',
                level: 3,
                bonus: 90000,
                totalDownline: 6,
                children: [
                  DemoReferralNode(
                    id: 'agus-maulana',
                    name: 'Agus Maulana',
                    packageName: 'Gold',
                    level: 4,
                    bonus: 70000,
                    totalDownline: 4,
                    children: [
                      DemoReferralNode(
                        id: 'lina-agustina',
                        name: 'Lina Agustina',
                        packageName: 'Silver',
                        level: 5,
                        bonus: 55000,
                        totalDownline: 3,
                        children: [
                          DemoReferralNode(
                            id: 'rama-fadli',
                            name: 'Rama Fadli',
                            packageName: 'Basic',
                            level: 6,
                            bonus: 30000,
                            totalDownline: 2,
                            children: [
                              DemoReferralNode(
                                id: 'salsa-nabila',
                                name: 'Salsa Nabila',
                                packageName: 'Silver',
                                level: 7,
                                bonus: 22000,
                                totalDownline: 2,
                                children: [
                                  DemoReferralNode(
                                    id: 'wahyu-prasetyo',
                                    name: 'Wahyu Prasetyo',
                                    packageName: 'Gold',
                                    level: 8,
                                    bonus: 18000,
                                    totalDownline: 1,
                                    children: [
                                      DemoReferralNode(
                                        id: 'nina-kartika',
                                        name: 'Nina Kartika',
                                        packageName: 'Silver',
                                        level: 9,
                                        bonus: 12000,
                                        totalDownline: 1,
                                        children: [
                                          DemoReferralNode(
                                            id: 'arif-rahman',
                                            name: 'Arif Rahman',
                                            packageName: 'Basic',
                                            level: 10,
                                            bonus: 8000,
                                            totalDownline: 0,
                                            children: [],
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      DemoReferralNode(
        id: 'citra',
        name: 'Citra Lestari',
        packageName: 'Gold',
        level: 1,
        bonus: 240000,
        totalDownline: 15,
        children: [
          DemoReferralNode(
            id: 'rina-citra',
            name: 'Rina Citra',
            packageName: 'Silver',
            level: 2,
            bonus: 120000,
            totalDownline: 7,
            children: [
              DemoReferralNode(
                id: 'yoga-cahyadi',
                name: 'Yoga Cahyadi',
                packageName: 'Silver',
                level: 3,
                bonus: 60000,
                totalDownline: 3,
                children: [],
              ),
            ],
          ),
        ],
      ),
      DemoReferralNode(
        id: 'dedi',
        name: 'Dedi Pratama',
        packageName: 'Silver',
        level: 1,
        bonus: 120000,
        totalDownline: 12,
        children: [
          DemoReferralNode(
            id: 'bayu-dedi',
            name: 'Bayu Dedi',
            packageName: 'Gold',
            level: 2,
            bonus: 100000,
            totalDownline: 5,
            children: [
              DemoReferralNode(
                id: 'putri-maharani',
                name: 'Putri Maharani',
                packageName: 'Basic',
                level: 3,
                bonus: 45000,
                totalDownline: 2,
                children: [],
              ),
            ],
          ),
        ],
      ),
      DemoReferralNode(
        id: 'eka',
        name: 'Eka Putri',
        packageName: 'Platinum',
        level: 1,
        bonus: 400000,
        totalDownline: 14,
        children: [],
      ),
      DemoReferralNode(
        id: 'fajar',
        name: 'Fajar Nugroho',
        packageName: 'Gold',
        level: 1,
        bonus: 240000,
        totalDownline: 13,
        children: [],
      ),
      DemoReferralNode(
        id: 'gina',
        name: 'Gina Amelia',
        packageName: 'Silver',
        level: 1,
        bonus: 120000,
        totalDownline: 11,
        children: [],
      ),
      DemoReferralNode(
        id: 'hendra',
        name: 'Hendra Wijaya',
        packageName: 'Gold',
        level: 1,
        bonus: 240000,
        totalDownline: 10,
        children: [],
      ),
      DemoReferralNode(
        id: 'intan',
        name: 'Intan Sari',
        packageName: 'Silver',
        level: 1,
        bonus: 120000,
        totalDownline: 9,
        children: [],
      ),
      DemoReferralNode(
        id: 'joko',
        name: 'Joko Susilo',
        packageName: 'Basic',
        level: 1,
        bonus: 2000,
        totalDownline: 8,
        children: [],
      ),
      DemoReferralNode(
        id: 'kurniawan',
        name: 'Kurniawan',
        packageName: 'Platinum',
        level: 1,
        bonus: 400000,
        totalDownline: 14,
        children: [],
      ),
    ],
  );
}
