import { Prisma, PrismaClient, RideOrderStatus, UserRole } from "@prisma/client";

/**
 * Data uji untuk wawasan Beranda VIP. Tanpa impor vitest supaya skrip lab di peramban dapat memakainya juga.
 * Waktu relatif terhadap `now`; semua data berada dalam 6 hari terakhir kecuali satu pendaftar 40 hari lalu.
 */
const hours = (now: Date, value: number) => new Date(now.getTime() - value * 3_600_000);
const days = (now: Date, value: number) => hours(now, value * 24);

export async function seedInsightsData(prisma: PrismaClient, now: Date = new Date()) {
  let seq = 0;
  const user = (role: UserRole, fullName: string, createdAt: Date) => {
    seq += 1;
    return prisma.user.create({
      data: { fullName, phone: `+62813${String(seq).padStart(8, "0")}`, referralCode: `INS${String(seq).padStart(6, "0")}`, role, createdAt }
    });
  };
  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });

  // --- Pendaftar: 4 member dalam 6 hari (1 jam, 2 jam, 1 hari, 3 hari lalu) + 1 member 40 hari lalu + 2 pengemudi (2 hari lalu).
  const m1 = await user("USER", "Budi Santoso", hours(now, 1));
  const m2 = await user("USER", "Siti Rahma", hours(now, 2));
  const m3 = await user("USER", "Andi Pratama", days(now, 1));
  const m4 = await user("USER", "Dewi Lestari", days(now, 3));
  await user("USER", "Member Lama", days(now, 40));
  const d1 = await user("DRIVER", "Dedi Kurniawan", days(now, 2));
  const d2 = await user("DRIVER", "Eko Wahyudi", days(now, 2));
  const d3 = await user("DRIVER", "Fajar Nugroho", days(now, 5));

  // --- Alamat domisili member (dari pendaftaran upgrade) dan satu pembayaran upgrade lunas Rp190.000.
  const addresses: Array<[typeof m1, string]> = [
    [m1, "Jl. Basuki Rahmat No. 12, Kec. Genteng, Kota Surabaya, Jawa Timur 60271, Indonesia"],
    [m2, "Jalan Mawar 5, Kel. Sukolilo, Kec. Sukolilo, Surabaya"],
    [m3, "Jl. Braga No. 3, Kota Bandung, Jawa Barat 40111"]
  ];
  let paidInvoice = false;
  for (const [member, address] of addresses) {
    const order = await prisma.membershipOrder.create({
      data: {
        userId: member.id, membershipId: silver.id, status: "PAID", totalAmount: new Prisma.Decimal(190000), packageSnapshot: {},
        registrationData: { fullName: member.fullName, address }, paidAt: hours(now, 5), createdAt: hours(now, 6)
      }
    });
    if (!paidInvoice) {
      paidInvoice = true;
      await prisma.invoice.create({
        data: { orderId: order.id, userId: member.id, number: "INV-INSIGHT-1", status: "PAID", amount: new Prisma.Decimal(190000), paidAt: hours(now, 5), createdAt: hours(now, 6) }
      });
    }
  }

  // --- Sumber pendaftaran: 3 dari Play, 1 APK langsung, 1 tanpa keterangan.
  const event = (distribution: string | null, installer: string | null, at: Date) => {
    seq += 1;
    return prisma.registrationEvent.create({
      data: { normalizedPhone: `+6299${seq}`, phoneHash: `hash-insight-${seq}`, distribution, installer, createdAt: at }
    });
  };
  await event("play", "com.android.vending", hours(now, 1));
  await event("play", "com.android.vending", hours(now, 2));
  await event("play", "com.android.vending", days(now, 1));
  await event("direct", null, days(now, 2));
  await event(null, null, days(now, 3));

  // --- Pengemudi: profil perjalanan (aktif online/sibuk/offline, satu menunggu) dengan rating tersimpan.
  const profile = (userId: string, status: "ACTIVE" | "PENDING", availability: "ONLINE" | "BUSY" | "OFFLINE", average: string, count: number) =>
    prisma.rideDriverProfile.create({ data: { userId, status, availability, ratingAverage: new Prisma.Decimal(average), ratingCount: count } });
  const p1 = await profile(d1.id, "ACTIVE", "ONLINE", "4.90", 10);
  const p2 = await profile(d2.id, "ACTIVE", "BUSY", "3.20", 5);
  const p3 = await profile(d3.id, "ACTIVE", "OFFLINE", "4.60", 4);
  const pendingUser = await user("DRIVER", "Calon Driver", days(now, 1));
  await profile(pendingUser.id, "PENDING", "OFFLINE", "5.00", 0);

  // --- Data diri pengemudi (usia dan alamat): 22, 27, 27 (dua orang), 41, 60 tahun; satu tanpa tanggal lahir.
  const born = (age: number) => new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), 1));
  const driverData: Array<[string, Date | null, string]> = [
    [d1.id, born(22), "Jl. A, Kota Surabaya, Jawa Timur"],
    [d2.id, born(27), "Jl. B, Kota Surabaya, Jawa Timur"],
    [d3.id, born(27), "Jl. C, Kota Bandung, Jawa Barat"],
    [m1.id, born(41), "Jl. D, Kab. Sidoarjo, Jawa Timur"],
    [m2.id, born(60), "Jl. E, Kota Malang"],
    [m4.id, null, "Alamat tanpa kota"]
  ];
  for (const [userId, dateOfBirth, address] of driverData) {
    await prisma.driver.create({ data: { userId, dateOfBirth, address } });
  }

  // --- Perjalanan: 6 selesai, 2 dibatalkan penumpang, 1 tanpa driver, 1 sedang berjalan; titik jemput Surabaya/Bandung.
  const vehicle = await prisma.rideVehicle.create({
    data: {
      driverProfileId: p1.id, type: "MOTORCYCLE", plateNumberHash: "hash-insight-vehicle", plateNumberMasked: "L 1234 XY",
      brand: "Honda", model: "Vario", color: "Hitam", verificationStatus: "VERIFIED", isActive: true
    }
  });
  const makeOrder = async (passengerId: string, status: RideOrderStatus, pickupAddress: string, createdAt: Date, driverProfileId?: string, serviceType: "MOTORCYCLE" | "CAR" = "MOTORCYCLE") => {
    seq += 1;
    const quote = await prisma.rideQuote.create({
      data: {
        userId: passengerId, serviceType, pickupLat: "-7.2500000", pickupLng: "112.7500000", pickupAddress,
        dropoffLat: "-7.2600000", dropoffLng: "112.7600000", dropoffAddress: "Tujuan uji", distanceMeters: 3000, durationSeconds: 900,
        etaSeconds: 300, baseFare: 5000, distanceFare: 8000, serviceFee: 1000, subtotalFare: 14000, totalFare: 14000,
        fareRuleVersion: "test", roundingRule: "test", distanceSource: "test", expiresAt: new Date(createdAt.getTime() + 600_000)
      }
    });
    return prisma.rideOrder.create({
      data: {
        publicReference: `INS-${String(seq).padStart(6, "0")}`, passengerId, quoteId: quote.id, serviceType, status,
        pickupLat: quote.pickupLat, pickupLng: quote.pickupLng, pickupAddress, dropoffLat: quote.dropoffLat, dropoffLng: quote.dropoffLng,
        dropoffAddress: quote.dropoffAddress, distanceMeters: 3000, durationSeconds: 900, baseFare: 5000, distanceFare: 8000, serviceFee: 1000,
        subtotalFare: 14000, totalFare: 14000, fareRuleVersion: "test", createdAt,
        ...(driverProfileId ? { driverProfileId, vehicleId: vehicle.id, assignedAt: createdAt } : {})
      }
    });
  };
  const surabaya = "Jl. Basuki Rahmat, Kec. Genteng, Kota Surabaya, Jawa Timur 60271, Indonesia";
  const bandung = "Jl. Braga, Kota Bandung, Jawa Barat 40111, Indonesia";
  const completed = [
    await makeOrder(m1.id, "COMPLETED", surabaya, hours(now, 1), p1.id),
    await makeOrder(m2.id, "COMPLETED", surabaya, hours(now, 2), p1.id),
    await makeOrder(m3.id, "COMPLETED", bandung, days(now, 1), p2.id),
    await makeOrder(m4.id, "COMPLETED", surabaya, days(now, 2), p2.id),
    await makeOrder(m1.id, "COMPLETED", bandung, days(now, 3), p3.id, "CAR"),
    await makeOrder(m2.id, "COMPLETED", surabaya, days(now, 4), p3.id)
  ];
  await makeOrder(m3.id, "CANCELLED_BY_PASSENGER", surabaya, hours(now, 3));
  await makeOrder(m4.id, "CANCELLED_BY_PASSENGER", bandung, days(now, 2));
  await makeOrder(m1.id, "NO_DRIVER", "Jl. Tanpa Kota 9", days(now, 1));
  await makeOrder(m2.id, "IN_TRIP", surabaya, hours(now, 0.5), p1.id);

  // --- Rating: bintang 5, 5, 4, 1, 2, 5; empat di antaranya dengan komentar.
  const ratings: Array<[number, number, string | null, Date]> = [
    [0, 5, "Driver ramah dan tepat waktu.", hours(now, 1)],
    [1, 5, null, hours(now, 2)],
    [2, 4, "Cukup baik, agak ngebut.", days(now, 1)],
    [3, 1, "Driver membatalkan lalu menghilang, mengecewakan.", days(now, 2)],
    [4, 2, "Mobil kurang bersih.", days(now, 3)],
    [5, 5, null, days(now, 4)]
  ];
  for (const [position, stars, note, createdAt] of ratings) {
    const order = completed[position]!;
    await prisma.rideRating.create({ data: { rideOrderId: order.id, driverProfileId: order.driverProfileId!, stars, note, createdAt } });
  }

  // --- Perlu perhatian: tiket bantuan terbuka, penarikan menunggu, transaksi PPOB tertahan.
  seq += 1;
  await prisma.supportTicket.create({ data: { userId: m1.id, reference: `SUP-INS-${seq}`, subject: "Tidak bisa top up", status: "OPEN" } });
  const wallet = await prisma.wallet.create({ data: { userId: m3.id, cashBalance: new Prisma.Decimal(500000), balance: new Prisma.Decimal(500000) } });
  await prisma.withdrawal.create({
    data: { walletId: wallet.id, userId: m3.id, amount: new Prisma.Decimal(150000), finalAmount: new Prisma.Decimal(150000), bankAccount: {}, requestedAt: hours(now, 1) }
  });
  const product = await prisma.ppobProduct.create({
    data: { sku: "PULSA_INS_10", category: "PULSA", brand: "Telkomsel", name: "Pulsa 10.000", price: new Prisma.Decimal(11000), providerSku: "ins10" }
  });
  const ppob = (reference: string, createdAt: Date, extra: Partial<Prisma.PpobTransactionUncheckedCreateInput>) =>
    prisma.ppobTransaction.create({
      data: {
        publicReference: reference, userId: m1.id, productId: product.id, skuSnapshot: product.sku, productNameSnapshot: product.name,
        brandSnapshot: product.brand, category: "PULSA", targetNumber: "081298765432", amount: new Prisma.Decimal(11000),
        totalAmount: new Prisma.Decimal(11000), status: "SUCCESS", provider: "digiflazz", providerCost: new Prisma.Decimal(10200), createdAt, ...extra
      }
    });
  await ppob("INS-PPOB-1", hours(now, 1), {});
  await ppob("INS-PPOB-2", hours(now, 2), {});
  await ppob("INS-PPOB-STUCK", hours(now, 1), { status: "PROCESSING", providerCost: null });

  return { members: [m1, m2, m3, m4], drivers: [d1, d2, d3], profiles: [p1, p2, p3] };
}
