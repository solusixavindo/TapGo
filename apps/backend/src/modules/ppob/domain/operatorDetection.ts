/**
 * Deteksi operator seluler dari prefiks nomor (bentuk kanonik "08xxxxxxxxxx").
 *
 * Dasarnya alokasi prefiks resmi operator di Indonesia. Nomor yang sudah
 * pindah operator (MNP) tidak dapat dikenali dari prefiks; provider akan
 * menolaknya dan transaksi di-refund penuh — aman, hanya kurang mulus.
 * Prefiks 0851 (Telkomsel/by.U) diperlakukan sebagai Telkomsel.
 */
export type MobileOperator = "telkomsel" | "indosat" | "xl" | "axis" | "tri" | "smartfren";

const PREFIXES: Record<MobileOperator, readonly string[]> = {
  telkomsel: ["0811", "0812", "0813", "0821", "0822", "0823", "0851", "0852", "0853"],
  indosat: ["0814", "0815", "0816", "0855", "0856", "0857", "0858"],
  xl: ["0817", "0818", "0819", "0859", "0877", "0878"],
  axis: ["0831", "0832", "0833", "0838"],
  tri: ["0895", "0896", "0897", "0898", "0899"],
  smartfren: ["0881", "0882", "0883", "0884", "0885", "0886", "0887", "0888", "0889"]
};

export const OPERATOR_LABEL: Record<MobileOperator, string> = {
  telkomsel: "Telkomsel",
  indosat: "Indosat",
  xl: "XL",
  axis: "Axis",
  tri: "Tri",
  smartfren: "Smartfren"
};

const BY_PREFIX = new Map<string, MobileOperator>(
  (Object.entries(PREFIXES) as Array<[MobileOperator, readonly string[]]>).flatMap(([operator, list]) =>
    list.map((prefix) => [prefix, operator] as [string, MobileOperator])
  )
);

export function detectMobileOperator(msisdn: string): MobileOperator | null {
  return BY_PREFIX.get(msisdn.slice(0, 4)) ?? null;
}
