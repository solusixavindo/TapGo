import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/ppob_providers.dart';
import '../domain/ppob_models.dart';
import 'ppob_category_screen.dart';
import 'ppob_history_screen.dart';
import 'widgets/ppob_shared.dart';

/// Beranda PPOB: grid kategori produk digital.
///
/// Semua data berasal dari [ppobCatalogProvider] (backend); layar ini tidak
/// memuat tautan keluar, WebView, atau ajakan pembayaran eksternal — pembelian
/// sepenuhnya memakai saldo internal TapGo (kepatuhan Play, Stage R2.6).
class PpobHomeScreen extends ConsumerWidget {
  const PpobHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalog = ref.watch(ppobCatalogProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('PPOB'),
        actions: [
          IconButton(
            icon: const Icon(Icons.receipt_long_rounded),
            tooltip: 'Riwayat Transaksi',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const PpobHistoryScreen(),
              ),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(ppobCatalogProvider),
        child: switch (catalog) {
          AsyncData(:final value) => value.isEmpty
              ? const PpobNoticeView(
                  icon: Icons.inventory_2_outlined,
                  title: 'Katalog kosong',
                  message:
                      'Produk PPOB belum tersedia. Silakan kembali nanti.',
                )
              : _PpobCategoryGrid(categories: value),
          AsyncError(:final error) => PpobNoticeView(
              icon: Icons.cloud_off_rounded,
              title: 'Gagal memuat katalog',
              message: ppobErrorMessage(error),
              actionLabel: 'Coba Lagi',
              onAction: () => ref.invalidate(ppobCatalogProvider),
            ),
          _ => const Center(child: CircularProgressIndicator()),
        },
      ),
    );
  }
}

class _PpobCategoryGrid extends StatelessWidget {
  const _PpobCategoryGrid({required this.categories});

  final List<PpobCategory> categories;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final crossAxisCount = constraints.maxWidth >= 600 ? 4 : 3;
        return GridView.builder(
          padding: const EdgeInsets.all(16),
          physics: const AlwaysScrollableScrollPhysics(),
          itemCount: categories.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: crossAxisCount,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            // Tinggi sel tetap (bukan rasio) supaya isi kartu tidak overflow
            // pada lebar sempit (320 dp) — isi tile ≈ padding 24 + ikon 44 +
            // gap 10 + teks 2 baris ≈ 112 px.
            mainAxisExtent: 120,
          ),
          itemBuilder: (context, index) {
            final category = categories[index];
            return _PpobCategoryTile(category: category);
          },
        );
      },
    );
  }
}

class _PpobCategoryTile extends StatelessWidget {
  const _PpobCategoryTile({required this.category});

  final PpobCategory category;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final icon = ppobCategoryIcon(category.icon);

    return Material(
      color: theme.cardColor,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => PpobCategoryScreen(category: category),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: theme.colorScheme.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: theme.colorScheme.primary, size: 22),
              ),
              const SizedBox(height: 10),
              Text(
                category.name,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
