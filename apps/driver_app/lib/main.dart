import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:image_picker/image_picker.dart';

part 'core/config/app_config.dart';
part 'app/composition.dart';
part 'app/driver_app.dart';
part 'features/driver/domain/driver_models.dart';
part 'features/driver/data/driver_repository.dart';
part 'features/driver/data/session_store.dart';
part 'features/driver/data/api_driver_repository.dart';
part 'features/driver/location/driver_location_port.dart';
part 'demo/demo_driver_repository.dart';
part 'features/driver/application/driver_controller.dart';
part 'features/driver/presentation/driver_screens.dart';
part 'features/driver/presentation/driver_documents.dart';

void main() {
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
        locationPortProvider.overrideWithValue(NoDriverLocationPort()),
      ],
      child: const TapGoDriverApp(),
    ),
  );
}
