part of '../main.dart';

/// Transfer saldo TapGoPay P2P antar user (Stage R2.10).
///
/// Berbeda dari Top Up: ini murni memindahkan saldo internal yang sudah ada
/// antar akun TapGo, bukan menerima pembayaran eksternal — jadi aman tetap
/// di dalam app untuk kedua distribusi (tidak menyentuh isu anti-steering
/// Play yang membuat Top Up harus pindah ke web).
class WalletTransferScreen extends ConsumerStatefulWidget {
  const WalletTransferScreen({super.key});

  @override
  ConsumerState<WalletTransferScreen> createState() =>
      _WalletTransferScreenState();
}

class _WalletTransferScreenState extends ConsumerState<WalletTransferScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController();
  final _amountController = TextEditingController();
  final _noteController = TextEditingController();
  final _submitGuard = TapGoSingleFlightGuard();

  // Key dibuat SEKALI per layar: rebuild/retry tetap memakai key yang sama
  // sehingga server mengenali retry sebagai replay, bukan transfer baru.
  // Pola sama dengan checkout PPOB.
  late final String _idempotencyKey =
      'transfer-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 20)}';

  bool _isSubmitting = false;

  @override
  void dispose() {
    _phoneController.dispose();
    _amountController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _onSubmit() async {
    if (_isSubmitting || !(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() => _isSubmitting = true);
    final rootContext = context;
    try {
      final session = ref.read(_demoSessionProvider);
      _apiClient.setAccessToken(session.accessToken);
      final success = await _submitGuard.run(() async {
        await _apiClient.transferWallet(
          recipientPhone: tapGoSanitizePhoneInput(_phoneController.text),
          amount: tapGoCanonicalRupiahValue(_amountController.text),
          note: _noteController.text,
          idempotencyKey: _idempotencyKey,
        );
        return true;
      });
      if (!rootContext.mounted) {
        return;
      }
      if (success == true) {
        ref.invalidate(_productionSnapshotProvider);
        Navigator.of(rootContext).pop();
        _TapGoSnackbar.success(rootContext, 'Transfer berhasil dikirim.');
        return;
      }
    } catch (error) {
      if (!rootContext.mounted) {
        return;
      }
      _TapGoSnackbar.error(rootContext, _friendlyTransferError(error));
    } finally {
      if (rootContext.mounted && _isSubmitting) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(_demoSessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Transfer Saldo')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: _brandBlue.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.account_balance_wallet_rounded,
                      color: _brandBlue,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Saldo TapGoPay: ${formatRupiah(session.walletBalance)}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          color: _brandBlue,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              _InputField(
                controller: _phoneController,
                icon: Icons.phone_rounded,
                label: 'Nomor HP penerima',
                hint: '08xxxxxxxxxx',
                keyboardType: TextInputType.phone,
                readOnly: _isSubmitting,
                validator: (value) {
                  final phone = tapGoSanitizePhoneInput(value);
                  if (phone.isEmpty) {
                    return 'Nomor HP penerima wajib diisi';
                  }
                  return tapGoIsValidIndonesianPhone(phone)
                      ? null
                      : 'Nomor HP tidak valid';
                },
              ),
              const SizedBox(height: 12),
              _InputField(
                controller: _amountController,
                icon: Icons.payments_rounded,
                label: 'Nominal',
                hint: 'Minimal Rp10.000',
                keyboardType: TextInputType.number,
                inputFormatters: tapGoRupiahInputFormatters,
                readOnly: _isSubmitting,
                validator: (value) {
                  final amount = tapGoCanonicalRupiahValue(value);
                  if (amount < 10000) {
                    return 'Minimal transfer Rp10.000';
                  }
                  if (amount > 2000000) {
                    return 'Maksimal Rp2.000.000 per transfer';
                  }
                  if (amount > session.walletBalance) {
                    return 'Saldo TapGoPay belum cukup';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
              _InputField(
                controller: _noteController,
                icon: Icons.edit_note_rounded,
                label: 'Catatan (opsional)',
                hint: 'Mis. bayar patungan',
                readOnly: _isSubmitting,
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _isSubmitting ? null : _onSubmit,
                  icon: _isSubmitting
                      ? const _TapGoLoading(size: 18, strokeWidth: 2)
                      : const Icon(Icons.send_rounded),
                  label: Text(_isSubmitting ? 'Mengirim...' : 'Kirim Transfer'),
                  style: FilledButton.styleFrom(
                    backgroundColor: _brandBlue,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 15),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _friendlyTransferError(Object error) {
  if (error is DioException) {
    final responseData = error.response?.data;
    if (responseData is Map) {
      final code = responseData['code']?.toString();
      switch (code) {
        case 'INSUFFICIENT_BALANCE':
          return 'Saldo TapGoPay belum cukup.';
        case 'TRANSFER_MINIMUM_NOT_MET':
          return 'Nominal transfer di bawah batas minimum.';
        case 'TRANSFER_MAX_PER_TRANSACTION_EXCEEDED':
          return 'Nominal melebihi batas maksimum per transfer.';
        case 'TRANSFER_DAILY_LIMIT_EXCEEDED':
          return 'Batas transfer harian Anda sudah tercapai. Coba lagi besok.';
        case 'TRANSFER_RECIPIENT_NOT_FOUND':
          return 'Nomor HP penerima tidak ditemukan.';
        case 'TRANSFER_SELF_NOT_ALLOWED':
          return 'Tidak dapat transfer ke akun sendiri.';
        case 'TRANSFER_IDEMPOTENCY_CONFLICT':
          return 'Permintaan duplikat terdeteksi. Periksa riwayat transfer Anda.';
        case 'WALLET_TRANSFER_DISABLED':
          return 'Fitur transfer belum tersedia saat ini.';
      }
    }
  }
  return tapGoGenericErrorMessage(
    error,
    fallback: 'Transfer belum berhasil. Silakan coba lagi.',
  );
}
