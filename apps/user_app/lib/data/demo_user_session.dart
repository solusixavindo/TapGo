part of '../main.dart';

final _isAuthenticatedProvider = StateProvider<bool>((ref) => false);
final _demoSessionProvider =
    StateProvider<DemoClientSession>((ref) => DemoClientSession.initial());
