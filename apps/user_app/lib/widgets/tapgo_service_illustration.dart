part of '../main.dart';

class _TapGoServiceIllustration extends StatelessWidget {
  const _TapGoServiceIllustration({
    required this.label,
    required this.fallbackIcon,
    required this.fallbackStyle,
    required this.size,
  });

  final String label;
  final IconData fallbackIcon;
  final _ServiceIconStyle fallbackStyle;
  final double size;

  static const _basePath = 'assets/illustrations/services';

  static const _assets = <String, String>{
    'Home': '$_basePath/tg-home.svg',
    'Beranda': '$_basePath/tg-home.svg',
    'Wallet': '$_basePath/tg-wallet.svg',
    'TapGoPay': '$_basePath/tg-wallet.svg',
    'Top Up': '$_basePath/tg-top-up.svg',
    'Upgrade': '$_basePath/tg-upgrade.svg',
    'Upgrade Paket': '$_basePath/tg-upgrade.svg',
    'Referral': '$_basePath/tg-referral.svg',
    'Referral Saya': '$_basePath/tg-referral.svg',
    'Membership': '$_basePath/tg-membership.svg',
    'Membership Saya': '$_basePath/tg-membership.svg',
    'Marketing Plan': '$_basePath/tg-membership.svg',
    'Reward': '$_basePath/tg-reward.svg',
    'Bonus': '$_basePath/tg-bonus.svg',
    'Bonus hari ini': '$_basePath/tg-bonus.svg',
    'Commission': '$_basePath/tg-commission.svg',
    'Komisi': '$_basePath/tg-commission.svg',
    'Cashback': '$_basePath/tg-cashback.svg',
    'PPOB': '$_basePath/tg-ppob.svg',
    'Pulsa': '$_basePath/tg-pulsa.svg',
    'Tagihan': '$_basePath/tg-tagihan.svg',
    'BPJS': '$_basePath/tg-bpjs.svg',
    'Merchant': '$_basePath/tg-merchant.svg',
    'TapGo Food': '$_basePath/tg-merchant.svg',
    'TapGo Mart': '$_basePath/tg-marketplace.svg',
    'Marketplace': '$_basePath/tg-marketplace.svg',
    'Jasa': '$_basePath/tg-jasa.svg',
    'TapGo Jasa': '$_basePath/tg-jasa.svg',
    'Toko & Jasa': '$_basePath/tg-jasa.svg',
    'TapGo Bantu': '$_basePath/tg-jasa.svg',
    'Support': '$_basePath/tg-support.svg',
    'Lainnya': '$_basePath/tg-activity.svg',
    'Kelas Online': '$_basePath/tg-kelas-online.svg',
    'Webinar': '$_basePath/tg-webinar.svg',
    'Event': '$_basePath/tg-event.svg',
    'TapGo Ride': '$_basePath/tg-ojek-motor.svg',
    'Ojek Motor': '$_basePath/tg-ojek-motor.svg',
    // Label entry point Ojek Online pada dashboard Release 2. Alias, bukan
    // ilustrasi baru: keduanya menunjuk aset yang sudah ada.
    'Motor': '$_basePath/tg-ojek-motor.svg',
    'TapGo Car': '$_basePath/tg-ojek-mobil.svg',
    'Ojek Mobil': '$_basePath/tg-ojek-mobil.svg',
    'Mobil': '$_basePath/tg-ojek-mobil.svg',
    'Activity': '$_basePath/tg-activity.svg',
    'Aktivitas': '$_basePath/tg-activity.svg',
    'Notification': '$_basePath/tg-notification.svg',
    'Notifikasi': '$_basePath/tg-notification.svg',
    'Chat': '$_basePath/tg-chat.svg',
    'Profile': '$_basePath/tg-profile.svg',
    'Akun': '$_basePath/tg-profile.svg',
  };

  static String? assetFor(String label) => _assets[label];

  @override
  Widget build(BuildContext context) {
    final asset = assetFor(label);
    if (asset == null) {
      return _ServiceIcon3D(
        icon: fallbackIcon,
        style: fallbackStyle,
        size: size,
      );
    }

    return SvgPicture.asset(
      asset,
      width: size,
      height: size,
      fit: BoxFit.contain,
      clipBehavior: Clip.none,
    );
  }
}

String? tapGoServiceIllustrationAssetForTests(String label) =>
    _TapGoServiceIllustration.assetFor(label);

enum PremiumTapGoIconAction {
  memberCard,
  profile,
  supportTicket,
  deleteAccount,
  privacyPolicy,
  termsConditions,
  contactUs,
  help,
  themeSettings,
  logout,
}

extension PremiumTapGoIconActionAsset on PremiumTapGoIconAction {
  static const _basePath = 'assets/icons/basic_portal';

  String get assetPath => switch (this) {
        PremiumTapGoIconAction.memberCard => '$_basePath/member_card.png',
        PremiumTapGoIconAction.profile => '$_basePath/profile.png',
        PremiumTapGoIconAction.supportTicket => '$_basePath/support_ticket.png',
        PremiumTapGoIconAction.deleteAccount => '$_basePath/delete_account.png',
        PremiumTapGoIconAction.privacyPolicy => '$_basePath/privacy_policy.png',
        PremiumTapGoIconAction.termsConditions =>
          '$_basePath/terms_conditions.png',
        PremiumTapGoIconAction.contactUs => '$_basePath/contact_us.png',
        PremiumTapGoIconAction.help => '$_basePath/help.png',
        PremiumTapGoIconAction.themeSettings => '$_basePath/help.png',
        PremiumTapGoIconAction.logout => '$_basePath/logout.png',
      };
}

class PremiumTapGoIcon extends StatelessWidget {
  const PremiumTapGoIcon({
    required this.label,
    required this.fallbackIcon,
    this.size = 64,
    this.padding = 4,
    super.key,
  });

  final String label;
  final IconData fallbackIcon;
  final double size;
  final double padding;

  static const _actionByLabel = <String, PremiumTapGoIconAction>{
    'Kartu Anggota': PremiumTapGoIconAction.memberCard,
    'Profil': PremiumTapGoIconAction.profile,
    'Tiket Bantuan': PremiumTapGoIconAction.supportTicket,
    'Hapus Akun': PremiumTapGoIconAction.deleteAccount,
    'Kebijakan Privasi': PremiumTapGoIconAction.privacyPolicy,
    'Syarat & Ketentuan': PremiumTapGoIconAction.termsConditions,
    'Hubungi Kami': PremiumTapGoIconAction.contactUs,
    'Bantuan': PremiumTapGoIconAction.help,
    'Tampilan': PremiumTapGoIconAction.themeSettings,
    'Logout': PremiumTapGoIconAction.logout,
    'Keluar': PremiumTapGoIconAction.logout,
  };

  static PremiumTapGoIconAction? actionFor(String label) =>
      _actionByLabel[label];

  static String? assetFor(String label) => actionFor(label)?.assetPath;

  @override
  Widget build(BuildContext context) {
    final asset = assetFor(label);
    return SizedBox.square(
      dimension: size,
      child: Padding(
        padding: EdgeInsets.all(padding),
        child: ExcludeSemantics(
          child: asset == null
              ? _PremiumTapGoIconFallback(icon: fallbackIcon)
              : Image.asset(
                  asset,
                  fit: BoxFit.contain,
                  filterQuality: FilterQuality.high,
                  errorBuilder: (context, error, stackTrace) =>
                      _PremiumTapGoIconFallback(icon: fallbackIcon),
                ),
        ),
      ),
    );
  }
}

class _PremiumTapGoIconFallback extends StatelessWidget {
  const _PremiumTapGoIconFallback({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Center(child: Icon(icon, color: _brandBlue, size: 28));
  }
}

String? tapGoPremiumIconAssetForTests(String label) =>
    PremiumTapGoIcon.assetFor(label);
