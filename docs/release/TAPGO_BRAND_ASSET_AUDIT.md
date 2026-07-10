# TapGo Brand Asset Audit

Tanggal audit: 11 Juni 2026

## Ringkasan

Logo resmi TapGo yang dipakai aplikasi Flutter saat ini adalah:

`apps/user_app/assets/images/tapgo_logo.jpeg`

Asset ini dipakai sebagai logo login, splash screen, avatar/profile image, dan sumber konfigurasi launcher icon Android melalui `flutter_launcher_icons`.

## Asset Logo Resmi

| Item | Nilai |
| --- | --- |
| Lokasi | `apps/user_app/assets/images/tapgo_logo.jpeg` |
| Format | JPEG |
| Dimensi | 1280 x 1088 px |
| Ukuran file | 63 KB |
| Visual | Logo TapGo gold dengan simbol lion/T di atas background navy |
| Status | Asset resmi aplikasi saat ini |

## App Icon / Launcher Icon

| Asset | Lokasi | Format / Ukuran | Keterangan |
| --- | --- | --- | --- |
| Launcher icon source | `apps/user_app/assets/images/tapgo_logo.jpeg` | JPEG 1280 x 1088 | Sumber dari konfigurasi `flutter_launcher_icons` |
| Launcher mdpi | `apps/user_app/android/app/src/main/res/mipmap-mdpi/ic_launcher.png` | PNG 48 x 48 | Generated Android launcher icon |
| Launcher hdpi | `apps/user_app/android/app/src/main/res/mipmap-hdpi/ic_launcher.png` | PNG 72 x 72 | Generated Android launcher icon |
| Launcher xhdpi | `apps/user_app/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png` | PNG 96 x 96 | Generated Android launcher icon |
| Launcher xxhdpi | `apps/user_app/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` | PNG 144 x 144 | Generated Android launcher icon |
| Launcher xxxhdpi | `apps/user_app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | PNG 192 x 192 | Generated Android launcher icon |
| Adaptive foreground | `apps/user_app/android/app/src/main/res/drawable-xxxhdpi/ic_launcher_foreground.png` | PNG 432 x 432 | Foreground adaptive icon generated from source logo |
| Adaptive background | `apps/user_app/android/app/src/main/res/values/colors.xml` | `#06284A` | Navy background for adaptive launcher icon |

## Splash Logo

| Area | File / Reference | Keterangan |
| --- | --- | --- |
| Flutter splash screen | `apps/user_app/lib/screens/splash_screen.dart` | Uses `Image.asset('assets/images/tapgo_logo.jpeg')` |
| Android launch background | `apps/user_app/android/app/src/main/res/drawable/launch_background.xml` | Native launch background only; Flutter splash then shows TapGo logo |

## Login Logo

| Area | File / Reference | Keterangan |
| --- | --- | --- |
| Login/Register screen | `apps/user_app/lib/screens/auth_screen.dart` | Uses `Image.asset('assets/images/tapgo_logo.jpeg')` |

## Profile / Dashboard Logo

| Area | File / Reference | Keterangan |
| --- | --- | --- |
| Profile image widget | `apps/user_app/lib/widgets/stat_card.dart` | Falls back to `assets/images/tapgo_logo.jpeg` |
| Dashboard logo use | `apps/user_app/lib/screens/dashboard_screen.dart` | Uses `assets/images/tapgo_logo.jpeg` in premium dashboard visual elements |

## Pubspec Configuration

`apps/user_app/pubspec.yaml` includes:

```yaml
flutter:
  assets:
    - assets/images/tapgo_logo.jpeg

flutter_launcher_icons:
  android: true
  ios: false
  image_path: assets/images/tapgo_logo.jpeg
  adaptive_icon_background: "#06284A"
  adaptive_icon_foreground: assets/images/tapgo_logo.jpeg
```

## Asset yang Harus Dipakai untuk Google Play

Gunakan `apps/user_app/assets/images/tapgo_logo.jpeg` sebagai sumber resmi untuk:

- Feature graphic.
- Store listing branding.
- Screenshot cover/collage jika diperlukan.
- Icon reference saat mengisi Google Play Console.

Gunakan generated launcher icon `apps/user_app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` hanya sebagai referensi ukuran launcher Android. Untuk desain marketing, gunakan source logo JPEG agar resolusi lebih tinggi.

## Catatan

- Feature graphic lama yang memakai logo/ikon placeholder perlu diganti.
- Feature graphic final sudah dibuat ulang menggunakan logo resmi aplikasi di `google-play-assets/feature-graphic-1024x500.png`.
