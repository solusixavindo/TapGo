import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/main.dart';

const _outputPath = '../../docs/release-2/visual-review/r2.5-driver-app';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const visualSkip = !kDriverDemoMode;

  setUpAll(() {
    Directory(_outputPath).createSync(recursive: true);
  });

  for (final capture in _captures) {
    testWidgets('visual evidence ${capture.name}', (tester) async {
      await _captureScenario(tester, capture);
    }, skip: visualSkip);
  }

  testWidgets('visual evidence contact sheet', (tester) async {
    await tester.runAsync(
      () => _makeContactSheet(
        _captures,
        '$_outputPath/R2_5_DRIVER_APP_CONTACT_SHEET.png',
      ),
    );
  }, skip: visualSkip);
}

const _captures = <_Capture>[
  _Capture('00_login_360x800.png', DriverScenario.login, Size(360, 800)),
  _Capture('01_capability_inactive_360x800.png', DriverScenario.profileRequired,
      Size(360, 800)),
  _Capture('02_home_offline_360x800.png', DriverScenario.homeOffline,
      Size(360, 800)),
  _Capture(
      '03_home_online_360x800.png', DriverScenario.homeOnline, Size(360, 800)),
  _Capture(
      '04_offer_empty_360x800.png', DriverScenario.offerEmpty, Size(360, 800)),
  _Capture('05_offer_available_360x800.png', DriverScenario.offerAvailable,
      Size(360, 800)),
  _Capture('06_offer_detail_top_390x844.png', DriverScenario.offerAvailable,
      Size(390, 844),
      openOffer: true),
  _Capture('06b_offer_detail_scrolled_390x844.png',
      DriverScenario.offerAvailable, Size(390, 844),
      openOffer: true, scroll: true),
  _Capture('07_to_pickup_390x844.png', DriverScenario.toPickup, Size(390, 844)),
  _Capture('08_arrived_390x844.png', DriverScenario.arrived, Size(390, 844)),
  _Capture('09_in_trip_390x844.png', DriverScenario.inTrip, Size(390, 844)),
  _Capture(
      '10_completed_390x844.png', DriverScenario.completed, Size(390, 844)),
  _Capture(
      '11_cancelled_390x844.png', DriverScenario.cancelled, Size(390, 844)),
  _Capture('12_network_error_360x800.png', DriverScenario.networkError,
      Size(360, 800)),
  _Capture('13_session_expired_360x800.png', DriverScenario.sessionExpired,
      Size(360, 800)),
  _Capture(
      '14_dark_theme_390x844.png', DriverScenario.homeOnline, Size(390, 844),
      theme: ThemeMode.dark),
  _Capture('15_width_320x640.png', DriverScenario.inTrip, Size(320, 640)),
  _Capture(
      '16_large_text_top_390x844.png', DriverScenario.inTrip, Size(390, 844),
      textScale: 1.8),
  _Capture('16b_large_text_scrolled_390x844.png', DriverScenario.inTrip,
      Size(390, 844),
      textScale: 1.8, scroll: true),
];

class _Capture {
  const _Capture(
    this.name,
    this.scenario,
    this.size, {
    this.theme = ThemeMode.light,
    this.openOffer = false,
    this.scroll = false,
    this.textScale = 1.0,
  });

  final String name;
  final DriverScenario scenario;
  final Size size;
  final ThemeMode theme;
  final bool openOffer;
  final bool scroll;
  final double textScale;
}

Future<void> _captureScenario(WidgetTester tester, _Capture capture) async {
  await tester.binding.setSurfaceSize(capture.size);
  final key = GlobalKey();
  await tester.pumpWidget(
    RepaintBoundary(
      key: key,
      child: MediaQuery(
        data: MediaQueryData(
          size: capture.size,
          textScaler: TextScaler.linear(capture.textScale),
        ),
        child: buildTestableDriverApp(
          repository: DemoDriverRepository(initialScenario: capture.scenario),
          scenario: capture.scenario,
          themeMode: capture.theme,
        ),
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 350));
  if (capture.openOffer) {
    final offer = find.byKey(const ValueKey('offer-RIDE-DEMO-001'));
    await Scrollable.ensureVisible(
      tester.element(offer),
      alignment: 0.3,
      duration: Duration.zero,
    );
    await tester.pump(const Duration(milliseconds: 120));
    await tester.tap(offer);
    await tester.pump(const Duration(milliseconds: 350));
  }
  if (capture.scroll) {
    await tester.drag(find.byType(Scrollable).last, const Offset(0, -360));
    await tester.pump(const Duration(milliseconds: 350));
  }
  expect(tester.takeException(), isNull);
  final boundary =
      key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  final image = await boundary.toImage(pixelRatio: 1);
  await tester.runAsync(() async {
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    File('$_outputPath/${capture.name}')
        .writeAsBytesSync(bytes!.buffer.asUint8List());
  });
  image.dispose();
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pump(const Duration(milliseconds: 100));
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump(const Duration(milliseconds: 100));
}

Future<void> _makeContactSheet(
  List<_Capture> captures,
  String outputPath,
) async {
  const cellWidth = 260.0;
  const labelHeight = 48.0;
  const gap = 18.0;
  const columns = 3;
  final rows = (captures.length / columns).ceil();
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  final width = columns * cellWidth + (columns + 1) * gap;
  final height = rows * (cellWidth * 1.8 + labelHeight + gap) + gap;
  canvas.drawColor(const Color(0xFFF3F7FB), BlendMode.src);

  for (var index = 0; index < captures.length; index += 1) {
    final capture = captures[index];
    final row = index ~/ columns;
    final col = index % columns;
    final x = gap + col * (cellWidth + gap);
    final y = gap + row * (cellWidth * 1.8 + labelHeight + gap);
    final bytes = File('$_outputPath/${capture.name}').readAsBytesSync();
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    final image = frame.image;
    final targetHeight = cellWidth * capture.size.height / capture.size.width;
    final target = Rect.fromLTWH(x, y + labelHeight, cellWidth, targetHeight);
    canvas.drawRRect(
      RRect.fromRectAndRadius(target.inflate(3), const Radius.circular(18)),
      Paint()..color = const Color(0x22000000),
    );
    canvas.drawImageRect(
      image,
      Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
      target,
      Paint(),
    );
    image.dispose();
    final paragraphBuilder = ui.ParagraphBuilder(
      ui.ParagraphStyle(fontSize: 13, maxLines: 2, textAlign: TextAlign.left),
    )
      ..pushStyle(
        ui.TextStyle(
          color: const Color(0xFF061A2F),
          fontWeight: FontWeight.w700,
        ),
      )
      ..addText(
        '${capture.name}\n'
        '${capture.size.width.toInt()}x${capture.size.height.toInt()} '
        '${capture.scroll ? 'SCROLLED' : 'TOP'}',
      );
    final paragraph = paragraphBuilder.build()
      ..layout(const ui.ParagraphConstraints(width: cellWidth));
    canvas.drawParagraph(paragraph, Offset(x, y));
  }

  final picture = recorder.endRecording();
  final image = await picture.toImage(width.ceil(), height.ceil());
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  File(outputPath).writeAsBytesSync(data!.buffer.asUint8List());
}
