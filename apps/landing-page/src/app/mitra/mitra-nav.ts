export type ViewId = "overview" | "wallet" | "withdraw" | "network" | "commission" | "account";

export const NAV_ITEMS: ReadonlyArray<{
  id: ViewId;
  label: string;
  short: string;
  icon: "home" | "wallet" | "bank" | "users" | "coins" | "user";
}> = [
  { id: "overview", label: "Ringkasan", short: "Ringkasan", icon: "home" },
  { id: "wallet", label: "Dompet", short: "Dompet", icon: "wallet" },
  { id: "withdraw", label: "Tarik Dana", short: "Tarik", icon: "bank" },
  { id: "network", label: "Referral", short: "Referral", icon: "users" },
  { id: "commission", label: "Komisi", short: "Komisi", icon: "coins" },
  { id: "account", label: "Akun", short: "Akun", icon: "user" }
];

export function isViewId(value: string): value is ViewId {
  return NAV_ITEMS.some((item) => item.id === value);
}
