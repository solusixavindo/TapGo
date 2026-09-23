"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminRideDriver,
  AdminRideOrder,
  AdminRideOrderDetail,
  formatMoment,
  formatRupiah,
  getAdminRide,
  listAdminRideDrivers,
  listAdminRides,
  readRole,
  readToken
} from "../../lib/api";
import ConsoleHeader from "../console-header";

/**
 * Monitoring perjalanan & driver — live view.
 *
 * Backend admin/rides sudah lengkap (list, detail, koreksi status) sejak awal,
 * tapi belum ada halaman konsol yang memakainya — Super Admin VIP sebelumnya
 * tidak bisa melihat perjalanan yang sedang berjalan atau driver mana yang
 * online sama sekali. Halaman ini murni pemantauan (read-only); tindakan
 * koreksi status/driver sengaja belum ditambahkan di sini, di luar permintaan
 * "monitoring" saat ini.
 */
const REFRESH_INTERVAL_MS = 10_000;

const ACTIVE_ORDER_STATUSES = [
  "SEARCHING_DRIVER",
  "DRIVER_ASSIGNED",
  "DRIVER_TO_PICKUP",
  "DRIVER_ARRIVED",
  "IN_TRIP"
];

const ORDER_STATUS_LABEL: Record<string, string> = {
  CREATED: "Dibuat",
  SEARCHING_DRIVER: "Mencari driver",
  DRIVER_ASSIGNED: "Driver ditugaskan",
  DRIVER_TO_PICKUP: "Menuju jemput",
  DRIVER_ARRIVED: "Driver tiba",
  IN_TRIP: "Dalam perjalanan",
  COMPLETED: "Selesai",
  CANCELLED_BY_PASSENGER: "Dibatalkan penumpang",
  CANCELLED_BY_DRIVER: "Dibatalkan driver",
  CANCELLED_BY_SYSTEM: "Dibatalkan sistem",
  NO_DRIVER: "Tidak ada driver",
  EXPIRED: "Kedaluwarsa"
};

const ORDER_STATUS_TONE: Record<string, string> = {
  SEARCHING_DRIVER: "bg-amber-100 text-amber-800",
  DRIVER_ASSIGNED: "bg-blue-100 text-blue-800",
  DRIVER_TO_PICKUP: "bg-blue-100 text-blue-800",
  DRIVER_ARRIVED: "bg-indigo-100 text-indigo-800",
  IN_TRIP: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-slate-200 text-slate-700",
  CANCELLED_BY_PASSENGER: "bg-rose-100 text-rose-800",
  CANCELLED_BY_DRIVER: "bg-rose-100 text-rose-800",
  CANCELLED_BY_SYSTEM: "bg-rose-100 text-rose-800",
  NO_DRIVER: "bg-rose-100 text-rose-800",
  EXPIRED: "bg-rose-100 text-rose-800",
  CREATED: "bg-slate-100 text-slate-600"
};

const DRIVER_AVAILABILITY_LABEL: Record<string, string> = {
  OFFLINE: "Offline",
  ONLINE: "Online",
  BUSY: "Sibuk"
};

const DRIVER_AVAILABILITY_TONE: Record<string, string> = {
  OFFLINE: "bg-slate-200 text-slate-700",
  ONLINE: "bg-emerald-100 text-emerald-800",
  BUSY: "bg-amber-100 text-amber-800"
};

function StatusBadge({ label, tone }: { label: string; tone: string }) {
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${tone}`}>{label}</span>;
}

export default function RidesMonitoringPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [orders, setOrders] = useState<AdminRideOrder[]>([]);
  const [drivers, setDrivers] = useState<AdminRideDriver[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminRideOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [ordersResult, driversResult] = await Promise.all([
        listAdminRides({ status: statusFilter || undefined, limit: 100 }),
        listAdminRideDrivers({ limit: 100 })
      ]);
      setOrders(ordersResult);
      setDrivers(driversResult);
      setUpdatedAt(new Date());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    setRole(readRole());
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(tick, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, refresh]);

  const activeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const status of ACTIVE_ORDER_STATUSES) counts[status] = 0;
    for (const order of orders) {
      if (counts[order.status] !== undefined) counts[order.status] += 1;
    }
    return counts;
  }, [orders]);

  const totalActive = ACTIVE_ORDER_STATUSES.reduce((sum, status) => sum + (activeCounts[status] ?? 0), 0);

  const driverCounts = useMemo(() => {
    const counts: Record<string, number> = { ONLINE: 0, BUSY: 0, OFFLINE: 0 };
    for (const driver of drivers) {
      if (driver.status !== "ACTIVE") continue;
      counts[driver.availability] = (counts[driver.availability] ?? 0) + 1;
    }
    return counts;
  }, [drivers]);

  async function toggleExpand(order: AdminRideOrder) {
    if (expanded === order.reference) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(order.reference);
    setDetail(null);
    setDetailLoading(true);
    try {
      const result = await getAdminRide(order.reference);
      setDetail(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Detail perjalanan belum dapat dimuat.");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader
          title="Monitoring Perjalanan"
          subtitle="Perjalanan dan driver TapGo secara langsung — diperbarui otomatis tiap 10 detik"
          role={role}
        />

        {updatedAt ? (
          <p className="mb-3 flex items-center gap-2 text-xs text-slate-500" aria-live="off">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            Langsung · diperbarui{" "}
            {new Intl.DateTimeFormat("id-ID", { timeStyle: "medium", timeZone: "Asia/Jakarta" }).format(updatedAt)} WIB
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Perjalanan aktif</p>
            <p className="mt-2 text-lg font-black text-brand-navy">{totalActive}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Mencari driver</p>
            <p className="mt-2 text-lg font-black text-brand-navy">{activeCounts.SEARCHING_DRIVER ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Driver online</p>
            <p className="mt-2 text-lg font-black text-emerald-700">{driverCounts.ONLINE}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Driver sibuk (dalam order)</p>
            <p className="mt-2 text-lg font-black text-amber-700">{driverCounts.BUSY}</p>
          </div>
        </section>

        <section className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Perjalanan terbaru ({orders.length})
            </h2>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-green"
            >
              <option value="">Semua status</option>
              {Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Memuat…</p>
          ) : orders.length === 0 ? (
            <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm">
              <p className="font-bold">Tidak ada perjalanan pada status ini</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Referensi</th>
                    <th className="px-4 py-3">Penumpang</th>
                    <th className="px-4 py-3">Driver</th>
                    <th className="px-4 py-3">Rute</th>
                    <th className="px-4 py-3 text-right">Tarif</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Waktu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((order) => (
                    <Fragment key={order.reference}>
                      <tr
                        className="cursor-pointer align-top hover:bg-slate-50"
                        onClick={() => void toggleExpand(order)}
                      >
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs font-bold">{order.reference}</p>
                          <p className="text-xs text-slate-500">{order.serviceType === "CAR" ? "Mobil" : "Motor"}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{order.passenger.name ?? "—"}</p>
                          <p className="text-xs text-slate-500">{order.passenger.phoneMasked ?? ""}</p>
                        </td>
                        <td className="px-4 py-3">
                          {order.driver ? (
                            <>
                              <p className="font-semibold">{order.driver.name ?? "—"}</p>
                              <p className="text-xs text-slate-500">{order.driver.phoneMasked ?? ""}</p>
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">Belum ditugaskan</p>
                          )}
                        </td>
                        <td className="max-w-[220px] px-4 py-3 text-xs text-slate-600">
                          <p className="truncate">Dari: {order.pickupAddress}</p>
                          <p className="truncate">Ke: {order.dropoffAddress}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-black tabular-nums">
                          {formatRupiah(order.totalFare)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge
                            label={ORDER_STATUS_LABEL[order.status] ?? order.status}
                            tone={ORDER_STATUS_TONE[order.status] ?? "bg-slate-100 text-slate-600"}
                          />
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{formatMoment(order.updatedAt)}</td>
                      </tr>
                      {expanded === order.reference ? (
                        <tr key={`${order.reference}-detail`}>
                          <td colSpan={7} className="bg-slate-50 px-4 py-4">
                            {detailLoading ? (
                              <p className="text-sm text-slate-500">Memuat riwayat…</p>
                            ) : detail && detail.reference === order.reference ? (
                              <ol className="space-y-2">
                                {detail.events.map((event, index) => (
                                  <li key={index} className="flex items-start gap-3 text-xs">
                                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand-navy" />
                                    <div>
                                      <p className="font-semibold text-slate-800">
                                        {event.type}
                                        {event.newStatus ? ` → ${ORDER_STATUS_LABEL[event.newStatus] ?? event.newStatus}` : ""}
                                      </p>
                                      <p className="text-slate-500">
                                        {formatMoment(event.createdAt)} · aktor: {event.actorRole}
                                      </p>
                                    </div>
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <p className="text-sm text-slate-500">Riwayat belum tersedia.</p>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-6">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
            Driver ({drivers.length})
          </h2>
          {drivers.length === 0 ? (
            <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm">
              <p className="font-bold">Belum ada driver terdaftar</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Driver</th>
                    <th className="px-4 py-3">Kendaraan</th>
                    <th className="px-4 py-3">Rating</th>
                    <th className="px-4 py-3">Ketersediaan</th>
                    <th className="px-4 py-3">Terakhir terlihat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {drivers.map((driver) => (
                    <tr key={driver.profileId} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-semibold">{driver.name ?? "—"}</p>
                        <p className="text-xs text-slate-500">{driver.phoneMasked ?? ""}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {driver.vehicles.map((vehicle) => (
                          <p key={vehicle.id}>
                            {vehicle.type === "CAR" ? "Mobil" : "Motor"} · {vehicle.plateNumberMasked}
                          </p>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-slate-600">
                        {driver.ratingAverage} ({driver.ratingCount})
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={DRIVER_AVAILABILITY_LABEL[driver.availability] ?? driver.availability}
                          tone={DRIVER_AVAILABILITY_TONE[driver.availability] ?? "bg-slate-100 text-slate-600"}
                        />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{formatMoment(driver.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
