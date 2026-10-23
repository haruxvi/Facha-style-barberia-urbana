/**
 * Normalización de teléfonos a E.164. Por defecto asume Chile (+56) para números locales.
 * Móviles chilenos: 9 dígitos que empiezan por 9 (p. ej. 9 1234 5678).
 */
export function normalizePhone(input: string, defaultCountry = "56"): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (!hasPlus) {
    if (defaultCountry === "56") {
      if (digits.length === 9 && digits.startsWith("9")) digits = `56${digits}`;
      else if (digits.length === 8)
        digits = `569${digits}`; // formato antiguo sin el 9
      else if (!(digits.length === 11 && digits.startsWith("56"))) return null;
    } else if (!digits.startsWith(defaultCountry)) {
      digits = `${defaultCountry}${digits}`;
    }
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  if (digits.startsWith("56") && digits.length !== 11) return null;
  return `+${digits}`;
}

/** WhatsApp Cloud API envía el número sin "+". */
export function waIdToE164(waId: string): string | null {
  return normalizePhone(`+${waId.replace(/\D/g, "")}`);
}

export function e164ToWaId(phone: string): string {
  return phone.replace(/^\+/, "");
}
