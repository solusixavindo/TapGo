import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/core/errors/AppError.js";
import {
  IdentifierKeyRegistry,
  createIdentifierKeyRegistryFromEnv,
} from "../../src/core/security/identifierKeyRegistry.js";
import {
  IdentifierDomain,
  IdentifierEvent,
  IdentifierIndexService,
  buildMessage,
} from "../../src/core/security/identifierIndex.js";

/**
 * Stage 5.14A — identifier blind index service.
 *
 * Golden vector memakai kunci sintetis yang SENGAJA publik dan hanya untuk
 * test. Nilai expected digest ditulis sebagai literal (bukan dihitung ulang
 * oleh implementasi yang sedang diuji) supaya drift pada algorithm, message
 * format, domain separation, key version, atau canonicalization langsung
 * terdeteksi.
 *
 * Seluruh input adalah data sintetis. Dilarang memakai NIK, SIM, STNK, atau
 * nomor polisi milik orang nyata.
 */

// PUBLIC SYNTHETIC TEST KEY — NEVER USE IN PRODUCTION
const TEST_KEY_V1 =
  "PUBLIC SYNTHETIC TEST KEY — NEVER USE IN PRODUCTION — TAPGO IDENTIFIER V1";
// PUBLIC SYNTHETIC TEST KEY — NEVER USE IN PRODUCTION
const TEST_KEY_V2 =
  "PUBLIC SYNTHETIC TEST KEY — NEVER USE IN PRODUCTION — TAPGO IDENTIFIER V2";

/** Golden digest yang disetujui pada Stage 5.13 (commit 4178fba). */
const GOLDEN = {
  nikV1: "c6166b7cac7e8aa1e14924a0b833b9615dcff53b2b406d6e063d79b2fbc523c5",
  plateV1: "51ee2bd000f74ce137fe5b4eef762dbb950be6d108d094747b0b1ab2cb16a8c6",
  plateSameValueAsNikV1: "3800dfb6289fe78534778ba262e2e7384b5d07c1934c11aeca8efeeb33a78291",
  plateV2: "a6ad7195add4197db8e77b65e3e0ef1ebff91edc026c5bd5ebf0bd09fa23cdc5",
} as const;

function registryV1Only() {
  return new IdentifierKeyRegistry({
    currentVersion: 1,
    keys: [{ version: 1, material: TEST_KEY_V1 }],
  });
}

function registryV1AndV2(currentVersion: 1 | 2) {
  return new IdentifierKeyRegistry({
    currentVersion,
    keys: [
      { version: 1, material: TEST_KEY_V1 },
      { version: 2, material: TEST_KEY_V2 },
    ],
  });
}

function serviceV1(onEvent?: (event: IdentifierEvent) => void) {
  return new IdentifierIndexService(registryV1Only(), onEvent);
}

function expectAppError(fn: () => unknown, code: string, status: number) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  const appError = caught as AppError;
  expect(appError.code).toBe(code);
  expect(appError.statusCode).toBe(status);
  return appError;
}

// ---------------------------------------------------------------------------
// Key registry
// ---------------------------------------------------------------------------

describe("IdentifierKeyRegistry — konfigurasi fail-closed", () => {
  it("menerima konfigurasi satu kunci", () => {
    const registry = registryV1Only();
    expect(registry.currentVersion).toBe(1);
    expect(registry.activeVersions).toEqual([1]);
  });

  it("menerima konfigurasi dua kunci dan mengurutkan versi menaik", () => {
    const registry = new IdentifierKeyRegistry({
      currentVersion: 2,
      keys: [
        { version: 2, material: TEST_KEY_V2 },
        { version: 1, material: TEST_KEY_V1 },
      ],
    });
    expect(registry.activeVersions).toEqual([1, 2]);
    expect(registry.currentVersion).toBe(2);
  });

  it("menolak current version yang tidak ada di daftar kunci aktif", () => {
    expectAppError(
      () =>
        new IdentifierKeyRegistry({
          currentVersion: 2,
          keys: [{ version: 1, material: TEST_KEY_V1 }],
        }),
      "RIDE_IDENTIFIER_KEY_UNAVAILABLE",
      503,
    );
  });

  it("menolak konfigurasi tanpa kunci aktif", () => {
    expectAppError(
      () => new IdentifierKeyRegistry({ currentVersion: 1, keys: [] }),
      "RIDE_IDENTIFIER_KEY_UNAVAILABLE",
      503,
    );
  });

  it("menolak lebih dari dua kunci aktif", () => {
    expectAppError(
      () =>
        new IdentifierKeyRegistry({
          currentVersion: 1,
          keys: [
            { version: 1, material: TEST_KEY_V1 },
            { version: 2, material: TEST_KEY_V2 },
            { version: 3, material: `${TEST_KEY_V1} EXTRA` },
          ],
        }),
      "RIDE_IDENTIFIER_KEY_UNAVAILABLE",
      503,
    );
  });

  it("menolak versi duplikat", () => {
    expectAppError(
      () =>
        new IdentifierKeyRegistry({
          currentVersion: 1,
          keys: [
            { version: 1, material: TEST_KEY_V1 },
            { version: 1, material: TEST_KEY_V2 },
          ],
        }),
      "RIDE_IDENTIFIER_KEY_UNAVAILABLE",
      503,
    );
  });

  it("menolak material kosong maupun blank", () => {
    for (const material of ["", "   "]) {
      expectAppError(
        () => new IdentifierKeyRegistry({ currentVersion: 1, keys: [{ version: 1, material }] }),
        "RIDE_IDENTIFIER_KEY_UNAVAILABLE",
        503,
      );
    }
  });

  it("menolak material yang terlalu pendek", () => {
    expectAppError(
      () =>
        new IdentifierKeyRegistry({ currentVersion: 1, keys: [{ version: 1, material: "pendek" }] }),
      "RIDE_IDENTIFIER_KEY_UNAVAILABLE",
      503,
    );
  });

  it("menolak versi malformed", () => {
    for (const version of [0, -1, 1.5, Number.NaN]) {
      expectAppError(
        () =>
          new IdentifierKeyRegistry({
            currentVersion: 1,
            keys: [{ version, material: TEST_KEY_V1 }],
          }),
        "RIDE_IDENTIFIER_KEY_UNAVAILABLE",
        503,
      );
    }
    expectAppError(
      () =>
        new IdentifierKeyRegistry({
          currentVersion: 0,
          keys: [{ version: 1, material: TEST_KEY_V1 }],
        }),
      "RIDE_IDENTIFIER_KEY_UNAVAILABLE",
      503,
    );
  });

  it("menolak versi kunci yang tidak dikenal saat diminta", () => {
    const registry = registryV1Only();
    expect(registry.has(2)).toBe(false);
    expectAppError(() => registry.materialFor(2), "RIDE_IDENTIFIER_KEY_UNAVAILABLE", 503);
  });

  it("tidak pernah membocorkan material kunci pada pesan error", () => {
    const error = expectAppError(
      () =>
        new IdentifierKeyRegistry({
          currentVersion: 5,
          keys: [{ version: 1, material: TEST_KEY_V1 }],
        }),
      "RIDE_IDENTIFIER_KEY_UNAVAILABLE",
      503,
    );
    const serialized = `${error.message} ${error.stack ?? ""}`;
    expect(serialized).not.toContain(TEST_KEY_V1);
    expect(serialized).not.toContain(TEST_KEY_V2);
    expect(serialized).not.toContain("SYNTHETIC");
  });

  it("createIdentifierKeyRegistryFromEnv fail-closed tanpa current version", () => {
    expectAppError(
      () => createIdentifierKeyRegistryFromEnv({ v1: TEST_KEY_V1 }),
      "RIDE_IDENTIFIER_KEY_UNAVAILABLE",
      503,
    );
  });

  it("createIdentifierKeyRegistryFromEnv fail-closed tanpa material kunci", () => {
    expectAppError(
      () => createIdentifierKeyRegistryFromEnv({ currentVersion: 1 }),
      "RIDE_IDENTIFIER_KEY_UNAVAILABLE",
      503,
    );
  });

  it("createIdentifierKeyRegistryFromEnv membangun registry dua versi", () => {
    const registry = createIdentifierKeyRegistryFromEnv({
      currentVersion: 2,
      v1: TEST_KEY_V1,
      v2: TEST_KEY_V2,
    });
    expect(registry.activeVersions).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Golden vectors
// ---------------------------------------------------------------------------

describe("Golden vectors — literal Stage 5.13", () => {
  it("1. NIK synthetic cocok dengan golden digest", () => {
    const index = serviceV1().createIndex("nik", "0000 0000 0000 0001");
    expect(index.value).toBe(GOLDEN.nikV1);
    expect(index.keyVersion).toBe(1);
    expect(index.canonicalizationVersion).toBe(1);
    expect(index.domain).toBe("nik");
  });

  it("2. PLATE synthetic cocok dengan golden digest", () => {
    const index = serviceV1().createIndex("plate", "z 0001 zz");
    expect(index.value).toBe(GOLDEN.plateV1);
  });

  it("3. nilai canonical sama pada domain berbeda menghasilkan digest berbeda", () => {
    const service = serviceV1();
    const nik = service.createIndex("nik", "0000 0000 0000 0001");
    const plate = service.createIndex("plate", "0000 0000 0000 0001");
    expect(nik.value).toBe(GOLDEN.nikV1);
    expect(plate.value).toBe(GOLDEN.plateSameValueAsNikV1);
    expect(nik.value).not.toBe(plate.value);
  });

  it("4. nilai sama pada key version berbeda menghasilkan digest berbeda", () => {
    const v1 = serviceV1().createIndex("plate", "Z-0001-ZZ");
    const v2 = new IdentifierIndexService(registryV1AndV2(2)).createIndex("plate", "Z-0001-ZZ");
    expect(v1.value).toBe(GOLDEN.plateV1);
    expect(v2.value).toBe(GOLDEN.plateV2);
    expect(v1.value).not.toBe(v2.value);
  });

  it("5. input PLATE yang ekuivalen setelah normalisasi menghasilkan digest sama", () => {
    const service = serviceV1();
    for (const input of ["z 0001 zz", "Z-0001-ZZ", "  Z0001ZZ  ", "z-0001 zz"]) {
      expect(service.createIndex("plate", input).value).toBe(GOLDEN.plateV1);
    }
  });

  it("6. input tidak valid ditolak SEBELUM HMAC", () => {
    expectAppError(
      () => serviceV1().createIndex("plate", "Z-@@"),
      "RIDE_IDENTIFIER_FORMAT_INVALID",
      400,
    );
  });

  it("7. message contract sesuai literal yang disetujui", () => {
    expect(buildMessage("nik", 1, "0000000000000001")).toBe(
      "tapgo.identifier.v1|domain=nik|canonicalizationVersion=1|value=0000000000000001",
    );
    expect(buildMessage("plate", 1, "Z0001ZZ")).toBe(
      "tapgo.identifier.v1|domain=plate|canonicalizationVersion=1|value=Z0001ZZ",
    );
  });
});

// ---------------------------------------------------------------------------
// Canonicalization NIK
// ---------------------------------------------------------------------------

describe("Canonicalization NIK", () => {
  it("menerima 16 digit sintetis dan mempertahankan leading zero", () => {
    const service = serviceV1();
    expect(service.normalize("nik", "0000000000000001")).toBe("0000000000000001");
    expect(service.normalize("nik", "0000 0000 0000 0001")).toBe("0000000000000001");
  });

  it("menolak kurang dari 16 digit", () => {
    expectAppError(
      () => serviceV1().normalize("nik", "000000000000001"),
      "RIDE_IDENTIFIER_FORMAT_INVALID",
      400,
    );
  });

  it("menolak lebih dari 16 digit", () => {
    expectAppError(
      () => serviceV1().normalize("nik", "00000000000000012"),
      "RIDE_IDENTIFIER_FORMAT_INVALID",
      400,
    );
  });

  it("menolak karakter non-digit alih-alih membuangnya diam-diam", () => {
    for (const input of ["000000000000000A", "0000-0000-0000-0001", "0000.0000.0000.0001"]) {
      expectAppError(
        () => serviceV1().normalize("nik", input),
        "RIDE_IDENTIFIER_FORMAT_INVALID",
        400,
      );
    }
  });

  it("menolak input number, bukan mem-parse-nya", () => {
    expectAppError(
      () => serviceV1().normalize("nik", 1 as unknown as string),
      "RIDE_IDENTIFIER_FORMAT_INVALID",
      400,
    );
  });

  it("menolak input kosong", () => {
    for (const input of ["", "    "]) {
      expectAppError(
        () => serviceV1().normalize("nik", input),
        "RIDE_IDENTIFIER_FORMAT_INVALID",
        400,
      );
    }
  });

  it("deterministik pada pemanggilan berulang", () => {
    const service = serviceV1();
    const first = service.createIndex("nik", "0000000000000001").value;
    const second = service.createIndex("nik", "0000 0000 0000 0001").value;
    expect(first).toBe(second);
  });

  it("tidak membocorkan raw input pada pesan error", () => {
    const secretish = "0000000000009999";
    const error = expectAppError(
      () => serviceV1().normalize("nik", `${secretish}X`),
      "RIDE_IDENTIFIER_FORMAT_INVALID",
      400,
    );
    expect(`${error.message} ${error.stack ?? ""}`).not.toContain(secretish);
  });
});

// ---------------------------------------------------------------------------
// Canonicalization PLATE
// ---------------------------------------------------------------------------

describe("Canonicalization PLATE", () => {
  it("mengubah huruf kecil menjadi kapital", () => {
    expect(serviceV1().normalize("plate", "z0001zz")).toBe("Z0001ZZ");
  });

  it("menormalkan whitespace dan tanda hubung", () => {
    const service = serviceV1();
    for (const input of ["Z 0001 ZZ", "Z-0001-ZZ", " Z  0001   ZZ ", "z-0001 zz"]) {
      expect(service.normalize("plate", input)).toBe("Z0001ZZ");
    }
  });

  it("menormalkan bentuk Unicode ekuivalen (NFKC)", () => {
    // Digit fullwidth sintetis harus menjadi digit ASCII yang setara.
    expect(serviceV1().normalize("plate", "Ｚ０００１ＺＺ")).toBe("Z0001ZZ");
  });

  it("menolak grammar tidak valid", () => {
    for (const input of ["Z-@@", "Z_0001_ZZ", "Z/0001/ZZ", "Z*0001"]) {
      expectAppError(
        () => serviceV1().normalize("plate", input),
        "RIDE_IDENTIFIER_FORMAT_INVALID",
        400,
      );
    }
  });

  it("menolak input kosong dan terlalu pendek", () => {
    for (const input of ["", "   ", "-", "A"]) {
      expectAppError(
        () => serviceV1().normalize("plate", input),
        "RIDE_IDENTIFIER_FORMAT_INVALID",
        400,
      );
    }
  });

  it("menolak input yang melebihi batas panjang", () => {
    expectAppError(
      () => serviceV1().normalize("plate", "A".repeat(21)),
      "RIDE_IDENTIFIER_FORMAT_INVALID",
      400,
    );
  });

  it("deterministik pada pemanggilan berulang", () => {
    const service = serviceV1();
    expect(service.createIndex("plate", "z 0001 zz").value).toBe(
      service.createIndex("plate", "Z-0001-ZZ").value,
    );
  });

  it("tidak membocorkan raw input pada pesan error", () => {
    const secretish = "ZZ9999XY";
    const error = expectAppError(
      () => serviceV1().normalize("plate", `${secretish}@`),
      "RIDE_IDENTIFIER_FORMAT_INVALID",
      400,
    );
    expect(`${error.message} ${error.stack ?? ""}`).not.toContain(secretish);
  });
});

// ---------------------------------------------------------------------------
// Domain aktif / non-aktif
// ---------------------------------------------------------------------------

describe("Domain gating", () => {
  it("SIM ditolak karena canonical grammar belum tersedia", () => {
    const service = serviceV1();
    for (const call of [
      () => service.normalize("sim", "TEST-SIM-0001"),
      () => service.createIndex("sim", "TEST-SIM-0001"),
      () => service.createLookupIndexes("sim", "TEST-SIM-0001"),
    ]) {
      expectAppError(call, "IDENTIFIER_CANONICALIZATION_UNAVAILABLE", 409);
    }
  });

  it("STNK ditolak sebagai domain masa depan", () => {
    const service = serviceV1();
    for (const call of [
      () => service.normalize("stnk", "TEST-STNK-0001"),
      () => service.createIndex("stnk", "TEST-STNK-0001"),
    ]) {
      expectAppError(call, "IDENTIFIER_DOMAIN_NOT_ACTIVE", 409);
    }
  });

  it("domain tidak dikenal ditolak", () => {
    expectAppError(
      () => serviceV1().normalize("passport" as IdentifierDomain, "X"),
      "IDENTIFIER_DOMAIN_NOT_ACTIVE",
      409,
    );
  });
});

// ---------------------------------------------------------------------------
// Lookup dan lazy migration
// ---------------------------------------------------------------------------

describe("Lookup dan lazy migration", () => {
  it("satu kunci aktif menghasilkan satu lookup index", () => {
    const indexes = serviceV1().createLookupIndexes("plate", "Z0001ZZ");
    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.value).toBe(GOLDEN.plateV1);
  });

  it("dua kunci aktif menghasilkan dua lookup index, terurut dan tanpa duplikat", () => {
    const indexes = new IdentifierIndexService(registryV1AndV2(2)).createLookupIndexes(
      "plate",
      "Z0001ZZ",
    );
    expect(indexes.map((i) => i.keyVersion)).toEqual([1, 2]);
    expect(indexes.map((i) => i.value)).toEqual([GOLDEN.plateV1, GOLDEN.plateV2]);
    expect(new Set(indexes.map((i) => i.value)).size).toBe(2);
  });

  it("index yang cocok dengan kunci tulis saat ini tidak perlu migrasi", () => {
    const service = serviceV1();
    const plan = service.planLazyMigration("plate", "Z0001ZZ", {
      value: GOLDEN.plateV1,
      keyVersion: 1,
      canonicalizationVersion: 1,
    });
    expect(plan).toEqual({
      matched: true,
      matchedKeyVersion: 1,
      state: "CURRENT",
      needsMigration: false,
    });
  });

  it("index kunci lama menghasilkan rencana migrasi ke kunci tulis saat ini", () => {
    const events: IdentifierEvent[] = [];
    const service = new IdentifierIndexService(registryV1AndV2(2), (e) => events.push(e));
    const plan = service.planLazyMigration("plate", "Z0001ZZ", {
      value: GOLDEN.plateV1,
      keyVersion: 1,
      canonicalizationVersion: 1,
    });

    expect(plan.matched).toBe(true);
    expect(plan.matchedKeyVersion).toBe(1);
    expect(plan.state).toBe("LEGACY_PENDING_REVERIFICATION");
    expect(plan.needsMigration).toBe(true);
    expect(plan.next?.value).toBe(GOLDEN.plateV2);
    expect(plan.next?.keyVersion).toBe(2);

    expect(events).toEqual([
      { event: "identifier.legacy_key_lookup", domain: "plate", keyVersion: 1 },
    ]);
  });

  it("kunci tidak tersedia membuat record tidak dapat dipulihkan", () => {
    const events: IdentifierEvent[] = [];
    const service = serviceV1((e) => events.push(e));
    const plan = service.planLazyMigration("plate", "Z0001ZZ", {
      value: GOLDEN.plateV2,
      keyVersion: 2,
      canonicalizationVersion: 1,
    });

    expect(plan).toEqual({
      matched: false,
      state: "LEGACY_UNRECOVERABLE",
      needsMigration: false,
    });
    expect(events).toEqual([
      { event: "identifier.unknown_key_version", domain: "plate", keyVersion: 2 },
    ]);
  });

  it("identifier yang tidak cocok tidak menghasilkan rencana migrasi", () => {
    const plan = serviceV1().planLazyMigration("plate", "Z0002ZZ", {
      value: GOLDEN.plateV1,
      keyVersion: 1,
      canonicalizationVersion: 1,
    });
    expect(plan.matched).toBe(false);
    expect(plan.needsMigration).toBe(false);
    expect(plan.next).toBeUndefined();
  });

  it("verifyIndex constant-time menerima yang cocok dan menolak yang tidak", () => {
    const service = serviceV1();
    const stored = { value: GOLDEN.plateV1, keyVersion: 1, canonicalizationVersion: 1 };
    expect(service.verifyIndex("plate", "z 0001 zz", stored)).toBe(true);
    expect(service.verifyIndex("plate", "Z0002ZZ", stored)).toBe(false);
    expect(
      service.verifyIndex("plate", "Z0001ZZ", { ...stored, value: "deadbeef" }),
    ).toBe(false);
  });

  it("verifyIndex fail-closed pada key version tak dikenal", () => {
    const events: IdentifierEvent[] = [];
    const service = serviceV1((e) => events.push(e));
    expect(
      service.verifyIndex("plate", "Z0001ZZ", {
        value: GOLDEN.plateV2,
        keyVersion: 2,
        canonicalizationVersion: 1,
      }),
    ).toBe(false);
    expect(events).toEqual([
      { event: "identifier.unknown_key_version", domain: "plate", keyVersion: 2 },
    ]);
  });

  it("event telemetry hanya memuat nama event, domain, dan keyVersion", () => {
    const events: IdentifierEvent[] = [];
    const service = new IdentifierIndexService(registryV1AndV2(2), (e) => events.push(e));
    service.planLazyMigration("nik", "0000000000000001", {
      value: serviceV1().createIndex("nik", "0000000000000001").value,
      keyVersion: 1,
      canonicalizationVersion: 1,
    });

    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]!).sort()).toEqual(["domain", "event", "keyVersion"]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("0000000000000001");
    expect(serialized).not.toContain(GOLDEN.nikV1);
    expect(serialized).not.toContain("SYNTHETIC");
  });
});

// ---------------------------------------------------------------------------
// Keamanan
// ---------------------------------------------------------------------------

describe("Keamanan", () => {
  it("tidak menulis apa pun ke console", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    try {
      const service = new IdentifierIndexService(registryV1AndV2(2));
      service.createIndex("nik", "0000000000000001");
      service.createLookupIndexes("plate", "z 0001 zz");
      service.planLazyMigration("plate", "Z0001ZZ", {
        value: GOLDEN.plateV1,
        keyVersion: 1,
        canonicalizationVersion: 1,
      });
      try {
        service.createIndex("plate", "Z-@@");
      } catch {
        // diabaikan: yang diuji adalah ketiadaan output console
      }
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("objek hasil tidak memuat material kunci maupun nilai mentah", () => {
    const index = serviceV1().createIndex("nik", "0000000000000001");
    const serialized = JSON.stringify(index);
    expect(serialized).not.toContain(TEST_KEY_V1);
    expect(serialized).not.toContain("SYNTHETIC");
    expect(serialized).not.toContain("0000000000000001");
    expect(Object.keys(index).sort()).toEqual([
      "canonicalizationVersion",
      "domain",
      "keyVersion",
      "value",
    ]);
  });

  it("blind index selalu 64 karakter lowercase hex", () => {
    const service = new IdentifierIndexService(registryV1AndV2(2));
    for (const index of [
      service.createIndex("nik", "0000000000000001"),
      ...service.createLookupIndexes("plate", "Z0001ZZ"),
    ]) {
      expect(index.value).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("tidak menyediakan fungsi decrypt atau recover", () => {
    const service = serviceV1();
    const surface = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(service)),
      ...Object.keys(service),
    ];
    for (const name of surface) {
      expect(name).not.toMatch(/decrypt|decode|reverse|recover|toRaw/i);
    }
  });
});
