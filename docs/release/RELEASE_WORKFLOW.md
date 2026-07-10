# TapGo Release Workflow

Tanggal: 2026-07-11

Dokumen ini menetapkan alur branch dan release TapGo untuk menjaga stabilitas production, keamanan payment flow, dan traceability perubahan.

## Branch Strategy

### `main`

`main` adalah branch stabil dan release-ready.

Aturan:
- Hanya menerima merge dari `release/*` atau `hotfix/*`.
- Harus selalu bisa dibuild dan diuji.
- Setiap release production diberi tag dari branch ini.
- Tidak boleh force push.

### `develop`

`develop` adalah branch integrasi untuk perubahan yang sudah direview.

Aturan:
- Feature/fix branch masuk ke `develop`.
- Validasi build/test berjalan sebelum masuk release branch.
- Tidak digunakan langsung untuk deploy production.

### `release/vX.Y.Z`

`release/*` dipakai untuk persiapan release candidate.

Aturan:
- Dibuat dari `develop`.
- Hanya menerima perbaikan bug, dokumentasi release, dan penyesuaian version metadata.
- Setelah siap, merge ke `main`, diberi tag, lalu merge kembali ke `develop`.

### `hotfix/*`

`hotfix/*` dipakai untuk perbaikan darurat production.

Aturan:
- Dibuat dari `main`.
- Scope perubahan harus kecil dan langsung terkait issue production.
- Setelah valid, merge ke `main`, tag patch release, lalu merge kembali ke `develop`.

## Alur Normal

```text
feature/fix branch
-> develop
-> release/vX.Y.Z
-> main
-> tag
-> merge back to develop
```

## Tagging

Tag release dibuat sebagai annotated tag:

```bash
git tag -a vX.Y.Z -m "TapGo vX.Y.Z"
git push origin vX.Y.Z
```

Untuk milestone saat ini:

```bash
git tag -a v1.0.0-alpha -m "TapGo v1.0.0-alpha"
```

## Release Guard

Sebelum merge/tag:
- Backend build PASS.
- Backend test PASS.
- Prisma schema validate PASS.
- Flutter analyze PASS.
- Flutter test PASS.
- Tidak ada `.env`, keystore, private key, credential payment gateway, APK/AAB, atau dokumen legal sensitif yang ikut commit.
- Tidak ada perubahan business logic tanpa approval eksplisit.
- Tidak ada deploy otomatis dari proses release management.
