part of '../main.dart';

class TapGoDriverApp extends ConsumerWidget {
  const TapGoDriverApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(testThemeModeProvider);
    return MaterialApp(
      title: 'TapGo Driver',
      debugShowCheckedModeBanner: false,
      themeMode: themeMode ?? ThemeMode.system,
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      home: const DriverShell(),
    );
  }
}

ThemeData _theme(Brightness brightness) {
  const navy = Color(0xFF061A2F);
  const blue = Color(0xFF0877E8);
  const gold = Color(0xFFFFC857);
  final isDark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: blue,
    brightness: brightness,
    primary: blue,
    secondary: gold,
    surface: isDark ? const Color(0xFF091A2B) : Colors.white,
  );
  return ThemeData(
    useMaterial3: true,
    fontFamily: 'Roboto',
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor:
        isDark ? const Color(0xFF06101E) : const Color(0xFFF3F7FB),
    appBarTheme: AppBarTheme(
      elevation: 0,
      centerTitle: false,
      backgroundColor: isDark ? const Color(0xFF071525) : navy,
      foregroundColor: Colors.white,
    ),
    textTheme: const TextTheme(
      headlineSmall: TextStyle(fontWeight: FontWeight.w800),
      titleLarge: TextStyle(fontWeight: FontWeight.w800),
      titleMedium: TextStyle(fontWeight: FontWeight.w800),
      bodyMedium: TextStyle(height: 1.35),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      color: isDark ? const Color(0xFF0D2136) : Colors.white,
    ),
  );
}
