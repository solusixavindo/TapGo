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
  static const _adminWithdrawalKey = 'tapgo.demo.admin.withdrawals.v1';
  static const _documentsKey = 'tapgo.demo.documents.v1';
  static const _registeredUsersKey = 'tapgo.auth.registered_users.v1';
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

  static const _storageWriteTimeout = Duration(milliseconds: 900);

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

  Future<bool> saveRegisteredUser(DemoClientSession session) async {
    if (tapGoDisablePersistenceForTests) {
      return true;
    }
    final users = await restoreRegisteredUsers();
    users.removeWhere((user) => user.phone == session.phone);
    users.insert(0, DemoAdminMember.fromSession(session));
    return _safeWrite(
      _registeredUsersKey,
      jsonEncode(users.map((user) => _adminMemberToJson(user)).toList()),
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
          directSponsor: membership.directSponsor,
          downline: membership.downline,
          activeLevel: membership.activeLevel,
          todayBonus: membership.todayBonus,
          selfieImagePath: membership.selfieImagePath,
          ktpImagePath: membership.ktpImagePath,
          lastInvoiceNumber: membership.lastInvoiceNumber,
          membershipJoinedAt: membership.membershipJoinedAt,
          transactions: membership.transactions,
        );
      } catch (_) {}
    }
    return baseSession;
  }

  Future<List<DemoAdminMember>> restoreRegisteredUsers() async {
    if (tapGoDisablePersistenceForTests) {
      return [];
    }
    final raw = await _safeRead(_registeredUsersKey);
    if (raw == null || raw.isEmpty) {
      return [];
    }
    try {
      return (jsonDecode(raw) as List)
          .whereType<Map>()
          .map((item) => _adminMemberFromJson(item.cast<String, dynamic>()))
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveDocument(String key, _PickedDemoDocument document) async {
    if (tapGoDisablePersistenceForTests) {
      return;
    }
    final documents = await restoreDocuments();
    documents[key] = {
      'path': document.path,
      'fileName': document.fileName,
      'statusLabel': document.statusLabel,
    };
    await _safeWrite(_documentsKey, jsonEncode(documents));
  }

  Future<Map<String, dynamic>> restoreDocuments() async {
    if (tapGoDisablePersistenceForTests) {
      return {};
    }
    final raw = await _safeRead(_documentsKey);
    if (raw == null || raw.isEmpty) {
      return {};
    }
    try {
      return jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return {};
    }
  }

  Future<Map<String, String>> restoreWithdrawalStatuses() async {
    if (tapGoDisablePersistenceForTests) {
      return {};
    }
    final raw = await _safeRead(_adminWithdrawalKey);
    if (raw == null || raw.isEmpty) {
      return {};
    }
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      return map.map((key, value) => MapEntry(key, value.toString()));
    } catch (_) {
      return {};
    }
  }

  Future<void> saveWithdrawalStatuses(Map<String, String> statuses) async {
    if (tapGoDisablePersistenceForTests) {
      return;
    }
    await _safeWrite(_adminWithdrawalKey, jsonEncode(statuses));
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
    } catch (_) {
      return null;
    }
  }

  Future<bool> _safeWrite(String key, String value) async {
    try {
      await _storage
          .write(key: key, value: value)
          .timeout(_storageWriteTimeout);
      return true;
    } catch (error) {
      _tapGoDebugLog('[TapGo Storage] write skipped for $key: $error');
      return false;
    }
  }

  Future<bool> _safeDelete(String key) async {
    try {
      await _storage.delete(key: key).timeout(_storageWriteTimeout);
      return true;
    } catch (error) {
      _tapGoDebugLog('[TapGo Storage] delete skipped for $key: $error');
      return false;
    }
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
    assert(_apiClient.baseUrl.isNotEmpty && _tapgoApiEndpoints.isNotEmpty);
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
      final storedAuth = await _persistentStore.restoreAuth().timeout(
            const Duration(seconds: 2),
            onTimeout: () => false,
          );
      final session = await _persistentStore.restoreSession().timeout(
            const Duration(seconds: 2),
            onTimeout: () => null,
          );
      final tokens = await _persistentStore.restoreTokens().timeout(
            const Duration(seconds: 2),
            onTimeout: () => (accessToken: null, refreshToken: null),
          );
      if (!mounted) {
        return;
      }
      auth = storedAuth;
      restoredSession = session;
      if (_isTapGoProductionBuild &&
          (tokens.accessToken == null || tokens.accessToken!.isEmpty)) {
        auth = false;
        restoredSession = null;
        await _persistentStore.clearSession().timeout(
              const Duration(seconds: 2),
              onTimeout: () {},
            );
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
              directSponsor: production.sessionPatch.directSponsor,
              downline: production.sessionPatch.downline,
              activeLevel: production.sessionPatch.activeLevel,
              todayBonus: production.sessionPatch.todayBonus,
              lastInvoiceNumber: production.sessionPatch.lastInvoiceNumber,
              membershipJoinedAt: production.sessionPatch.membershipJoinedAt,
              transactions: production.sessionPatch.transactions,
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
          await _persistentStore.clearSession().timeout(
                const Duration(seconds: 2),
                onTimeout: () {},
              );
          _apiClient.setAccessToken(null);
          auth = false;
          restoredSession = null;
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
    } finally {
      if (mounted) {
        setState(() => _loaded = true);
      }
    }
  }
}

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
    'selfieImagePath': session.selfieImagePath,
    'ktpImagePath': session.ktpImagePath,
    'lastInvoiceNumber': session.lastInvoiceNumber,
    'membershipJoinedAt': session.membershipJoinedAt,
    'isFounderChairman': session.isFounderChairman,
    'isFounderPlatinum': session.isFounderPlatinum,
    'userName': session.userName,
    'phone': session.phone,
    'activePackageName': session.activePackageName,
    'walletBalance': session.walletBalance,
    'ppobBalance': session.ppobBalance,
    'referralCode': session.referralCode,
    'directSponsor': session.directSponsor,
    'downline': session.downline,
    'activeLevel': session.activeLevel,
    'todayBonus': session.todayBonus,
    'transactions': session.transactions
        .map(
          (transaction) => {
            'title': transaction.title,
            'description': transaction.description,
            'amount': transaction.amount,
            'status': transaction.status,
          },
        )
        .toList(),
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
    selfieImagePath: json['selfieImagePath']?.toString(),
    ktpImagePath: json['ktpImagePath']?.toString(),
    lastInvoiceNumber: json['lastInvoiceNumber']?.toString(),
    membershipJoinedAt: json['membershipJoinedAt']?.toString(),
    isFounderChairman: json['isFounderChairman'] == true,
    isFounderPlatinum: json['isFounderPlatinum'] == true,
    userName: json['userName']?.toString() ?? 'Member TapGo',
    phone: json['phone']?.toString() ?? '',
    activePackageName: json['activePackageName']?.toString() ?? 'Basic',
    walletBalance: (json['walletBalance'] as num?)?.toInt() ?? 0,
    ppobBalance: (json['ppobBalance'] as num?)?.toInt() ?? 0,
    referralCode: json['referralCode']?.toString() ?? '-',
    directSponsor: (json['directSponsor'] as num?)?.toInt() ?? 0,
    downline: (json['downline'] as num?)?.toInt() ?? 0,
    activeLevel: (json['activeLevel'] as num?)?.toInt() ?? 0,
    todayBonus: (json['todayBonus'] as num?)?.toInt() ?? 0,
    transactions: ((json['transactions'] as List?) ?? const [])
        .whereType<Map>()
        .map(
          (item) => WalletTransactionModel(
            title: item['title']?.toString() ?? 'Transaksi',
            description: item['description']?.toString() ?? 'Ledger TapGo',
            amount: (item['amount'] as num?)?.toInt() ?? 0,
            status: item['status']?.toString() ?? 'Sukses',
          ),
        )
        .toList(),
  );
}

Map<String, dynamic> _adminMemberToJson(DemoAdminMember member) {
  return {
    'id': member.id,
    'name': member.name,
    'phone': member.phone,
    'packageName': member.packageName,
    'paymentStatus': member.paymentStatus,
    'sponsor': member.sponsor,
    'totalDownline': member.totalDownline,
    'walletBalance': member.walletBalance,
    'totalCommission': member.totalCommission,
    'joinedAt': member.joinedAt,
    'selfieImagePath': member.selfieImagePath,
    'ktpImagePath': member.ktpImagePath,
  };
}

DemoAdminMember _adminMemberFromJson(Map<String, dynamic> json) {
  return DemoAdminMember(
    id: json['id']?.toString() ??
        'LOCAL-${DateTime.now().millisecondsSinceEpoch}',
    name: json['name']?.toString() ?? 'Member TapGo',
    phone: json['phone']?.toString() ?? '-',
    packageName: json['packageName']?.toString() ?? 'Basic',
    paymentStatus: json['paymentStatus']?.toString() ?? 'Registered',
    sponsor: json['sponsor']?.toString() ?? '-',
    totalDownline: (json['totalDownline'] as num?)?.toInt() ?? 0,
    walletBalance: (json['walletBalance'] as num?)?.toInt() ?? 0,
    totalCommission: (json['totalCommission'] as num?)?.toInt() ?? 0,
    joinedAt: json['joinedAt']?.toString() ?? 'Hari ini',
    selfieImagePath: json['selfieImagePath']?.toString(),
    ktpImagePath: json['ktpImagePath']?.toString(),
  );
}
