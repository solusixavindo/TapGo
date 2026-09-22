"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { ApiError, MITRA_PREVIEW, changePassword, uploadOwnAvatar } from "./mitra-api";
import ProfileAvatar from "./profile-avatar";
import { tierLabel } from "./mitra-format";
import { useMitra } from "./mitra-data";
import {
  Badge,
  Card,
  CardHeader,
  Field,
  Icon,
  Notice,
  PageHeading,
  Spinner,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  useToast
} from "./mitra-ui";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 md:px-6">
      <dt className="text-sm themed-text-muted">{label}</dt>
      <dd className="text-sm font-bold themed-text">{value || "-"}</dd>
    </div>
  );
}

export default function AccountView({ onLogout }: { onLogout: () => void }) {
  const { core } = useMitra();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  if (!core) return null;
  const { profile, summary } = core;

  async function onPickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      await uploadOwnAvatar(file);
      toast("success", "Foto profil diperbarui. Foto yang sama tampil di aplikasi TapGo.");
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : "Foto belum dapat diunggah.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!current) return setError("Masukkan password saat ini.");
    if (next.length < 8) return setError("Password baru minimal 8 karakter.");
    if (next !== confirm) return setError("Konfirmasi password baru tidak sama.");
    if (next === current) return setError("Password baru harus berbeda dari password saat ini.");
    setBusy(true);
    setError("");
    try {
      if (!MITRA_PREVIEW) await changePassword(current, next);
      toast("success", "Password diganti. Silakan masuk kembali.");
      window.setTimeout(onLogout, 900);
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 400)) {
        setError("Password saat ini tidak sesuai.");
      } else {
        setError(caught instanceof Error ? caught.message : "Password belum dapat diganti.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading title="Akun" description="Data profil, paket keanggotaan, dan keamanan akun." />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <div className="flex items-center gap-4 border-b themed-border px-5 py-5 md:px-6">
              <ProfileAvatar name={profile.fullName} sizeClass="h-16 w-16 text-lg" />
              <div className="min-w-0">
                <p className="truncate text-lg font-black themed-text">{profile.fullName}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge tone="gold">{tierLabel(summary.membershipTier)}</Badge>
                  <Badge tone="green">Aktif</Badge>
                </div>
                <div className="mt-2">
                  <input
                    ref={photoInput}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    aria-label="Pilih foto profil"
                    onChange={onPickPhoto}
                  />
                  <button
                    type="button"
                    disabled={photoBusy}
                    onClick={() => photoInput.current?.click()}
                    className="text-xs font-bold underline underline-offset-4 themed-text-muted hover:themed-text"
                  >
                    {photoBusy ? "Mengunggah…" : "Ganti foto profil"}
                  </button>
                </div>
              </div>
            </div>
            {photoError ? (
              <p role="alert" className="px-5 pt-3 text-sm font-semibold m-text-red md:px-6">
                {photoError}
              </p>
            ) : null}
            <dl className="divide-y m-divide">
              <Row label="Nomor HP" value={profile.phone} />
              <Row label="Email" value={profile.email ?? ""} />
              <Row label="Kode referral" value={summary.referralCode} />
            </dl>
            <div className="border-t themed-border px-5 py-4 md:px-6">
              <p className="text-xs leading-5 themed-text-muted">
                Foto profil (JPG/PNG, maksimal 4 MB) sama dengan foto di aplikasi TapGo: mengganti di sini juga mengganti di aplikasi.
                Untuk mengubah nama, nomor HP, atau email, hubungi tim dukungan TapGo dari halaman Kontak.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Paket keanggotaan" subtitle="Tingkatkan paket untuk membuka manfaat yang lebih besar" />
            <div className="flex flex-wrap items-center justify-between gap-4 p-5 md:p-6">
              <div>
                <p className="text-2xl font-black themed-text">{tierLabel(summary.membershipTier)}</p>
                <p className="mt-1 text-sm themed-text-muted">Paket aktif saat ini</p>
              </div>
              <Link href="/upgrade" className={primaryButtonClass}>
                Lihat paket
                <Icon name="external" className="h-4 w-4" />
              </Link>
            </div>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Ganti password" subtitle="Semua perangkat akan keluar setelah password diganti" />
            <form onSubmit={onSubmit} className="space-y-4 p-5 md:p-6" noValidate>
              <Field label="Password saat ini">
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                />
              </Field>
              <Field label="Password baru" hint="Minimal 8 karakter.">
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(event) => setNext(event.target.value)}
                />
              </Field>
              <Field label="Ulangi password baru">
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </Field>
              {error ? (
                <p role="alert" className="text-sm font-semibold m-text-red">
                  {error}
                </p>
              ) : null}
              <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>
                {busy ? <Spinner /> : null}
                {busy ? "Menyimpan…" : "Ganti password"}
              </button>
            </form>
          </Card>

          <Card className="p-5 md:p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl m-tone-green">
                <Icon name="shield" className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-black themed-text">Keamanan dana</p>
                <p className="mt-1 text-xs leading-5 themed-text-muted">
                  Penarikan selalu meminta password Anda dan hanya dikirim ke rekening yang tersimpan. Rekening baru
                  baru dapat dipakai 24 jam setelah disimpan. TapGo tidak pernah meminta password atau kode lewat chat.
                </p>
              </div>
            </div>
          </Card>

          <button type="button" onClick={onLogout} className={`${secondaryButtonClass} w-full`}>
            <Icon name="logout" className="h-4 w-4" />
            Keluar dari akun
          </button>
        </div>
      </div>
      {MITRA_PREVIEW ? <Notice tone="amber">Mode tinjauan: data pada halaman ini adalah contoh.</Notice> : null}
    </div>
  );
}
