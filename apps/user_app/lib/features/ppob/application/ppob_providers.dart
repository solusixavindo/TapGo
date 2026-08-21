import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/ppob_repository.dart';
import '../domain/ppob_models.dart';

/// Di-override saat bootstrap (main.dart) dengan repository ber-wire HTTP
/// nyata, atau dengan repository demo/fake pada harness. Default melempar
/// supaya kelupaan override gagal keras dan jelas, bukan diam-diam no-op.
final ppobRepositoryProvider = Provider<PpobRepository>((ref) {
  throw UnimplementedError(
    'ppobRepositoryProvider harus di-override di bootstrap aplikasi',
  );
});

final ppobCatalogProvider = FutureProvider.autoDispose<List<PpobCategory>>((ref) {
  return ref.watch(ppobRepositoryProvider).fetchCatalog();
});

final ppobOrdersProvider = FutureProvider.autoDispose<List<PpobOrder>>((ref) {
  return ref.watch(ppobRepositoryProvider).fetchOrders();
});
