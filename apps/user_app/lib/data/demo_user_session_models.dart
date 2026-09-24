part of '../main.dart';

class _ActivityItem {
  const _ActivityItem(
    this.category,
    this.icon,
    this.title,
    this.description,
    this.amount,
    this.status,
    this.date,
  );

  final String category;
  final IconData icon;
  final String title;
  final String description;
  final String? amount;
  final String status;
  final String date;
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
