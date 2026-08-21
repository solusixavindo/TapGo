import 'package:flutter/material.dart';

import '../domain/ppob_models.dart';
import 'ppob_checkout_screen.dart';
import 'widgets/ppob_shared.dart';

/// Daftar produk dalam satu kategori (mis. nominal Pulsa Rp10.000–Rp100.000).
class PpobCategoryScreen extends StatelessWidget {
  const PpobCategoryScreen({super.key, required this.category});

  final PpobCategory category;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(category.name)),
      body: category.products.isEmpty
          ? const PpobNoticeView(
              icon: Icons.inventory_2_outlined,
              title: 'Belum ada produk',
              message: 'Produk untuk kategori ini belum tersedia.',
            )
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: category.products.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final product = category.products[index];
                return _PpobProductTile(
                  category: category,
                  product: product,
                );
              },
            ),
    );
  }
}

class _PpobProductTile extends StatelessWidget {
  const _PpobProductTile({required this.category, required this.product});

  final PpobCategory category;
  final PpobProduct product;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Material(
      color: theme.cardColor,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => PpobCheckoutScreen(
              categoryCode: category.code,
              product: product,
            ),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: theme.colorScheme.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  ppobCategoryIcon(category.icon),
                  color: theme.colorScheme.primary,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      style: theme.textTheme.bodyLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (product.description != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        product.description!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Text(
                ppobFormatRupiah(product.totalPrice),
                style: theme.textTheme.bodyLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: theme.colorScheme.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
