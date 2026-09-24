part of '../main.dart';

class _TapGoPersistentStore {
  _TapGoPersistentStore()
      : _storage = const FlutterSecureStorage(
          aOptions: AndroidOptions(encryptedSharedPreferences: true),
        );

  static const _sessionKey = 'tapgo.demo.session.v1';
  static const _authKey = 'tapgo.demo.authenticated.v1';
  static const _accessTokenKey = 'tapgo.auth.access_token.v1';
  static const _refreshTokenKey = 'tapgo.auth.refresh_token.v1';
  static const _legacyDocumentsKey = 'tapgo.demo.documents.v1';
  static const _legacyRegisteredUsersKey = 'tapgo.auth.registered_users.v1';
  static const _membershipPrefix = 'tapgo.membership.snapshot.v1.';

  final FlutterSecureStorage _storage;

  Future<bool> restoreAuth() async {
    if (tapGoDisablePersistenceForTests) {
      return false;
    }
    try {
      return await _storage.read(key: _authKey) == 'true';
    } catch (_) {
      return false;
    }
  }

  // 900ms sebelumnya terlalu ketat: penulisan pertama ke
  // FlutterSecureStorage/EncryptedSharedPreferences di Android memicu
  // inisialisasi kunci Keystore, yang pada perangkat fisik nyata (bukan
  // emulator) sering memakan waktu lebih dari 900ms. Saat itu terjadi,
  // _safeWrite diam-diam melaporkan gagal, login tetap terlihat berhasil di
  // UI (aktivasi sesi tidak menunggu hasil persist), tapi token tidak pernah
  // benar-benar tersimpan — sehingga sesi hilang begitu aplikasi ditutup dan
  // dibuka lagi, padahal pengguna tidak pernah logout.
  static const _storageWriteTimeout = Duration(seconds: 3);

  Future<bool> saveAuth(bool value) async {
    if (tapGoDisablePersistenceForTests) {
      return true;
    }
    return _safeWrite(_authKey, value ? 'true' : 'false');
  }

  Future<DemoClientSession?> restoreSession() async {
    if (tapGoDisablePersistenceForTests) {
      return null;
    }
    final raw = await _safeRead(_sessionKey);
    if (raw == null || raw.isEmpty) {
      return null;
    }
    try {
      return _sessionFromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  Future<bool> saveSession(DemoClientSession session) async {
    if (tapGoDisablePersistenceForTests) {
      return true;
    }
    return _safeWrite(_sessionKey, jsonEncode(_sessionToJson(session)));
  }

  Future<bool> saveTokens({
    required String? accessToken,
    required String? refreshToken,
  }) async {
    if (tapGoDisablePersistenceForTests) {
      return true;
    }
    var success = true;
    if (accessToken == null || accessToken.isEmpty) {
      success = await _safeDelete(_accessTokenKey) && success;
    } else {
      success = await _safeWrite(_accessTokenKey, accessToken) && success;
    }
    if (refreshToken == null || refreshToken.isEmpty) {
      success = await _safeDelete(_refreshTokenKey) && success;
    } else {
      success = await _safeWrite(_refreshTokenKey, refreshToken) && success;
    }
    return success;
  }

  Future<({String? accessToken, String? refreshToken})> restoreTokens() async {
    if (tapGoDisablePersistenceForTests) {
      return (accessToken: null, refreshToken: null);
    }
    return (
      accessToken: await _safeRead(_accessTokenKey),
      refreshToken: await _safeRead(_refreshTokenKey),
    );
  }

  Future<bool> saveMembershipSnapshot(DemoClientSession session) async {
    if (tapGoDisablePersistenceForTests) {
      return true;
    }
    if (!_hasPaidMembership(session)) {
      return true;
    }
    final encoded = jsonEncode(_sessionToJson(session));
    var success = true;
    for (final key in _membershipKeysFor(session)) {
      success = await _safeWrite(key, encoded) && success;
    }
    return success;
  }

  Future<DemoClientSession> restoreMembershipSnapshot(
    DemoClientSession baseSession,
  ) async {
    if (tapGoDisablePersistenceForTests) {
      return baseSession;
    }
    for (final key in _membershipKeysFor(baseSession)) {
      final raw = await _safeRead(key);
      if (raw == null || raw.isEmpty) {
        continue;
      }
      try {
        final membership = _sessionFromJson(
          jsonDecode(raw) as Map<String, dynamic>,
        );
        if (!_hasPaidMembership(membership)) {
          continue;
        }
        return baseSession.copyWith(
          activePackageName: membership.activePackageName,
          walletBalance: membership.walletBalance,
          ppobBalance: membership.ppobBalance,
          lastInvoiceNumber: membership.lastInvoiceNumber,
          membershipJoinedAt: membership.membershipJoinedAt,
        );
      } catch (_) {}
    }
    return baseSession;
  }

  /// Daftar pendaftar lokal (termasuk lokasi foto KTP/selfie) sudah dihapus
  /// dari aplikasi: pendaftaran hanya lewat aplikasi resmi Play Store dan
  /// peningkatan member lewat web. Data yang tertinggal di HP dari versi lama
  /// dibersihkan sekali saat aplikasi dibuka.
  Future<void> purgeLegacyRegisteredUsers() async {
    if (tapGoDisablePersistenceForTests) {
      return;
    }
    // Lokasi foto KTP/selfie dari pendaftaran lama di HP juga dihapus.
    await _safeDelete(_legacyRegisteredUsersKey);
    await _safeDelete(_legacyDocumentsKey);
  }

  Future<void> clearSession() async {
    if (tapGoDisablePersistenceForTests) {
      return;
    }
    try {
      await _storage.delete(key: _authKey);
      await _storage.delete(key: _sessionKey);
      await _storage.delete(key: _accessTokenKey);
      await _storage.delete(key: _refreshTokenKey);
    } catch (_) {}
    // Tempat tersimpan milik pengguna yang keluar tidak boleh terbaca akun lain.
    await _savedPlacesStore.clear();
  }

  Future<void> clearProductionRuntimeCache() async {
    if (tapGoDisablePersistenceForTests) {
      return;
    }
    try {
      await _storage.deleteAll();
    } catch (_) {
      await clearSession();
    }
  }

  Future<String?> _safeRead(String key) async {
    try {
      return await _storage.read(key: key);
    } catch (error) {
      // Kunci yang memang belum pernah ditulis mengembalikan null TANPA
      // melempar exception — cabang ini hanya kena saat baca sungguhan
      // gagal (mis. Android Keystore ter-invalidasi). Dicatat supaya
      // "belum pernah login" tidak tercampur diam-diam dengan "gagal baca
      // storage" saat menelusuri laporan sesi yang hilang.
      _tapGoDebugLog('[TapGo Storage] read failed for $key: $error');
      return null;
    }
  }

  // Baca sudah dapat retry (_restoreLocalStateWithRetry) dari laporan
  // "sesi hilang setelah force-stop" sebelumnya, tapi tulis masih satu kali
  // percobaan saja. Celah yang sama bisa terjadi di sisi tulis: penulisan
  // PERTAMA ke Keystore/EncryptedSharedPreferences memicu inisialisasi kunci
  // yang di sebagian perangkat nyata bisa melewati 3 detik, membuat login
  // terlihat berhasil di UI padahal token tidak pernah benar-benar tersimpan.
  // Dicoba dua kali sebelum benar-benar menyerah, sama seperti pola baca.
  Future<bool> _safeWrite(String key, String value) async {
    for (var attempt = 1; attempt <= 2; attempt++) {
      try {
        await _storage
            .write(key: key, value: value)
            .timeout(_storageWriteTimeout);
        return true;
      } catch (error) {
        _tapGoDebugLog(
          '[TapGo Storage] write attempt $attempt/2 failed for $key: $error',
        );
      }
    }
    return false;
  }

  Future<bool> _safeDelete(String key) async {
    for (var attempt = 1; attempt <= 2; attempt++) {
      try {
        await _storage.delete(key: key).timeout(_storageWriteTimeout);
        return true;
      } catch (error) {
        _tapGoDebugLog(
          '[TapGo Storage] delete attempt $attempt/2 failed for $key: $error',
        );
      }
    }
    return false;
  }

  bool _hasPaidMembership(DemoClientSession session) {
    return session.activePackageName != 'Basic' ||
        session.lastInvoiceNumber != null ||
        session.ppobBalance > 0;
  }

  List<String> _membershipKeysFor(DemoClientSession session) {
    final keys = <String>[];
    final userId = session.userId;
    if (userId != null && userId.isNotEmpty) {
      keys.add('$_membershipPrefix$userId');
    }
    final phoneDigits = session.phone.replaceAll(RegExp(r'[^0-9]'), '');
    if (phoneDigits.isNotEmpty) {
      keys.add('$_membershipPrefix${_normalizePhone(session.phone)}');
    }
    return keys.toSet().toList();
  }
}

/// Baca satu operasi storage lokal dengan jeda longgar + percobaan ulang.
///
/// Dipakai HANYA untuk baca sesi saat cold start (_SessionBootstrap._restore)
/// — bukan penggantian umum untuk timeout lain di aplikasi. Pada percobaan
/// pertama timeout, DICOBA LAGI sekali dengan jeda yang sama alih-alih
/// langsung menyerah ke [fallback]; [fallback] hanya dipakai setelah KEDUA
/// percobaan gagal, supaya isolate yang sedang sibuk saat cold start (bukan
/// storage yang benar-benar rusak/kosong) tidak disalahartikan sebagai
/// "belum pernah login".
Future<T> _restoreLocalStateWithRetry<T>(
  Future<T> Function() read,
  T fallback,
) async {
  const timeout = Duration(seconds: 6);
  for (var attempt = 1; attempt <= 2; attempt++) {
    try {
      return await read().timeout(timeout);
    } on TimeoutException {
      _tapGoDebugLog(
        '[TapGo Startup] local storage read timed out (attempt $attempt/2).',
      );
    }
  }
  return fallback;
}

class _SessionBootstrap extends ConsumerStatefulWidget {
  const _SessionBootstrap({required this.child});

  final Widget child;

  @override
  ConsumerState<_SessionBootstrap> createState() => _SessionBootstrapState();
}

class _SessionBootstrapState extends ConsumerState<_SessionBootstrap> {
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    assert(_apiClient.baseUrl.isNotEmpty);
    _restore();
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) {
      return const Scaffold(
        backgroundColor: _softBackground,
        body: Center(child: CircularProgressIndicator(color: _brandBlue)),
      );
    }
    return widget.child;
  }

  Future<void> _restore() async {
    var auth = false;
    DemoClientSession? restoredSession;
    try {
      // Baca storage lokal dengan percobaan ulang + jeda longgar, BUKAN
      // fallback diam-diam ke "kosong" pada timeout 2 detik yang lama.
      // Ditemukan lewat reproduksi nyata (login -> force-stop -> buka
      // ulang): pada cold start yang berat (plugin native lain — Geolocator,
      // Firebase, dsb. — ikut berebut inisialisasi di frame yang sama),
      // isolate Dart bisa belum sempat menuntaskan Future baca
      // EncryptedSharedPreferences dalam 2 detik BUKAN karena datanya
      // kosong, melainkan karena isolate sedang sibuk. onTimeout lama
      // (kembalikan kosong) membuat "baca terlambat" tidak bisa dibedakan
      // dari "memang belum pernah login", lalu cabang di bawah menghapus
      // sesi yang SEBENARNYA MASIH VALID (dibuktikan: file storage terenkripsi
      // masih utuh persis sebelum baca ini, lalu terhapus tepat sesudahnya).
      unawaited(_persistentStore.purgeLegacyRegisteredUsers());
      final storedAuth = await _restoreLocalStateWithRetry(
        _persistentStore.restoreAuth,
        false,
      );
      final session = await _restoreLocalStateWithRetry(
        _persistentStore.restoreSession,
        null,
      );
      var tokens = await _restoreLocalStateWithRetry(
        _persistentStore.restoreTokens,
        (accessToken: null, refreshToken: null),
      );
      if (!mounted) {
        return;
      }
      auth = storedAuth;
      restoredSession = session;
      if (_isTapGoProductionBuild &&
          (tokens.accessToken == null || tokens.accessToken!.isEmpty)) {
        // Access token hilang bukan otomatis berarti "belum pernah login" —
        // bisa juga gagal baca storage sesaat (timeout/Keystore) sementara
        // refresh token masih sah. Coba tukar dulu sebelum benar-benar
        // menghapus sesi, supaya kegagalan baca sesaat tidak memaksa login
        // ulang padahal sesi sebenarnya masih valid.
        var recoveredWithoutAccessToken = false;
        final refreshToken = tokens.refreshToken;
        if (refreshToken != null && refreshToken.isNotEmpty) {
          try {
            final (refreshResult, refreshed) =
                await _apiClient.refreshSession(refreshToken);
            if (refreshResult == TapGoSessionRefreshResult.refreshed &&
                refreshed != null) {
              await _persistentStore.saveTokens(
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
              );
              tokens = (
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
              );
              recoveredWithoutAccessToken = true;
              _tapGoDebugLog(
                '[TapGo Auth] session recovered via refresh (access token was missing).',
              );
            }
          } catch (refreshError) {
            _tapGoDebugLog(
              '[TapGo Auth] refresh without access token failed: $refreshError',
            );
          }
        }
        if (!recoveredWithoutAccessToken) {
          auth = false;
          restoredSession = null;
          await _persistentStore.clearSession().timeout(
                const Duration(seconds: 2),
                onTimeout: () {},
              );
        }
      }
      if (tokens.accessToken != null && tokens.accessToken!.isNotEmpty) {
        _apiClient.setAccessToken(tokens.accessToken);
        try {
          _tapGoDebugLog('[TapGo Auth] auth/me restore request');
          final user = await _apiClient.me();
          _tapGoDebugLog('[TapGo Auth] auth/me restore success.');
          restoredSession = _sessionFromAuthUser(
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            fallback: session,
          );
          if (!_isTapGoProductionBuild) {
            restoredSession = await _persistentStore
                .restoreMembershipSnapshot(restoredSession)
                .timeout(
                  const Duration(seconds: 2),
                  onTimeout: () => restoredSession!,
                );
          }
          try {
            final production = await _apiClient.productionSnapshot();
            restoredSession = restoredSession.copyWith(
              activePackageName: production.sessionPatch.activePackageName,
              walletBalance: production.sessionPatch.walletBalance,
              ppobBalance: production.sessionPatch.ppobBalance,
              lastInvoiceNumber: production.sessionPatch.lastInvoiceNumber,
              membershipJoinedAt: production.sessionPatch.membershipJoinedAt,
              isDemoMode: false,
            );
          } catch (error) {
            _tapGoDebugLog(
              '[TapGo Binding] restore production sync failed: $error',
            );
          }
          auth = true;
          await _persistentStore
              .saveSession(restoredSession!)
              .timeout(const Duration(seconds: 2), onTimeout: () => false);
        } catch (error) {
          _tapGoDebugLog('[TapGo Auth] auth/me restore failed: $error');
          // Kritis: jangan kosongkan sesi untuk gangguan sementara (koneksi
          // putus, timeout, server 5xx). Pengguna TIDAK boleh dipaksa login
          // ulang hanya karena HP sedang tidak ada internet — sesi hanya
          // dikosongkan bila server dengan tegas menolak (401/403).
          if (!_isAuthRejection(error)) {
            _tapGoDebugLog(
              '[TapGo Auth] restore deferred: transient failure, session kept.',
            );
            auth = true;
          } else {
            // Access token kedaluwarsa (~15 mnt) belum berarti sesi mati: bila
            // refresh token masih hidup, tukar jadi pasangan baru lalu coba lagi.
            // Hanya bila refresh ikut ditolak (dicabut / ganti password) sesi
            // dikosongkan dan user diminta login ulang.
            var recovered = false;
            var refreshUnreachable = false;
            final refreshToken = tokens.refreshToken;
            if (refreshToken != null && refreshToken.isNotEmpty) {
              try {
                final (refreshResult, refreshed) =
                    await _apiClient.refreshSession(refreshToken);
                if (refreshResult == TapGoSessionRefreshResult.refreshed &&
                    refreshed != null) {
                  _apiClient.setAccessToken(refreshed.accessToken);
                  final user = await _apiClient.me();
                  restoredSession = _sessionFromAuthUser(
                    user,
                    accessToken: refreshed.accessToken,
                    refreshToken: refreshed.refreshToken,
                    fallback: session,
                  );
                  await _persistentStore.saveTokens(
                    accessToken: refreshed.accessToken,
                    refreshToken: refreshed.refreshToken,
                  );
                  auth = true;
                  recovered = true;
                  _tapGoDebugLog('[TapGo Auth] session refreshed on restore.');
                } else if (refreshResult ==
                    TapGoSessionRefreshResult.unreachable) {
                  refreshUnreachable = true;
                }
              } catch (refreshError) {
                _tapGoDebugLog(
                    '[TapGo Auth] refresh-on-restore failed: $refreshError');
                if (!_isAuthRejection(refreshError)) {
                  refreshUnreachable = true;
                }
              }
            }
            if (!recovered && refreshUnreachable) {
              // Server menolak access token TAPI refresh tidak dapat diverifikasi
              // karena jaringan putus — pertahankan sesi, coba lagi saat app
              // dibuka berikutnya.
              auth = true;
            } else if (!recovered) {
              await _persistentStore.clearSession().timeout(
                    const Duration(seconds: 2),
                    onTimeout: () {},
                  );
              _apiClient.setAccessToken(null);
              auth = false;
              restoredSession = null;
            }
          }
        }
      }
      if (restoredSession != null && !_isTapGoProductionBuild) {
        restoredSession = await _persistentStore
            .restoreMembershipSnapshot(restoredSession)
            .timeout(
              const Duration(seconds: 2),
              onTimeout: () => restoredSession!,
            );
      }
      if (restoredSession != null) {
        ref.read(_demoSessionProvider.notifier).state = restoredSession;
      }
      ref.read(_isAuthenticatedProvider.notifier).state = auth;
    } catch (error) {
      _tapGoDebugLog('[TapGo Startup] session bootstrap failed open: $error');
      // Jangan paksa logout untuk kegagalan non-otentikasi (storage sibuk,
      // disk penuh, dsb.). Bila sesi tersimpan sempat terbaca, pertahankan.
      if (restoredSession != null) {
        if (mounted) {
          ref.read(_demoSessionProvider.notifier).state = restoredSession;
          ref.read(_isAuthenticatedProvider.notifier).state = true;
        }
      } else {
        _apiClient.setAccessToken(null);
        if (mounted) {
          ref.read(_isAuthenticatedProvider.notifier).state = false;
        }
        try {
          await _persistentStore.clearSession().timeout(
                const Duration(seconds: 2),
                onTimeout: () {},
              );
        } catch (_) {}
      }
    } finally {
      if (mounted) {
        setState(() => _loaded = true);
        // Pendaftaran SETELAH pemulihan awal: selama bootstrap, keputusan sesi
        // diambil oleh _restore() sendiri dan tidak boleh disalip.
        _apiClient.onSessionExpired = _handleSessionExpired;
      }
    }
  }

  @override
  void dispose() {
    if (identical(_apiClient.onSessionExpired, _handleSessionExpired)) {
      _apiClient.onSessionExpired = null;
    }
    super.dispose();
  }

  /// Server menegaskan sesi sudah tidak berlaku (dicabut / token tidak sah /
  /// refresh ditolak tegas). Keluarkan pengguna dengan rapi: bersihkan sesi
  /// lokal, tampilkan pesan, dan arahkan ke layar masuk. Sebelumnya aplikasi
  /// tetap tampak "sudah masuk" dan tiap layar menampilkan error mentah
  /// ("sesi Anda telah berakhir") sampai pengguna keluar manual.
  Future<void> _handleSessionExpired() async {
    if (!mounted || !_loaded) {
      return;
    }
    _tapGoDebugLog(
        '[TapGo Auth] session expired confirmed by server; signing out.');
    _apiClient.setAccessToken(null);
    try {
      await _persistentStore.clearSession().timeout(
            const Duration(seconds: 2),
            onTimeout: () {},
          );
    } catch (_) {}
    if (!mounted) {
      return;
    }
    ref.read(_demoSessionProvider.notifier).state = DemoClientSession.initial();
    ref.read(_isAuthenticatedProvider.notifier).state = false;
    _tapGoScaffoldMessengerKey.currentState
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          content: Text('Sesi Anda berakhir. Silakan masuk kembali.'),
        ),
      );
    _tapGoNavigatorKey.currentState?.pushAndRemoveUntil(
      _tapGoPageRoute((_) => const AuthScreen()),
      (_) => false,
    );
  }
}

/// True hanya bila server dengan tegas menolak kredensial (401/403).
/// Gangguan jaringan, timeout, dan 5xx mengembalikan false sehingga sesi
/// pengguna dipertahankan alih-alih dipaksa login ulang.
bool _isAuthRejection(Object error) {
  if (error is DioException) {
    final status = error.response?.statusCode;
    return status == 401 || status == 403;
  }
  return false;
}

@visibleForTesting
bool tapGoIsAuthRejectionForTests(Object error) => _isAuthRejection(error);

@visibleForTesting
Map<String, dynamic> tapGoSessionToJsonForTests(DemoClientSession session) =>
    _sessionToJson(session);

@visibleForTesting
DemoClientSession tapGoSessionFromJsonForTests(Map<String, dynamic> json) =>
    _sessionFromJson(json);

Map<String, dynamic> _sessionToJson(DemoClientSession session) {
  return {
    'userId': session.userId,
    'email': session.email,
    'role': session.role,
    'accessToken': session.accessToken,
    'refreshToken': session.refreshToken,
    'isDemoMode': session.isDemoMode,
    'lastInvoiceNumber': session.lastInvoiceNumber,
    'membershipJoinedAt': session.membershipJoinedAt,
    'userName': session.userName,
    'phone': session.phone,
    'activePackageName': session.activePackageName,
    'walletBalance': session.walletBalance,
    'ppobBalance': session.ppobBalance,
    'referralCode': session.referralCode,
  };
}

DemoClientSession _sessionFromJson(Map<String, dynamic> json) {
  return DemoClientSession(
    userId: json['userId']?.toString(),
    email: json['email']?.toString(),
    role: _normalizeUserRole(json['role']?.toString()),
    accessToken: json['accessToken']?.toString(),
    refreshToken: json['refreshToken']?.toString(),
    isDemoMode: json['isDemoMode'] as bool? ?? true,
    lastInvoiceNumber: json['lastInvoiceNumber']?.toString(),
    membershipJoinedAt: json['membershipJoinedAt']?.toString(),
    userName: json['userName']?.toString() ?? 'Member TapGo',
    phone: json['phone']?.toString() ?? '',
    activePackageName: json['activePackageName']?.toString() ?? 'Basic',
    walletBalance: (json['walletBalance'] as num?)?.toInt() ?? 0,
    ppobBalance: (json['ppobBalance'] as num?)?.toInt() ?? 0,
    referralCode: json['referralCode']?.toString() ?? '-',
  );
}
