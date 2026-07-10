import 'package:flutter_test/flutter_test.dart';

import 'package:tapgo_driver_app/main.dart';

void main() {
  testWidgets('renders TapGo driver app shell', (WidgetTester tester) async {
    await tester.pumpWidget(const TapGoDriverApp());

    expect(find.text('TapGo Driver App'), findsOneWidget);
  });
}
