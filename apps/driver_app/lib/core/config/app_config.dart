part of '../../main.dart';

const bool kDriverDemoMode = bool.fromEnvironment(
  'TAPGO_DRIVER_DEMO_MODE',
);
const String kApiBaseUrl = String.fromEnvironment(
  'TAPGO_API_BASE_URL',
  defaultValue: 'https://api.tapgolion.id/api/v1',
);
