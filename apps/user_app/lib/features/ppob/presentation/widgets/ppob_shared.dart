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

IconData ppobCategoryIcon(String? iconName) {
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

class PpobStatusChip extends StatelessWidget {
  const PpobStatusChip({super.key, required this.status});

  final PpobOrderStatus status;

  @override
  Widget build(BuildContext context) {
    final (color, icon) = switch (status) {
      PpobOrderStatus.success => (const Color(0xFF0B7A75), Icons.check_circle_rounded),
      PpobOrderStatus.processing ||
      PpobOrderStatus.pending =>
        (const Color(0xFFD97706), Icons.schedule_rounded),
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
      _ => error.message.isNotEmpty
          ? error.message
          : 'Terjadi kesalahan. Silakan coba lagi.',
    };
  }
  return 'Koneksi bermasalah. Periksa jaringan Anda dan coba lagi.';
}
