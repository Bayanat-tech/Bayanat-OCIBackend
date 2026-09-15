import { createHash } from "crypto";

export type DataRow = Record<string, any>;
export type BillingSettings = {
  non_standard_base: "PER_WAYBILL" | "ONCE_PER_TRUCK_DAY" | null;
  rate_city: "FARTHEST_WELL" | "HIGHEST_NON_STANDARD_RATE" | null;
  non_standard_kms: "PAIR_ONLY" | "DIVERSION_PLUS_PAIR" | null;
  duqm_local_charge: number | null;
  duqm_frequency: "PER_WAYBILL" | "ONCE_PER_TRUCK_DAY" | null;
};
export const emptyBillingSettings: BillingSettings = {
  non_standard_base: null, rate_city: null, non_standard_kms: null,
  duqm_local_charge: null, duqm_frequency: null,
};

export const normalizeKey = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const round3 = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;

export function amount(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d{1,11}(\.\d{1,3})?$/.test(String(value).trim())) {
    throw new Error("Amounts and kilometres must be non-negative numbers with at most 3 decimals and 11 whole digits.");
  }
  return Number(value);
}

// Integer thousandths keep rate multiplication and half-up rounding deterministic.
function multiply(kms: number, rate: number) {
  const product = BigInt(Math.round(kms * 1000)) * BigInt(Math.round(rate * 1000));
  const rounded = (product + 500n) / 1000n;
  if (rounded > 99999999999999n) throw new Error("Calculated revenue exceeds the supported amount. Team review required.");
  return Number(rounded) / 1000;
}

export function validateBillingSettings(body: DataRow): BillingSettings {
  const result = { ...emptyBillingSettings };
  const choices = {
    non_standard_base: ["PER_WAYBILL", "ONCE_PER_TRUCK_DAY"],
    rate_city: ["FARTHEST_WELL", "HIGHEST_NON_STANDARD_RATE"],
    non_standard_kms: ["PAIR_ONLY", "DIVERSION_PLUS_PAIR"],
    duqm_frequency: ["PER_WAYBILL", "ONCE_PER_TRUCK_DAY"],
  };
  for (const key of Object.keys(choices) as Array<keyof typeof choices>) {
    const value = body[key];
    if (value == null || value === "") continue;
    if (!choices[key].includes(value)) throw new Error(`Invalid ${key}.`);
    (result as DataRow)[key] = value;
  }
  if (body.duqm_local_charge != null && body.duqm_local_charge !== "") result.duqm_local_charge = amount(body.duqm_local_charge);
  return result;
}

/** Calendar date, without timezone conversion. Cuetrans dates are day/month/year. */
export function pickupDay(input: unknown): string | null {
  const text = String(input ?? "").trim();
  const match = /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[/-](\d{1,2})[/-](\d{4}))(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(text);
  if (!match) return null;
  const year = Number(match[1] || match[6]);
  const month = Number(match[2] || match[5]);
  const day = Number(match[3] || match[4]);
  if (year < 1900 || year > 9999 || Number(match[7] || 0) > 23 || Number(match[8] || 0) > 59 || Number(match[9] || 0) > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type RevenueRow = {
  waybill_id: number; waybill_load_number: string; destination_name: string;
  scheduled_vehicle: string; pickup_date: string; vendor_name: string; rig_id: string;
  city: string | null; pickup_day: string | null; group_key: string; drop_count: number;
  trip_type: "STANDARD" | "NON_STANDARD" | "UNCLASSIFIED";
  base_revenue: number | null; kms_revenue: number | null; kms_chargeable: number | null;
  local_trip_revenue: number | null; total_revenue: number | null;
  status: "READY" | "NEEDS_REVIEW" | "VERIFIED" | "MANUAL_VERIFIED";
  issues: string[]; calculation: string[]; source_hash: string;
  reviewed_by?: string; reviewed_at?: string; review_note?: string;
};

export function calculateRevenue(waybills: DataRow[], wells: DataRow[], rates: DataRow[], distances: DataRow[], settings: BillingSettings): RevenueRow[] {
  const wellMap = new Map(wells.map((row) => [normalizeKey(row.well_id), row]));
  const rateMap = new Map(rates.map((row) => [normalizeKey(row.city), row]));
  const groups = new Map<string, DataRow[]>();
  for (const row of [...waybills].sort((a, b) => Number(a.id) - Number(b.id))) {
    const day = pickupDay(row.pickup_date);
    const truck = normalizeKey(row.scheduled_vehicle);
    const key = day && truck ? JSON.stringify([day, truck]) : `invalid:${row.id}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const output: RevenueRow[] = [];
  for (const [key, group] of groups) {
    const drops = [...new Set(group.map((row) => normalizeKey(row.destination_name)))];
    const matchedWells = drops.map((drop) => wellMap.get(drop));
    const matchedRates = matchedWells.map((well) => well && rateMap.get(normalizeKey(well.city)));
    const pairs = drops.length === 2 ? distances.filter((row) =>
      (normalizeKey(row.well_id_1) === drops[0] && normalizeKey(row.well_id_2) === drops[1]) ||
      (normalizeKey(row.well_id_1) === drops[1] && normalizeKey(row.well_id_2) === drops[0])) : [];
    const sourceHash = digest({ version: 1, group, matchedWells, matchedRates, pairs, settings });
    const issues: string[] = [];
    if (key.startsWith("invalid:")) issues.push("Invalid pickup date or missing truck. Use DD/MM/YYYY or YYYY-MM-DD with optional time.");
    if (drops.length > 2) issues.push("More than two drop points: team review required.");
    if (new Set(group.map((row) => normalizeKey(row.vendor_name))).size > 1) issues.push("Multiple vendors share this truck and pickup date: confirm trip allocation.");
    drops.forEach((drop, i) => {
      if (!matchedWells[i]) issues.push(`Destination not found in Well IDs (Destination Lookup): ${drop || "(blank)"}.`);
      else if (!matchedRates[i]) issues.push(`Missing city rate: ${matchedWells[i]!.city}.`);
    });
    const identities = group.map((row) => JSON.stringify([normalizeKey(row.waybill_load_number), normalizeKey(row.destination_name)]));
    if (new Set(identities).size !== identities.length) issues.push("Possible duplicate waybill/load and destination: team review required before billing.");
    const nonStandard = drops.length > 1;
    if (nonStandard && (!settings.non_standard_base || !settings.rate_city || !settings.non_standard_kms)) issues.push("Choose the two-drop billing rules in Billing settings.");
    if (drops.length === 2) {
      if (!pairs.length) issues.push("Missing distance between these two well IDs.");
      else if (new Set(pairs.map((pair) => Number(pair.distance))).size > 1) issues.push("Forward and reverse well distances differ: team review required.");
    }
    const duqm = group.filter((row) => normalizeKey(row.vendor_name) === "DUQM SALT");
    if (duqm.length && (settings.duqm_local_charge == null || !settings.duqm_frequency)) issues.push("Set the Duqm Salt additional local-trip charge and frequency in Billing settings.");

    let lead = group[0];
    if (nonStandard && matchedWells.every(Boolean) && matchedRates.every(Boolean)) {
      lead = [...group].sort((a, b) => {
        const aw = wellMap.get(normalizeKey(a.destination_name))!;
        const bw = wellMap.get(normalizeKey(b.destination_name))!;
        const av = settings.rate_city === "HIGHEST_NON_STANDARD_RATE" ? rateMap.get(normalizeKey(aw.city))!.non_standard_revenue : aw.actual_kms;
        const bv = settings.rate_city === "HIGHEST_NON_STANDARD_RATE" ? rateMap.get(normalizeKey(bw.city))!.non_standard_revenue : bw.actual_kms;
        return Number(bv) - Number(av) || Number(a.id) - Number(b.id);
      })[0];
    }
    const groupResults: RevenueRow[] = group.map((raw) => {
      const well = wellMap.get(normalizeKey(raw.destination_name));
      const row: RevenueRow = {
        waybill_id: Number(raw.id), waybill_load_number: String(raw.waybill_load_number),
        destination_name: String(raw.destination_name), scheduled_vehicle: String(raw.scheduled_vehicle),
        pickup_date: String(raw.pickup_date), vendor_name: String(raw.vendor_name), rig_id: String(raw.rig_id),
        city: well?.city || null, pickup_day: pickupDay(raw.pickup_date), group_key: digest(key), drop_count: drops.length,
        trip_type: key.startsWith("invalid:") ? "UNCLASSIFIED" : nonStandard ? "NON_STANDARD" : "STANDARD",
        base_revenue: null, kms_revenue: null, kms_chargeable: null, local_trip_revenue: null, total_revenue: null,
        status: issues.length ? "NEEDS_REVIEW" : "READY", issues: [...issues], calculation: [], source_hash: sourceHash,
      };
      if (issues.length) return row;
      try {
        const rate = rateMap.get(normalizeKey(well!.city))!;
        const actual = amount(well!.actual_kms);
        const baseKms = amount(rate.base_kms);
        if (!nonStandard) {
          row.base_revenue = amount(rate.standard_revenue);
          row.kms_chargeable = round3(Math.max(0, actual - baseKms - 15));
          row.kms_revenue = multiply(row.kms_chargeable, amount(rate.standard_kms_charge));
          row.calculation.push(`Standard: ${well!.city}; base revenue ${row.base_revenue}; Kms = max(0, ${actual} - ${baseKms} - 15); rate/Km ${rate.standard_kms_charge}.`);
        } else {
          const isLead = raw.id === lead.id;
          row.base_revenue = settings.non_standard_base === "PER_WAYBILL" || isLead ? amount(rate.non_standard_revenue) : 0;
          const distance = amount(pairs[0].distance);
          const pairKms = Math.max(0, distance - 15);
          const diversion = settings.non_standard_kms === "DIVERSION_PLUS_PAIR" ? Math.max(0, actual - baseKms - 15) : 0;
          row.kms_chargeable = isLead ? round3(pairKms + diversion) : 0;
          row.kms_revenue = multiply(row.kms_chargeable, amount(rate.non_standard_kms_charge));
          row.calculation.push(`Two-drop base rule: ${settings.non_standard_base}; selected rate city rule: ${settings.rate_city}; shared Kms charged once on waybill ID ${lead.id}.`);
          row.calculation.push(isLead ? `Kms = max(0, ${distance} - 15)${settings.non_standard_kms === "DIVERSION_PLUS_PAIR" ? ` + max(0, ${actual} - ${baseKms} - 15)` : ""}; rate/Km ${rate.non_standard_kms_charge}.` : "Shared Kms are allocated to the selected waybill; this row carries zero shared Kms.");
        }
        row.local_trip_revenue = normalizeKey(raw.vendor_name) === "DUQM SALT" && (settings.duqm_frequency === "PER_WAYBILL" || raw.id === duqm[0]?.id) ? settings.duqm_local_charge! : 0;
        if (row.local_trip_revenue) row.calculation.push(`Duqm Salt additional local trip: ${row.local_trip_revenue} (${settings.duqm_frequency}).`);
        row.total_revenue = amount(round3(row.base_revenue + row.kms_revenue + row.local_trip_revenue));
      } catch (error) {
        row.issues.push((error as Error).message);
      }
      return row;
    });
    // A failure in a shared calculation blocks the entire truck/day, avoiding partial billing.
    const allIssues = [...new Set(groupResults.flatMap((row) => row.issues))];
    if (allIssues.length) groupResults.forEach((row) => {
      row.status = "NEEDS_REVIEW"; row.issues = allIssues;
      row.base_revenue = row.kms_revenue = row.kms_chargeable = row.local_trip_revenue = row.total_revenue = null;
    });
    output.push(...groupResults);
  }
  return output;
}
