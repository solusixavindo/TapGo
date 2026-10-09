export function normalizePhoneNumber(phone: string) {
  const compact = phone.trim().replace(/[\s().-]/g, "");

  if (compact.startsWith("+62")) {
    return `0${compact.slice(3)}`;
  }

  if (compact.startsWith("62")) {
    return `0${compact.slice(2)}`;
  }

  return compact;
}

export function phoneLookupVariants(phone: string) {
  const normalized = normalizePhoneNumber(phone);
  const variants = new Set([phone.trim(), normalized]);

  if (normalized.startsWith("0")) {
    variants.add(`62${normalized.slice(1)}`);
    variants.add(`+62${normalized.slice(1)}`);
  }

  return [...variants].filter(Boolean);
}

/**
 * Nomor seluler Indonesia dalam bentuk ternormalisasi (08…): awalan 081–089 dan 10–13
 * digit seluruhnya. Dipakai HANYA saat pendaftaran akun baru; login tetap memakai
 * pola longgar karena akun lama dan akun uji boleh punya nomor di luar pola ini.
 */
const INDONESIAN_MOBILE = /^08[1-9]\d{7,10}$/;
const IDENTICAL_RUN_LIMIT = 8;
const SEQUENCE_RUN_LIMIT = 7;

/** Panjang deretan digit sama berturut-turut, atau naik/turun +1/-1, terpanjang. */
function longestRuns(digits: string) {
  let identical = 1;
  let ascending = 1;
  let descending = 1;
  let bestIdentical = 1;
  let bestAscending = 1;
  let bestDescending = 1;
  for (let index = 1; index < digits.length; index += 1) {
    const step = digits.charCodeAt(index) - digits.charCodeAt(index - 1);
    identical = step === 0 ? identical + 1 : 1;
    ascending = step === 1 ? ascending + 1 : 1;
    descending = step === -1 ? descending + 1 : 1;
    bestIdentical = Math.max(bestIdentical, identical);
    bestAscending = Math.max(bestAscending, ascending);
    bestDescending = Math.max(bestDescending, descending);
  }
  return { bestIdentical, bestAscending, bestDescending };
}

/**
 * Apakah [normalized] (keluaran normalizePhoneNumber) mungkin nomor seluler Indonesia
 * sungguhan. Menolak pola rekaan seperti 081111111111 atau 081234567890. Ini BUKAN
 * bukti nomor itu milik pendaftar — itu butuh OTP ke nomor tersebut.
 */
export function isPlausibleIndonesianMobile(normalized: string): boolean {
  if (!INDONESIAN_MOBILE.test(normalized)) return false;
  const { bestIdentical, bestAscending, bestDescending } = longestRuns(normalized);
  return (
    bestIdentical < IDENTICAL_RUN_LIMIT &&
    bestAscending < SEQUENCE_RUN_LIMIT &&
    bestDescending < SEQUENCE_RUN_LIMIT
  );
}
