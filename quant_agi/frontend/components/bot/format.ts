export function money(v: number): string {
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function moneyPrecise(v: number): string {
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function pnlClass(v: number): string {
  if (v > 0) return "text-mint";
  if (v < 0) return "text-danger";
  return "text-white/50";
}
