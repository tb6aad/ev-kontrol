// Ev durumu (person.*) özeti. GPS konumu uzun süredir gelmiyorsa "Dışarıda" demek yerine
// konumun güncel olmadığını söyler: telefon arka planda konum gönderemiyorsa HA eski "evde değil"
// bilgisinde takılı kalır.
import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import { friendly } from "./devices";
import { relTime } from "./automations";

/** Bu süreden eski GPS konumu güncel sayılmaz */
export const GPS_STALE_MS = 6 * 60 * 60 * 1000;

export interface Presence {
  value: string;
  sub: string;
  muted: boolean;
}

const firstName = (p: HassEntity) => friendly(p).split(" ")[0];
const names = (list: HassEntity[]) => list.map(firstName).join(", ");

/** Kişinin konum kaynağı GPS ise ve son güncelleme eşikten eskiyse, son güncelleme zamanı; değilse null */
export function staleSince(person: HassEntity, entities: HassEntities, now = Date.now()): Date | null {
  const src = person.attributes.source as string | undefined;
  const tracker = src ? entities[src] : undefined;
  if (!tracker || tracker.attributes.source_type !== "gps") return null; // ağ/bluetooth izleyicileri sürekli güncellenmez, eskilik ölçülemez
  const t = new Date(tracker.last_updated);
  return now - t.getTime() > GPS_STALE_MS ? t : null;
}

export function presence(entities: HassEntities, now = Date.now()): Presence {
  const people = Object.values(entities).filter((e) => e.entity_id.startsWith("person."));
  if (!people.length) return { value: "Veri yok", sub: "HA'da kişi (person) tanımlı değil", muted: true };
  const known = people.filter((p) => p.state !== "unknown" && p.state !== "unavailable");
  if (!known.length) return { value: "Bilinmiyor", sub: `${people.length} kişi, konum bilgisi yok`, muted: true };

  const fresh = known.filter((p) => !staleSince(p, entities, now));
  const stale = known.filter((p) => staleSince(p, entities, now));
  const staleNote = stale.length ? ` · ${names(stale)}: konum güncel değil` : "";

  if (!fresh.length) {
    const last = stale.map((p) => staleSince(p, entities, now)!.getTime()).sort((a, b) => b - a)[0];
    return {
      value: "Konum güncel değil",
      sub: `${names(stale)} · son konum ${relTime(new Date(last))}. Telefonda HA konum izni "Her Zaman" olmalı.`,
      muted: true,
    };
  }
  const home = fresh.filter((p) => p.state === "home");
  if (home.length) return { value: "Evde", sub: names(home) + staleNote, muted: false };
  const lastLeft = fresh.map((p) => new Date(p.last_changed)).sort((a, b) => b.getTime() - a.getTime())[0];
  return { value: "Dışarıda", sub: `${names(fresh)} · ${relTime(lastLeft)} ayrıldı${staleNote}`, muted: false };
}
