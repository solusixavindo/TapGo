part of '../main.dart';

class ActivityItem {
  const ActivityItem(
    this.category,
    this.icon,
    this.title,
    this.description,
    this.amount,
    this.status,
    this.date, [
    this.at,
  ]);

  final String category;
  final IconData icon;
  final String title;
  final String description;
  final String? amount;
  final String status;
  final String date;

  /// Waktu kejadian untuk mengurutkan; null bila server tidak mengirimnya.
  final DateTime? at;
}

class _SuperMenuGroup {
  const _SuperMenuGroup(this.title, this.items);

  final String title;
  final List<_SuperMenuItem> items;
}

class _SuperMenuItem {
  const _SuperMenuItem(this.label, this.icon);

  final String label;
  final IconData icon;
}
