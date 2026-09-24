import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// Server palsu untuk tes widget: menjawab menurut tabel "METHOD /path"
/// (path tanpa prefix /api/v1) dan mencatat setiap permintaan yang masuk.
/// Rute yang tidak terdaftar dijawab 404 agar panggilan tak terduga langsung
/// terlihat di tes, bukan diam-diam lolos.
class FakeApi implements HttpClientAdapter {
  FakeApi(this._routes);

  final Map<String, FakeReply Function(FakeCall call)> _routes;
  final List<FakeCall> calls = [];

  Iterable<FakeCall> callsTo(String key) =>
      calls.where((call) => call.key == key);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final path = options.uri.path.replaceFirst(RegExp(r'^/api/v1'), '');
    final call = FakeCall(
      method: options.method.toUpperCase(),
      path: path,
      body: options.data,
      query: options.uri.queryParameters,
      headers: options.headers,
    );
    calls.add(call);
    final handler = _routes[call.key];
    final reply = handler == null
        ? FakeReply(404, {'success': false, 'code': 'NOT_FOUND'})
        : handler(call);
    if (reply.networkError) {
      throw DioException(
        requestOptions: options,
        type: DioExceptionType.connectionError,
        error: 'jaringan putus (tes)',
      );
    }
    return ResponseBody.fromString(
      jsonEncode(reply.body),
      reply.status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class FakeCall {
  FakeCall({
    required this.method,
    required this.path,
    required this.body,
    required this.query,
    required this.headers,
  });

  final String method;
  final String path;
  final Object? body;
  final Map<String, dynamic> query;
  final Map<String, dynamic> headers;

  String get key => '$method $path';
  Map<String, dynamic> get json => (body as Map).cast<String, dynamic>();
}

class FakeReply {
  FakeReply(this.status, this.body) : networkError = false;
  FakeReply.ok(Object? data) : this(200, {'success': true, 'data': data});
  FakeReply.error(int status, String code, [String message = 'error'])
      : this(status, {'success': false, 'code': code, 'message': message});
  FakeReply.network()
      : status = 0,
        body = null,
        networkError = true;

  final int status;
  final Object? body;
  final bool networkError;
}
