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
const String kGoogleServerClientId = String.fromEnvironment(
  'TAPGO_GOOGLE_SERVER_CLIENT_ID',
  defaultValue:
      '637941236322-thr3677h1kqvpegan9lg7lr8pm7h9b7r.apps.googleusercontent.com',
);
