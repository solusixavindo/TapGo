part of '../main.dart';

/// Tempat tersimpan (Rumah, Kantor) untuk memesan ojek dua ketukan. Disimpan
/// hanya di perangkat, di penyimpanan aman yang sama dengan sesi, dan dihapus
/// saat keluar akun atau pembersihan sesi.
class RideSavedPlace {
  const RideSavedPlace({
    required this.slot,
    required this.label,
    required this.address,
    required this.lat,
    required this.lng,
  });

  /// 'home' atau 'work'. Satu tempat per slot.
  final String slot;
  final String label;
  final String address;
  final double lat;
  final double lng;

  RideLocation toLocation() => RideLocation(
        id: 'saved-$slot',
        label: label,
        address: address,
        lat: lat,
        lng: lng,
      );

  Map<String, dynamic> toJson() => {
        'slot': slot,
        'label': label,
        'address': address,
        'lat': lat,
        'lng': lng,
      };

  static RideSavedPlace? tryFromJson(Object? json) {
    if (json is! Map) {
      return null;
    }
    final slot = json['slot'];
    final address = json['address'];
    final lat = json['lat'];
    final lng = json['lng'];
    if ((slot != 'home' && slot != 'work') ||
        address is! String ||
        address.trim().length < 3 ||
        lat is! num ||
        lng is! num ||
        lat.abs() > 90 ||
        lng.abs() > 180) {
      return null;
    }
    return RideSavedPlace(
      slot: slot as String,
      label: slot == 'home' ? 'Rumah' : 'Kantor',
      address: address,
      lat: lat.toDouble(),
      lng: lng.toDouble(),
    );
  }
}

class _TapGoSavedPlacesStore {
  _TapGoSavedPlacesStore()
      : _storage = const FlutterSecureStorage(
          aOptions: AndroidOptions(encryptedSharedPreferences: true),
        );

  static const _key = 'tapgo.ride.saved_places.v1';
  final FlutterSecureStorage _storage;

  /// Saat uji (penyimpanan dimatikan) tempat disimpan di memori proses.
  static List<RideSavedPlace> _memory = [];

  Future<List<RideSavedPlace>> load() async {
    if (tapGoDisablePersistenceForTests) {
      return List.of(_memory);
    }
    try {
      final raw = await _storage.read(key: _key);
      if (raw == null || raw.isEmpty) {
        return [];
      }
      final decoded = jsonDecode(raw);
      if (decoded is! List) {
        return [];
      }
      final places = <String, RideSavedPlace>{};
      for (final item in decoded) {
        final place = RideSavedPlace.tryFromJson(item);
        if (place != null) {
          places[place.slot] = place;
        }
      }
      return places.values.toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> upsert(RideSavedPlace place) async {
    final current = await load();
    final next = [
      for (final item in current)
        if (item.slot != place.slot) item,
      place,
    ];
    if (tapGoDisablePersistenceForTests) {
      _memory = next;
      return;
    }
    try {
      await _storage.write(
        key: _key,
        value: jsonEncode(next.map((p) => p.toJson()).toList()),
      );
    } catch (_) {}
  }

  Future<void> remove(String slot) async {
    final next = (await load()).where((p) => p.slot != slot).toList();
    if (tapGoDisablePersistenceForTests) {
      _memory = next;
      return;
    }
    try {
      if (next.isEmpty) {
        await _storage.delete(key: _key);
      } else {
        await _storage.write(
          key: _key,
          value: jsonEncode(next.map((p) => p.toJson()).toList()),
        );
      }
    } catch (_) {}
  }

  Future<void> clear() async {
    _memory = [];
    if (tapGoDisablePersistenceForTests) {
      return;
    }
    try {
      await _storage.delete(key: _key);
    } catch (_) {}
  }
}

final _savedPlacesStore = _TapGoSavedPlacesStore();

@visibleForTesting
Future<void> tapGoResetSavedPlacesForTests() => _savedPlacesStore.clear();

final _savedPlacesProvider =
    FutureProvider.autoDispose<List<RideSavedPlace>>((ref) {
  return _savedPlacesStore.load();
});

/// Tujuan terakhir (maksimal 3, unik menurut alamat) dari riwayat perjalanan
/// yang selesai. Gagal memuat = daftar kosong; ini hanya pelengkap.
final _recentPlacesProvider =
    FutureProvider.autoDispose<List<RideLocation>>((ref) async {
  final session = ref.read(_demoSessionProvider);
  if (tapGoDisablePersistenceForTests ||
      session.accessToken == null ||
      session.accessToken!.isEmpty) {
    return const [];
  }
  try {
    _apiClient.setAccessToken(session.accessToken);
    final rows = await _apiClient.rideHistory(limit: 20);
    return tapGoRecentPlacesFrom(rows.map(RideOrderView.fromJson).toList());
  } catch (_) {
    return const [];
  }
});

List<RideLocation> tapGoRecentPlacesFrom(List<RideOrderView> orders) {
  final seen = <String>{};
  final places = <RideLocation>[];
  for (final order in orders) {
    if (order.phase != RideUiPhase.completed ||
        order.dropoffLat == null ||
        order.dropoffLng == null ||
        order.dropoffAddress.trim().length < 3) {
      continue;
    }
    if (!seen.add(order.dropoffAddress.trim().toLowerCase())) {
      continue;
    }
    final short = order.dropoffAddress.split(',').first.trim();
    places.add(
      RideLocation(
        id: 'recent-${places.length}',
        label: short.isEmpty ? order.dropoffAddress : short,
        address: order.dropoffAddress,
        lat: order.dropoffLat!,
        lng: order.dropoffLng!,
      ),
    );
    if (places.length == 3) {
      break;
    }
  }
  return places;
}

/// Pintu uji untuk membaca isi penyimpanan tempat.
@visibleForTesting
class TapGoSavedPlacesProbe {
  static Future<List<RideSavedPlace>> load() => _savedPlacesStore.load();
}
