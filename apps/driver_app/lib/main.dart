import 'dart:async';
import 'dart:math';

import 'package:camera/camera.dart';
import 'package:dio/dio.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart' as io_client;
import 'package:url_launcher/url_launcher.dart';

part 'core/config/app_config.dart';
part 'app/composition.dart';
part 'app/driver_app.dart';
part 'features/onboarding/presentation/splash_screen.dart';
part 'features/onboarding/presentation/onboarding_screen.dart';
part 'features/driver/domain/driver_models.dart';
part 'features/driver/domain/vehicle_catalog.dart';
part 'features/driver/data/driver_repository.dart';
part 'features/driver/data/session_store.dart';
part 'features/driver/data/token_refresh_coordinator.dart';
part 'features/driver/data/api_driver_repository.dart';
part 'features/driver/location/driver_location_port.dart';
part 'features/driver/push/driver_push.dart';
part 'demo/demo_driver_repository.dart';
part 'features/driver/application/driver_controller.dart';
part 'features/driver/presentation/driver_screens.dart';
part 'features/driver/presentation/driver_face_check_screen.dart';
part 'features/driver/application/face_check_pipeline.dart';
part 'features/driver/presentation/driver_ride_history.dart';
part 'features/driver/presentation/driver_earnings_screen.dart';
part 'features/driver/presentation/ride_chat_screen.dart';
part 'features/driver/presentation/driver_documents.dart';
part 'features/driver/presentation/driver_application.dart';
part 'features/driver/presentation/driver_application_wizard.dart';
part 'tapgo_app_guards.dart';

void _runTapGoDriverApp() {
  installTapGoCrashGuards();
  runApp(
    ProviderScope(
      overrides: [
        driverRepositoryProvider.overrideWithValue(
          kDriverDemoMode
              ? DemoDriverRepository()
              : ApiDriverRepository(
                  baseUrl: kApiBaseUrl,
                  storage: kIsWeb ? MemorySessionStore() : SecureSessionStore(),
                ),
        ),
        // locationPortProvider SENGAJA tidak di-override di sini: default-nya
        // di composition.dart sudah memilih GeolocatorDriverLocationPort di
        // luar mode demo. Meng-override-nya ke NoDriverLocationPort seperti
        // sebelumnya membuat GPS live tidak pernah aktif di build produksi
        // sama sekali — peta Beranda tampil tapi marker tidak pernah muncul,
        // dan backend tidak pernah menerima ping /driver/location.
      ],
      child: const TapGoDriverApp(),
    ),
  );
}

Future<void> main() async {
  if (kSentryDsn.isEmpty) {
    // Tanpa DSN, Sentry tidak aktif sama sekali — jangan panggil
    // SentryFlutter.init() dengan DSN kosong (SDK akan warning).
    _runTapGoDriverApp();
    return;
  }
  await SentryFlutter.init(
    (options) {
      options.dsn = kSentryDsn;
      options.environment = const String.fromEnvironment(
        'TAPGO_ENV',
        defaultValue: 'production',
      );
      // 10%: sama seperti tracesSampleRate backend — cukup untuk gambaran
      // performa tanpa membebani kuota Sentry.
      options.tracesSampleRate = 0.1;
      // Data pribadi pengguna (NIK, telepon, dsb.) tidak boleh terkirim ke
      // Sentry — konsisten dengan redaksi ketat logger backend.
      options.sendDefaultPii = false;
    },
    appRunner: _runTapGoDriverApp,
  );
}
