// Cihaz arama + filtre (saf fonksiyon; arayüzden bağımsız, test edilebilir)
import { ACTION_DOMAINS, DOMAIN_LABELS, DeviceItem, deviceIsOn, domainOf, friendly, isUnavailable } from "./devices";
import { t, tk } from "../i18n";

export type DeviceFilter = "all" | "on" | "off" | "controls" | "unavailable" | "favorites";

export const FILTER_LABELS: Record<DeviceFilter, string> = {
  all: tk("Tümü"),
  on: tk("Açık olanlar"),
  off: tk("Kapalı olanlar"),
  controls: tk("Kontrol edilebilir"),
  unavailable: tk("Erişilemeyenler"),
  favorites: tk("Favoriler"),
};

const norm = (s: string) => s.toLocaleLowerCase("tr").normalize("NFC");

export function matchesQuery(d: DeviceItem, query: string): boolean {
  const q = norm(query.trim());
  if (!q) return true;
  const hay = [
    d.name,
    d.area,
    ...d.entities.map((e) => e.entity_id),
    ...d.entities.map((e) => friendly(e)),
    ...d.entities.map((e) => t(DOMAIN_LABELS[domainOf(e.entity_id)] ?? domainOf(e.entity_id))),
  ];
  // Birden çok kelime → hepsi bir yerde geçmeli ("atölye lamba")
  return q.split(/\s+/).every((w) => hay.some((h) => norm(h).includes(w)));
}

export function matchesFilter(d: DeviceItem, f: DeviceFilter, favorites: string[]): boolean {
  const controllable = ACTION_DOMAINS.has(domainOf(d.primary.entity_id));
  switch (f) {
    case "all":
      return true;
    case "on":
      return deviceIsOn(d);
    case "off":
      return controllable && !isUnavailable(d.primary) && !deviceIsOn(d);
    case "controls":
      return controllable;
    case "unavailable":
      return isUnavailable(d.primary);
    case "favorites":
      return favorites.includes(d.key);
  }
}

export function filterDevices(list: DeviceItem[], query: string, f: DeviceFilter, favorites: string[]) {
  return list.filter((d) => matchesFilter(d, f, favorites) && matchesQuery(d, query));
}

/** Kartları sırala: erişilebilir → kontrol edilebilir → ada göre */
export function sortDevices(list: DeviceItem[]) {
  return [...list].sort((a, b) => {
    const ua = Number(isUnavailable(a.primary));
    const ub = Number(isUnavailable(b.primary));
    if (ua !== ub) return ua - ub;
    const ca = Number(!ACTION_DOMAINS.has(domainOf(a.primary.entity_id)));
    const cb = Number(!ACTION_DOMAINS.has(domainOf(b.primary.entity_id)));
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name, "tr");
  });
}

/** Odalara göre grupla; "Odasız" sona */
export function groupByArea(list: DeviceItem[]) {
  const g = new Map<string, DeviceItem[]>();
  for (const d of list) {
    if (!g.has(d.area)) g.set(d.area, []);
    g.get(d.area)!.push(d);
  }
  return [...g.entries()]
    .map(([area, items]) => [area, sortDevices(items)] as const)
    .sort(([a], [b]) => (a === t("Odasız") ? 1 : b === t("Odasız") ? -1 : a.localeCompare(b, "tr")));
}
