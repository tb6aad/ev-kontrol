import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import type { Registries } from "./client";
import { locale, t, tk } from "../i18n";

/** Panelde hiç gösterilmeyecek domainler (sistem kalabalığı). */
const HIDDEN_DOMAINS = new Set([
  "update", "zone", "person", "sun", "tts", "stt", "conversation", "event", "wake_word",
  "assist_satellite", "todo", "image", "device_tracker", "weather", "calendar", "notify",
]);

/** Bir cihazın "ana" varlığını seçerken öncelik sırası. */
const PRIMARY_ORDER = [
  "climate", "light", "switch", "fan", "cover", "lock", "media_player", "vacuum",
  "siren", "input_boolean", "camera", "alarm_control_panel", "binary_sensor", "sensor",
];

export const ACTION_DOMAINS = new Set([
  "light", "switch", "fan", "input_boolean", "automation", "cover", "media_player",
  "lock", "button", "input_button", "script", "scene", "siren", "climate", "vacuum",
]);

export interface DeviceItem {
  key: string;
  name: string;
  area: string;
  /** HA alan kimliği (odasızsa null) */
  areaId: string | null;
  /** Kart bir HA cihazıysa onun kimliği; tek varlıksa yok */
  deviceId?: string;
  entities: HassEntity[];
  primary: HassEntity;
  power?: HassEntity;
}

export const domainOf = (id: string) => id.split(".")[0];

export function friendly(e: HassEntity) {
  return (e.attributes.friendly_name as string) || e.entity_id;
}

/** "3D Yazıcı 1 Enerji" → "Enerji" (cihaz adı önekini at) */
export function shortName(e: HassEntity, deviceName: string) {
  const n = friendly(e);
  if (n === deviceName) return n;
  if (n.toLocaleLowerCase("tr").startsWith(deviceName.toLocaleLowerCase("tr") + " ")) {
    return n.slice(deviceName.length + 1);
  }
  return n;
}

export function isUnavailable(e: HassEntity) {
  return e.state === "unavailable";
}

export function isOn(e: HassEntity) {
  return ["on", "open", "unlocked", "playing", "home", "heat", "cool", "auto", "dry", "fan_only", "heat_cool", "cleaning"].includes(e.state);
}

export function buildDevices(entities: HassEntities, reg: Registries): DeviceItem[] {
  const areaName = new Map(reg.areas.map((a) => [a.area_id, a.name]));
  const devices = new Map(reg.devices.map((d) => [d.id, d]));
  const entReg = new Map(reg.entities.map((e) => [e.entity_id, e]));

  const groups = new Map<string, { name: string; areaId: string | null; list: HassEntity[] }>();

  for (const e of Object.values(entities)) {
    if (HIDDEN_DOMAINS.has(domainOf(e.entity_id))) continue;
    const r = entReg.get(e.entity_id);
    if (r && (r.hidden_by || r.disabled_by || r.entity_category)) continue;

    const dev = r?.device_id ? devices.get(r.device_id) : undefined;
    const key = dev ? dev.id : e.entity_id;
    if (!groups.has(key)) {
      groups.set(key, {
        name: dev ? dev.name_by_user || dev.name || friendly(e) : friendly(e),
        areaId: r?.area_id ?? dev?.area_id ?? null,
        list: [],
      });
    }
    const g = groups.get(key)!;
    g.list.push(e);
    // Varlığın kendi alanı varsa cihazın alanını ezer (ilk bulunan yeter)
    if (!g.areaId && r?.area_id) g.areaId = r.area_id;
  }

  const out: DeviceItem[] = [];
  for (const [key, g] of groups) {
    const rank = (e: HassEntity) => {
      const i = PRIMARY_ORDER.indexOf(domainOf(e.entity_id));
      const base = i === -1 ? 99 : i;
      // Cihazla aynı ada sahip varlık öne geçsin
      return base * 2 + (friendly(e) === g.name ? 0 : 1);
    };
    const sorted = [...g.list].sort((a, b) => rank(a) - rank(b));
    const power = g.list.find((e) => e.attributes.device_class === "power" && domainOf(e.entity_id) === "sensor");
    out.push({
      key,
      name: g.name,
      area: (g.areaId && areaName.get(g.areaId)) || t("Odasız"),
      areaId: g.areaId && areaName.has(g.areaId) ? g.areaId : null,
      deviceId: devices.has(key) ? key : undefined,
      entities: sorted,
      primary: sorted[0],
      power: power !== sorted[0] ? power : undefined,
    });
  }
  return out;
}

const STATE_TR: Record<string, string> = {
  on: tk("Açık"), off: tk("Kapalı"), locked: tk("Kilitli"), unlocked: tk("Kilit açık"), open: tk("Açık"), closed: tk("Kapalı"),
  opening: tk("Açılıyor"), closing: tk("Kapanıyor"), unavailable: tk("Erişilemiyor"), unknown: tk("Bilinmiyor"),
  playing: tk("Çalıyor"), paused: tk("Duraklatıldı"), idle: tk("Boşta"), standby: tk("Beklemede"), home: tk("Evde"),
  not_home: tk("Dışarıda"), heat: tk("Isıtma"), cool: tk("Soğutma"), auto: tk("Otomatik"), dry: tk("Nem alma"),
  fan_only: tk("Fan"), heat_cool: tk("Isıt/Soğut"), cleaning: tk("Temizliyor"), docked: tk("İstasyonda"), returning: tk("Dönüyor"),
};

export function formatState(e: HassEntity) {
  if (STATE_TR[e.state]) return t(STATE_TR[e.state]);
  const unit = e.attributes.unit_of_measurement as string | undefined;
  const n = Number(e.state);
  if (e.state !== "" && !Number.isNaN(n)) {
    const s = n.toLocaleString(locale(), { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1 });
    return unit ? `${s} ${unit}` : s;
  }
  // Zaman damgaları
  if (e.attributes.device_class === "timestamp") {
    const d = new Date(e.state);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
  }
  return unit ? `${e.state} ${unit}` : e.state;
}

export const DOMAIN_LABELS: Record<string, string> = {
  light: tk("Işık"), switch: tk("Anahtar"), sensor: tk("Sensör"), binary_sensor: tk("Sensör"), lock: tk("Kilit"),
  cover: tk("Perde/Kapı"), fan: tk("Fan"), climate: tk("Klima"), media_player: tk("Medya"), automation: tk("Otomasyon"),
  script: tk("Script"), scene: tk("Sahne"), button: tk("Buton"), input_boolean: tk("Yardımcı"), camera: tk("Kamera"),
  vacuum: tk("Süpürge"), siren: tk("Siren"), remote: tk("Kumanda"), number: tk("Ayar"), select: tk("Seçim"),
};

/** Ui/Icon setindeki ikon adı. */
export function iconName(e: HassEntity): string {
  const d = domainOf(e.entity_id);
  const dc = e.attributes.device_class as string | undefined;
  const name = friendly(e).toLocaleLowerCase("tr");
  if (name.includes("yazıcı")) return "printer";
  if (d === "light") return "bulb";
  if (d === "climate") return "thermo";
  if (d === "lock") return e.state === "unlocked" ? "unlock" : "lock";
  if (d === "cover") return name.includes("kapı") || dc === "garage" || dc === "door" ? "door" : "blinds";
  if (d === "media_player" || d === "remote") return "speaker";
  if (d === "fan") return "fan";
  if (d === "vacuum") return "vacuum";
  if (d === "siren") return "siren";
  if (d === "camera") return "camera";
  if (d === "scene") return "scene";
  if (d === "script" || d === "automation") return "automation";
  if (d === "binary_sensor") return dc === "motion" || dc === "occupancy" ? "motion" : dc === "door" || dc === "window" ? "door" : "sensor";
  if (d === "sensor") return dc === "temperature" ? "thermo" : dc === "humidity" ? "humidity" : dc === "power" || dc === "energy" ? "energy" : dc === "battery" ? "battery" : "chart";
  if (d === "switch") return name.includes("led") || name.includes("lamba") || name.includes("ışık") ? "bulb" : "plug";
  if (d === "button" || d === "input_button") return "button";
  return "power";
}

/** Kartın alt satırı: güç, sıcaklık, nem, parlaklık, pil gibi destekleniyorsa gösterilecek ek bilgiler. */
export function extraInfo(d: DeviceItem): string[] {
  const out: string[] = [];
  const p = d.primary;
  if (isUnavailable(p)) return out;
  if (domainOf(p.entity_id) === "light" && p.state === "on" && typeof p.attributes.brightness === "number") {
    out.push(t("%{n} parlaklık", { n: Math.round(((p.attributes.brightness as number) / 255) * 100) }));
  }
  if (d.power && !isUnavailable(d.power)) out.push(formatState(d.power));
  const byClass = (dc: string) =>
    d.entities.find((e) => e !== p && e.entity_id.startsWith("sensor.") && e.attributes.device_class === dc && !isUnavailable(e));
  for (const dc of ["temperature", "humidity"]) {
    const s = byClass(dc);
    if (s) out.push(formatState(s));
  }
  const batt = byClass("battery");
  if (batt) out.push(t("Pil {v}", { v: formatState(batt) }));
  return out.slice(0, 2);
}

export const PRESS_DOMAINS = new Set(["button", "input_button", "script", "scene"]);

/** Birincil varlık bir anahtarla açılıp kapatılabiliyor mu? */
export function isSwitchable(e: HassEntity) {
  const d = domainOf(e.entity_id);
  return ACTION_DOMAINS.has(d) && !PRESS_DOMAINS.has(d) && !isUnavailable(e);
}

/** "Aktif cihaz" sayımında yer alan cihazlar: açılıp kapanabilen gerçek cihazlar (otomasyon/sahne/script hariç) */
const NOT_A_DEVICE = new Set(["scene", "script", "button", "input_button", "automation", "input_boolean"]);
export function activeStats(devices: DeviceItem[]) {
  const controllable = devices.filter((d) => {
    const dom = domainOf(d.primary.entity_id);
    return ACTION_DOMAINS.has(dom) && !NOT_A_DEVICE.has(dom);
  });
  return { on: controllable.filter(deviceIsOn).length, total: controllable.length };
}

/** Kart açık sayılır mı (yalnızca kontrol edilebilir cihazlar için anlamlı) */
export function deviceIsOn(d: DeviceItem) {
  return ACTION_DOMAINS.has(domainOf(d.primary.entity_id)) && isOn(d.primary);
}

/** Kart üstündeki küçük ikon (emoji, harici kütüphane gerektirmez). */
export function iconFor(e: HassEntity): string {
  const d = domainOf(e.entity_id);
  const dc = e.attributes.device_class as string | undefined;
  const name = friendly(e).toLocaleLowerCase("tr");
  if (name.includes("yazıcı")) return "🖨️";
  if (d === "light") return "💡";
  if (d === "climate" || name.includes("klima")) return "❄️";
  if (d === "lock") return "🔒";
  if (d === "cover") return name.includes("kapı") || dc === "garage" ? "🚪" : "🪟";
  if (d === "media_player") return "🔊";
  if (d === "fan") return "🌀";
  if (d === "vacuum") return "🧹";
  if (d === "siren") return "🚨";
  if (d === "camera") return "📷";
  if (d === "binary_sensor") return dc === "motion" || dc === "occupancy" ? "🏃" : dc === "door" || dc === "window" ? "🚪" : "◉";
  if (d === "sensor") return dc === "temperature" ? "🌡️" : dc === "humidity" ? "💧" : dc === "power" || dc === "energy" ? "⚡" : "📈";
  if (d === "switch") return name.includes("led") ? "💡" : "🔌";
  return "⚙️";
}
