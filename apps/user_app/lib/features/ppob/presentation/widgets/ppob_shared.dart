import 'package:flutter/material.dart';

import '../../domain/ppob_models.dart';

/// Format tampilan rupiah tanpa dependency intl: Rp11.500.
String ppobFormatRupiah(double value) {
  final rounded = value.round();
  final digits = rounded.toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    final remaining = digits.length - i;
    buffer.write(digits[i]);
    if (remaining > 1 && remaining % 3 == 1) {
      buffer.write('.');
    }
  }
  return 'Rp${buffer.toString()}';
}

/// Label status order PPOB dalam Bahasa Indonesia.
String ppobStatusLabel(PpobOrderStatus status) {
  return switch (status) {
    PpobOrderStatus.pending => 'Menunggu',
    PpobOrderStatus.processing => 'Diproses',
    PpobOrderStatus.success => 'Berhasil',
    PpobOrderStatus.failed => 'Gagal',
    PpobOrderStatus.refunded => 'Dikembalikan',
    PpobOrderStatus.unknown => 'Tidak diketahui',
  };
}

/// Ikon kategori PPOB.
///
/// Preferensi: kode kategori menentukan ikon (stabil meski backend belum
/// mengirim `icon`); nama ikon lama tetap didukung sebagai cadangan untuk
/// environment yang telah mengirim `icon` — dan tidak pernah membiarkan dua
/// kategori ber-ikon sama.
IconData ppobCategoryIcon(String? iconName, {String? categoryCode}) {
  final byCode = switch (categoryCode) {
    'PULSA' => Icons.phone_iphone_rounded,
    'DATA' => Icons.wifi_rounded,
    'PLN_PREPAID' => Icons.bolt_rounded,
    'PLN_POSTPAID' => Icons.receipt_rounded,
    'BPJS' => Icons.health_and_safety_rounded,
    'EWALLET' => Icons.account_balance_wallet_rounded,
    'PDAM' => Icons.water_drop_rounded,
    _ => null,
  };
  if (byCode != null) return byCode;
  return switch (iconName) {
    'phone_iphone' => Icons.phone_iphone_rounded,
    'wifi' => Icons.wifi_rounded,
    'bolt' => Icons.bolt_rounded,
    'health_and_safety' => Icons.health_and_safety_rounded,
    'water_drop' => Icons.water_drop_rounded,
    'account_balance_wallet' => Icons.account_balance_wallet_rounded,
    _ => Icons.payments_rounded,
  };
}

/// Ilustrasi SVG bermerek TapGo untuk kategori PPOB yang sudah punya asetnya
/// di `assets/illustrations/services/` — set aset yang sama dipakai grid
/// layanan utama dashboard, supaya kategori ini terasa satu bahasa visual
/// dengan ikon utama alih-alih ikon Material generik.
///
/// Sengaja hanya memetakan kode yang asetnya benar-benar cocok secara makna
/// (Pulsa, BPJS). Kategori lain (Paket Data, Token PLN, E-Wallet, PDAM) belum
/// punya ilustrasi bermerek — memaksakan aset yang maknanya tidak pas lebih
/// buruk daripada ikon Material yang jujur, jadi kategori itu tetap memakai
/// [ppobCategoryIcon] sampai asetnya tersedia.
String? ppobCategoryIllustrationAsset(String categoryCode) {
  const basePath = 'assets/illustrations/services';
  return switch (categoryCode) {
    'PULSA' => '$basePath/tg-pulsa.svg',
    'BPJS' => '$basePath/tg-bpjs.svg',
    _ => null,
  };
}

/// Warna khas per kategori PPOB, mengikuti bahasa visual dashboard
/// (ikon tematik + aksen warna berbeda per layanan).
Color ppobCategoryColor(String categoryCode) {
  return switch (categoryCode) {
    'PULSA' => const Color(0xFF1486B8),
    'DATA' => const Color(0xFF0B7A75),
    'PLN_PREPAID' => const Color(0xFFF59E0B),
    'PLN_POSTPAID' => const Color(0xFFD97706),
    'BPJS' => const Color(0xFF16A34A),
    'EWALLET' => const Color(0xFF4F46E5),
    'PDAM' => const Color(0xFF0284C7),
    _ => const Color(0xFF1486B8),
  };
}

class PpobStatusChip extends StatelessWidget {
  const PpobStatusChip({super.key, required this.status});

  final PpobOrderStatus status;

  @override
  Widget build(BuildContext context) {
    final (color, icon) = switch (status) {
      PpobOrderStatus.success => (
          const Color(0xFF0B7A75),
          Icons.check_circle_rounded
        ),
      PpobOrderStatus.processing || PpobOrderStatus.pending => (
          const Color(0xFFD97706),
          Icons.schedule_rounded
        ),
      PpobOrderStatus.failed => (const Color(0xFFEF4444), Icons.error_rounded),
      PpobOrderStatus.refunded => (const Color(0xFF697386), Icons.undo_rounded),
      PpobOrderStatus.unknown => (const Color(0xFF697386), Icons.help_rounded),
    };
    final label = ppobStatusLabel(status);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

/// Tampilan error/empty konsisten: ikon, judul, pesan, aksi coba lagi opsional.
class PpobNoticeView extends StatelessWidget {
  const PpobNoticeView({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: theme.colorScheme.outline),
            const SizedBox(height: 14),
            Text(
              title,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 16),
              FilledButton.tonal(
                onPressed: onAction,
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Pesan kegagalan yang ramah pengguna dari kode operasional backend.
String ppobErrorMessage(Object error) {
  if (error is PpobApiException) {
    return switch (error.code) {
      'PPOB_PROVIDER_UNAVAILABLE' =>
        'Layanan PPOB belum tersedia. Mohon coba lagi nanti.',
      'PPOB_PRODUCT_NOT_FOUND' => 'Produk tidak ditemukan. Muat ulang katalog.',
      'PPOB_PRODUCT_INACTIVE' => 'Produk sedang tidak aktif.',
      'PPOB_TARGET_INVALID' => error.message,
      'INSUFFICIENT_BALANCE' =>
        'Saldo Anda tidak cukup. Silakan gunakan nominal lain.',
      'PPOB_IDEMPOTENCY_CONFLICT' =>
        'Permintaan duplikat terdeteksi. Periksa riwayat transaksi Anda.',
      // Hanya kode domain PPOB_* dan pesan jaringan bawaan adaptor yang
      // dijamin berbahasa Indonesia; pesan umum server (mis. "Request
      // validation failed") tidak boleh sampai ke pengguna.
      _
          when (error.code.startsWith('PPOB_') ||
                  error.code == 'NETWORK_ERROR') &&
              error.message.isNotEmpty =>
        error.message,
      _ when error.statusCode == 429 =>
        'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.',
      _ when (error.statusCode ?? 0) >= 500 =>
        'Server TapGo sedang bermasalah. Silakan coba beberapa saat lagi.',
      _ => 'Terjadi kesalahan. Silakan coba lagi.',
    };
  }
  return 'Koneksi bermasalah. Periksa jaringan Anda dan coba lagi.';
}
