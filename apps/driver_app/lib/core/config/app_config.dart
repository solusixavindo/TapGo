part of '../../main.dart';

const bool kDriverDemoMode = bool.fromEnvironment(
  'TAPGO_DRIVER_DEMO_MODE',
);
const String kApiBaseUrl = String.fromEnvironment(
  'TAPGO_API_BASE_URL',
  defaultValue: 'https://api.tapgolion.id/api/v1',
);

// Web OAuth client ID dari Google Cloud Console — WAJIB diisi supaya
// idToken hasil sign-in punya audience yang sama dengan GOOGLE_OAUTH_CLIENT_ID
// di backend. Tanpa ini, GoogleSignIn di Android akan menerbitkan idToken
// beraudience client Android, yang akan ditolak backend saat verifikasi.
//
// Client ID SEBELUMNYA (637941236322-...) adalah root cause Google Sign-In
// gagal total selama ini (Owner 29 Sep 2026): client itu milik project
// Google Cloud yang TIDAK BISA diakses sama sekali oleh akun Google TapGo —
// bukan salah SHA-1, bukan salah OAuth consent screen, project-nya sendiri
// tidak terjangkau. Diganti dengan Web OAuth client BARU yang dibuat di
// project Firebase TapGo sendiri (tapgo-c7cb3 / 796745727473), tempat SHA-1
// kunci unggah driver_app sudah benar terdaftar dan sepenuhnya dikuasai.
const String kGoogleServerClientId = String.fromEnvironment(
  'TAPGO_GOOGLE_SERVER_CLIENT_ID',
  defaultValue:
      '796745727473-5ja3jdm01j8pnqh95gq92ju8agqdlapb.apps.googleusercontent.com',
);

// Kosong = Sentry tidak aktif sama sekali (fail-closed) — sama pola dengan
// kDriverDemoMode dkk di atas. Diisi lewat --dart-define saat build, bukan
// ditulis langsung di kode (DSN client Sentry bukan rahasia mutlak, tapi
// tetap sebaiknya per-environment, bukan ditempel permanen).
const String kSentryDsn = String.fromEnvironment('SENTRY_DSN', defaultValue: '');
