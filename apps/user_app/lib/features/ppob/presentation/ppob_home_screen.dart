import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

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

class _PpobCategoryTile extends StatefulWidget {
  const _PpobCategoryTile({required this.category});

  final PpobCategory category;

  @override
  State<_PpobCategoryTile> createState() => _PpobCategoryTileState();
}

/// Feedback tekan halus (scale 0.97x) + shadow lembut bertinta warna
/// kategori, menggantikan kartu flat + ripple polos sebelumnya — laporan
/// Owner: tampilan kartu PPOB perlu dipoles agar terasa lebih premium.
class _PpobCategoryTileState extends State<_PpobCategoryTile> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (_pressed != value) {
      setState(() => _pressed = value);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final category = widget.category;
    final illustration = ppobCategoryIllustrationAsset(category.code);
    final icon = ppobCategoryIcon(category.icon, categoryCode: category.code);
    final accent = ppobCategoryColor(category.code);

    return GestureDetector(
      onTapDown: (_) => _setPressed(true),
      onTapCancel: () => _setPressed(false),
      onTapUp: (_) => _setPressed(false),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PpobCategoryScreen(category: category),
        ),
      ),
      child: AnimatedScale(
        scale: _pressed ? 0.97 : 1.0,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
        child: Container(
          decoration: BoxDecoration(
            color: theme.cardColor,
            borderRadius: BorderRadius.circular(18),
            boxShadow: [
              BoxShadow(
                color: accent.withValues(alpha: 0.16),
                blurRadius: 16,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          padding: const EdgeInsets.all(12),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (illustration != null)
                SvgPicture.asset(
                  illustration,
                  width: 44,
                  height: 44,
                  fit: BoxFit.contain,
                  clipBehavior: Clip.none,
                )
              else
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: ppobCategoryColor(category.code).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    icon,
                    color: ppobCategoryColor(category.code),
                    size: 22,
                  ),
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

/// Layar untuk kategori PPOB yang BELUM tersedia di katalog server (mis.
/// BPJS/PDAM sebelum penyedia mengaktifkan layanan tersebut untuk akun kami).
///
/// Akar masalah yang diperbaiki: tile Super Menu (Pulsa/Data/PLN/E-Wallet/
/// BPJS/PDAM) sebelumnya membuka kategori ini lewat tautan langsung
/// (tapGoOpenPpobCategory) yang, saat kategorinya tidak ditemukan di katalog,
/// diam-diam jatuh ke [PpobHomeScreen] (judul "PPOB") — pengguna menekan
/// "BPJS" tetapi melihat grid kategori PPOB umum tanpa penjelasan. Sekarang
/// tile yang belum tersedia membuka layar khusus ini, yang menyebut nama
/// layanannya dan alasannya secara jujur, dengan jalan keluar ke katalog PPOB
/// yang sungguhan aktif.
class PpobCategoryUnavailableScreen extends StatelessWidget {
  const PpobCategoryUnavailableScreen({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(label)),
      body: PpobNoticeView(
        icon: Icons.hourglass_top_rounded,
        title: '$label belum tersedia',
        message:
            'Kami sedang menyiapkan layanan $label bersama mitra penyedia. '
            'Sementara itu, Pulsa, Paket Data, dan Token PLN sudah bisa dipakai.',
        actionLabel: 'Buka Katalog PPOB',
        onAction: () => Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(builder: (_) => const PpobHomeScreen()),
        ),
      ),
    );
  }
}
