export function ageingReportLabels(parameters: Record<string, unknown>): string[] {
  const defaults = [30, 60, 90, 120, 180, 365];
  const limits = defaults.map((fallback, index) => {
    const value = parameters[`code${index + 9}`];
    return value == null || value === '' ? fallback : Number(value);
  });
  if (limits.some((value, index) => !Number.isInteger(value) || value <= (limits[index - 1] || 0))) {
    throw new Error('Ageing day limits must be positive, increasing whole numbers.');
  }
  return [`Up to ${limits[0]}`, ...limits.slice(1).map((value, index) => `${limits[index] + 1} - ${value}`), `Above ${limits[5]}`];
}
