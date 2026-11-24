export const publicModuleKey = (value: unknown) => String(value || '').trim().toUpperCase();
export const reservedPublicModule = (value: unknown) => ['SECURITY', 'SUPPORT', 'BTSUPPORT', 'BTSECURITY'].includes(publicModuleKey(value).replace(/[^A-Z]/g, ''));
export function registrationQuote(selected: unknown, offers: any[]) {
  if (!Array.isArray(selected) || !selected.length || selected.length > 30) throw new Error('Choose at least one module');
  const modules = [...new Set(selected.map(publicModuleKey))];
  const items = modules.map(code => {
    const offer = offers.find(o => publicModuleKey(o.code) === code && o.enabled === true);
    if (!offer || reservedPublicModule(code) || !Number.isFinite(offer.price) || offer.price <= 0) throw new Error('A selected module is no longer available. Refresh the module list.');
    return { code, label: String(offer.label || code), price: offer.price };
  });
  return { items, modules, amount: items.reduce((sum, item) => sum + Math.round(item.price * 100), 0) / 100 };
}
export function validRegistrationPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 20;
}
