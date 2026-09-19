/// Deteksi operator seluler dari prefiks nomor untuk produk pulsa/data.
///
/// Tabel ini SENGAJA sama dengan backend (`operatorDetection.ts`); server tetap
/// sumber kebenaran dan memvalidasi ulang. Klien memakainya hanya agar
/// pengguna langsung melihat operator nomornya dan tidak mengirim permintaan
/// yang pasti ditolak. Nomor yang sudah pindah operator (MNP) tidak dapat
/// dikenali dari prefiks.
library;

const Map<String, List<String>> _operatorPrefixes = {
  'telkomsel': ['0811', '0812', '0813', '0821', '0822', '0823', '0851', '0852', '0853'],
  'indosat': ['0814', '0815', '0816', '0855', '0856', '0857', '0858'],
  'xl': ['0817', '0818', '0819', '0859', '0877', '0878'],
  'axis': ['0831', '0832', '0833', '0838'],
  'tri': ['0895', '0896', '0897', '0898', '0899'],
  'smartfren': [
    '0881', '0882', '0883', '0884', '0885', '0886', '0887', '0888', '0889'
  ],
};

const Map<String, String> ppobOperatorLabels = {
  'telkomsel': 'Telkomsel',
  'indosat': 'Indosat',
  'xl': 'XL',
  'axis': 'Axis',
  'tri': 'Tri',
  'smartfren': 'Smartfren',
};

final Map<String, String> _operatorByPrefix = {
  for (final entry in _operatorPrefixes.entries)
    for (final prefix in entry.value) prefix: entry.key,
};

/// Bentuk kanonik "08…" dari input pengguna ("+62…", "62…", spasi, strip).
String normalizePpobMsisdn(String raw) {
  final digits = raw.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('62')) {
    return '0${digits.substring(2)}';
  }
  return digits;
}

/// Kode operator (mis. `xl`) atau null bila prefiks belum dikenali / terlalu pendek.
String? detectPpobOperator(String raw) {
  final msisdn = normalizePpobMsisdn(raw);
  if (msisdn.length < 4) {
    return null;
  }
  return _operatorByPrefix[msisdn.substring(0, 4)];
}

String ppobOperatorLabel(String code) =>
    ppobOperatorLabels[code] ?? code;

/// Daftar label yang diurutkan, mis. "Axis, Telkomsel, Tri, XL".
String ppobOperatorList(Iterable<String> codes) =>
    (codes.map(ppobOperatorLabel).toList()..sort()).join(', ');
