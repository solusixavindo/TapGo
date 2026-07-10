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
