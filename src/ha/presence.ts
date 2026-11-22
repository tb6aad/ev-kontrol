// Ev durumu (person.*) özeti. GPS konumu uzun süredir gelmiyorsa "Dışarıda" demek yerine
// konumun güncel olmadığını söyler: telefon arka planda konum gönderemiyorsa HA eski "evde değil"
// bilgisinde takılı kalır.
import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import { friendly } from "./devices";
import { relTime } from "./automations";
import { t } from "../i18n";

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
  if (!people.length) return { value: t("Veri yok"), sub: t("HA'da kişi (person) tanımlı değil"), muted: true };
  const known = people.filter((p) => p.state !== "unknown" && p.state !== "unavailable");
  if (!known.length) return { value: t("Bilinmiyor"), sub: t("{n} kişi, konum bilgisi yok", { n: people.length }), muted: true };

  const fresh = known.filter((p) => !staleSince(p, entities, now));
  const stale = known.filter((p) => staleSince(p, entities, now));
  const staleNote = stale.length ? " · " + t("{names}: konum güncel değil", { names: names(stale) }) : "";

  if (!fresh.length) {
    const last = stale.map((p) => staleSince(p, entities, now)!.getTime()).sort((a, b) => b - a)[0];
    return {
      value: t("Konum güncel değil"),
      sub: t("{names} · son konum {when}. Telefonda HA konum izni \"Her Zaman\" olmalı.", { names: names(stale), when: relTime(new Date(last)) }),
      muted: true,
    };
  }
  const home = fresh.filter((p) => p.state === "home");
  if (home.length) return { value: t("Evde"), sub: names(home) + staleNote, muted: false };
  const lastLeft = fresh.map((p) => new Date(p.last_changed)).sort((a, b) => b.getTime() - a.getTime())[0];
  return { value: t("Dışarıda"), sub: t("{names} · {when} ayrıldı", { names: names(fresh), when: relTime(lastLeft) }) + staleNote, muted: false };
}
