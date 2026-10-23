/**
 * Importes en enteros en la unidad menor de cada moneda.
 * CLP no tiene decimales: 15000 = $15.000. Otras monedas usan 2 decimales (centavos).
 */
const ZERO_DECIMAL = new Set(["CLP", "PYG", "JPY", "KRW"]);

export function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/** Convierte unidad menor → importe decimal que esperan las APIs (Mercado Pago usa decimales). */
export function toMajorUnits(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyDecimals(currency);
}

/** Convierte un importe decimal de una API → unidad menor (entero). */
export function toMinorUnits(amountMajor: number, currency: string): number {
  return Math.round(amountMajor * 10 ** currencyDecimals(currency));
}

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency,
    minimumFractionDigits: currencyDecimals(currency),
    maximumFractionDigits: currencyDecimals(currency),
  }).format(toMajorUnits(amountMinor, currency));
}
