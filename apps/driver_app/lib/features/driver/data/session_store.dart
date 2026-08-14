part of '../../../main.dart';

abstract class SessionStore {
  Future<void> save(DriverSession session);
  Future<DriverSession?> read();
  Future<void> clear();
}

class MemorySessionStore implements SessionStore {
  DriverSession? _session;
  @override
  Future<void> save(DriverSession session) async => _session = session;
  @override
  Future<DriverSession?> read() async => _session;
  @override
  Future<void> clear() async => _session = null;
}

class SecureSessionStore implements SessionStore {
  final FlutterSecureStorage _storage = const FlutterSecureStorage();
  static const _access = 'tapgo.driver.access.v1';
  static const _refresh = 'tapgo.driver.refresh.v1';
  static const _name = 'tapgo.driver.name.v1';

  @override
  Future<void> save(DriverSession session) async {
    await _storage.write(key: _access, value: session.accessToken);
    await _storage.write(key: _refresh, value: session.refreshToken);
    await _storage.write(key: _name, value: session.driverName);
  }

  @override
  Future<DriverSession?> read() async {
    final access = await _storage.read(key: _access);
    final refresh = await _storage.read(key: _refresh);
    if (access == null || refresh == null) return null;
    return DriverSession(
      accessToken: access,
      refreshToken: refresh,
      driverName: await _storage.read(key: _name) ?? 'Driver TapGo',
    );
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
    await _storage.delete(key: _name);
  }
}
