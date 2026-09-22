part of '../../../main.dart';

/// Daftar singkat merk & model kendaraan populer di Indonesia, untuk dropdown
/// "Data Kendaraan" (wizard pengajuan halaman 3). Sengaja tidak lengkap —
/// mencakup merk paling umum saja, bukan katalog menyeluruh; driver dengan
/// kendaraan di luar daftar tetap bisa lanjut lewat opsi "Lainnya".
const String kVehicleCatalogOtherOption = 'Lainnya';

const Map<String, List<String>> kMotorcycleBrandModels = {
  'Honda': ['Beat', 'Vario', 'Scoopy', 'PCX', 'Supra X', 'Revo', 'CBR150R', 'CB150R'],
  'Yamaha': ['NMAX', 'Aerox', 'Mio', 'Fino', 'Lexi', 'Vixion', 'R15', 'XSR155'],
  'Suzuki': ['Nex', 'Address', 'Satria F150', 'GSX-R150', 'Skydrive'],
  'Kawasaki': ['Ninja', 'KLX', 'W175', 'Z250'],
  'Vespa': ['Primavera', 'Sprint', 'LX', 'GTS'],
  'TVS': ['Dazz', 'NTorq', 'Apache'],
  'Viar': ['Cross X', 'Star'],
  'Kymco': ['Like', 'Xciting'],
  'Benelli': ['Patagonian Eagle', 'TNT'],
  'Royal Enfield': ['Classic 350', 'Meteor 350'],
  kVehicleCatalogOtherOption: [],
};

const Map<String, List<String>> kCarBrandModels = {
  'Toyota': ['Avanza', 'Innova', 'Agya', 'Calya', 'Rush', 'Fortuner', 'Yaris'],
  'Daihatsu': ['Xenia', 'Ayla', 'Sigra', 'Terios', 'Gran Max'],
  'Honda': ['Brio', 'Mobilio', 'HR-V', 'BR-V', 'Jazz'],
  'Suzuki': ['Ertiga', 'Carry', 'XL7', 'Baleno'],
  'Mitsubishi': ['Xpander', 'Pajero Sport', 'L300'],
  'Nissan': ['Livina', 'Grand Livina', 'Serena'],
  'Wuling': ['Confero', 'Cortez', 'Almaz'],
  'Hyundai': ['Stargazer', 'Creta'],
  'Isuzu': ['Panther', 'Elf'],
  'Datsun': ['GO', 'GO+'],
  kVehicleCatalogOtherOption: [],
};

/// [serviceType] adalah nilai API ('MOTORCYCLE' atau 'CAR').
Map<String, List<String>> vehicleBrandModelsFor(String serviceType) {
  return serviceType == 'CAR' ? kCarBrandModels : kMotorcycleBrandModels;
}
