// Date-only billing boundaries use UTC; never calculate calendar months as 30 days.
export function billingToday() { return new Date().toISOString().slice(0, 10); }
export function validDate(value: any): string {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error("Enter a valid date (YYYY-MM-DD)");
  return date;
}
export function addDays(date: string, days: number) { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10); }
export function periodStart(anchor: string, cycle: string, index: number, customDays?: number) {
  if (cycle === "CUSTOM") return addDays(anchor, index * Number(customDays));
  const months = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 }[cycle];
  if (!months || !Number.isSafeInteger(index) || index < 0) throw new Error("Invalid billing period");
  const original = new Date(anchor + "T00:00:00Z");
  const result = new Date(Date.UTC(original.getUTCFullYear(), original.getUTCMonth() + months * index, 1));
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(original.getUTCDate(), last));
  return result.toISOString().slice(0,10);
}
