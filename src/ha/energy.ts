import type { Connection, HassEntities, HassEntity } from "home-assistant-js-websocket";
import { locale, tk } from "../i18n";

export interface PowerItem {
  entity: HassEntity;
  watts: number;
}

/** Anlık güç: tüm W/kW sensörlerinin toplamı (erişilemeyenler hariç). */
export function livePower(entities: HassEntities): { total: number; items: PowerItem[] } {
  const items: PowerItem[] = [];
  for (const e of Object.values(entities)) {
    if (!e.entity_id.startsWith("sensor.") || e.attributes.device_class !== "power") continue;
    const v = Number(e.state);
    if (Number.isNaN(v)) continue;
    const unit = e.attributes.unit_of_measurement;
    const w = unit === "kW" ? v * 1000 : v;
    items.push({ entity: e, watts: w });
  }
  items.sort((a, b) => b.watts - a.watts);
  return { total: items.reduce((s, i) => s + i.watts, 0), items };
}

interface EnergyPrefs {
  energy_sources: { type: string; flow_from?: { stat_energy_from: string }[] }[];
  device_consumption: { stat_consumption: string }[];
}

export interface MonthItem {
  statId: string;
  kwh: number;
}

export interface MonthlyEnergy {
  total: number;
  /** true → toplam şebeke sayacından geldi; false → cihazların toplamı */
  fromGrid: boolean;
  items: MonthItem[];
}

/** Hangi enerji sensörleri sayılacak: önce HA Enerji panosu ayarı, yoksa tahmin. */
export async function energyStatIds(conn: Connection, entities: HassEntities) {
  let grid: string[] = [];
  let devices: string[] = [];
  try {
    const prefs = await conn.sendMessagePromise<EnergyPrefs>({ type: "energy/get_prefs" });
    grid = prefs.energy_sources
      .filter((s) => s.type === "grid")
      .flatMap((s) => (s.flow_from ?? []).map((f) => f.stat_energy_from));
    devices = prefs.device_consumption.map((d) => d.stat_consumption);
  } catch {
    // Enerji panosu hiç ayarlanmamış olabilir
  }
  if (devices.length === 0) {
    // Günlük sıfırlanan sensörler aylık sensörle aynı tüketimi iki kez saydırır → at
    devices = Object.values(entities)
      .filter(
        (e) =>
          e.entity_id.startsWith("sensor.") &&
          e.attributes.device_class === "energy" &&
          e.attributes.state_class === "total_increasing" &&
          !/today|daily|bugun|gunluk/i.test(e.entity_id),
      )
      .map((e) => e.entity_id);
  }
  return { grid, devices };
}

/** Bu ayki değişim; istatistik yoksa null. Bağlantı hatası yukarı fırlatılır (sahte 0 üretilmez). */
async function monthChange(conn: Connection, statId: string): Promise<number | null> {
  const r = await conn.sendMessagePromise<{ change?: number | null }>({
    type: "recorder/statistic_during_period",
    statistic_id: statId,
    calendar: { period: "month" },
    types: ["change"],
  });
  return typeof r.change === "number" ? r.change : null;
}

export async function monthlyEnergy(conn: Connection, entities: HassEntities): Promise<MonthlyEnergy> {
  const { grid, devices } = await energyStatIds(conn, entities);
  const raw = await Promise.all(devices.map(async (statId) => ({ statId, kwh: await monthChange(conn, statId) })));
  // Verisi olmayan sensörler listeden çıkar; hiçbiri yoksa items boş kalır (arayüz "Veri yok" der)
  const items = raw.filter((i): i is MonthItem => i.kwh != null).sort((a, b) => b.kwh - a.kwh);
  if (grid.length) {
    const g = (await Promise.all(grid.map((id) => monthChange(conn, id)))).filter((v): v is number => v != null);
    if (g.length) return { total: g.reduce((s, v) => s + v, 0), fromGrid: true, items };
  }
  return { total: items.reduce((s, i) => s + i.kwh, 0), fromGrid: false, items };
}

/* ---------- Günlük toplam ve grafik serileri ---------- */

type Calendar = { period: "day" | "week" | "month"; offset?: number };

/** Bir takvim dönemindeki toplam tüketim (kWh). Hiç veri yoksa null — sahte 0 üretmez. */
export async function periodTotal(conn: Connection, statIds: string[], calendar: Calendar): Promise<number | null> {
  if (!statIds.length) return null;
  const vals = await Promise.all(
    statIds.map((id) =>
      conn
        .sendMessagePromise<{ change?: number | null }>({
          type: "recorder/statistic_during_period",
          statistic_id: id,
          calendar,
          types: ["change"],
        })
        .then((r) => (typeof r.change === "number" ? r.change : null))
        .catch(() => null),
    ),
  );
  const got = vals.filter((v): v is number => v != null);
  return got.length ? got.reduce((s, v) => s + v, 0) : null;
}

/** Bugün ve dün (aynı saate kadar değil, dünün tamamı) */
export async function dailyEnergy(conn: Connection, entities: HassEntities) {
  const { grid, devices } = await energyStatIds(conn, entities);
  const ids = grid.length ? grid : devices;
  const [today, yesterday] = await Promise.all([
    periodTotal(conn, ids, { period: "day" }),
    periodTotal(conn, ids, { period: "day", offset: -1 }),
  ]);
  return { today, yesterday };
}

export type RangeKey = "1h" | "24h" | "7d" | "30d";

export const RANGES: Record<RangeKey, { label: string; ms: number; period: "5minute" | "hour" | "day"; bucketMs: number }> = {
  "1h": { label: tk("Son 1 saat"), ms: 3600_000, period: "5minute", bucketMs: 5 * 60_000 },
  "24h": { label: tk("Son 24 saat"), ms: 24 * 3600_000, period: "hour", bucketMs: 3600_000 },
  "7d": { label: tk("Son 7 gün"), ms: 7 * 86400_000, period: "day", bucketMs: 86400_000 },
  "30d": { label: tk("Son 30 gün"), ms: 30 * 86400_000, period: "day", bucketMs: 86400_000 },
};

export interface Bucket {
  start: number;
  /** null = o dilimde hiç veri yok (grafikte boşluk; 0 olarak gösterilmez) */
  kwh: number | null;
  perDevice: Record<string, number>;
}

type StatRow = { start: number | string; change?: number | null };

/** Seçilen aralık için dilim dilim tüketim (kWh), cihaz kırılımıyla. */
export async function energySeries(conn: Connection, statIds: string[], range: RangeKey): Promise<Bucket[]> {
  const r = RANGES[range];
  const now = Date.now();
  // Dilim sınırına hizala ki son dilim eksik görünmesin
  let start = now - r.ms;
  if (r.period === "day") {
    const d = new Date(start);
    d.setHours(0, 0, 0, 0);
    start = d.getTime() + 86400_000;
  } else {
    start = Math.floor(start / r.bucketMs) * r.bucketMs + r.bucketMs;
  }
  const buckets: Bucket[] = [];
  for (let t = start; t <= now; t += r.bucketMs) {
    if (r.period === "day") {
      // Yaz saati vb. kaymalara karşı her günü yerel gece yarısından başlat
      const d = new Date(t);
      d.setHours(0, 0, 0, 0);
      t = d.getTime();
    }
    buckets.push({ start: t, kwh: null, perDevice: {} });
  }
  if (!statIds.length || !buckets.length) return buckets;

  const res = await conn.sendMessagePromise<Record<string, StatRow[]>>({
    type: "recorder/statistics_during_period",
    start_time: new Date(buckets[0].start).toISOString(),
    end_time: new Date(now).toISOString(),
    statistic_ids: statIds,
    period: r.period,
    types: ["change"],
  });

  const index = new Map(buckets.map((b, i) => [b.start, i]));
  const findBucket = (t: number) => {
    const exact = index.get(t);
    if (exact != null) return exact;
    // En yakın dilim (saat dilimi/hizalama farkları için)
    let best = -1;
    let bestDiff = Infinity;
    buckets.forEach((b, i) => {
      const diff = Math.abs(b.start - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    return bestDiff < r.bucketMs / 2 ? best : -1;
  };

  for (const [id, rows] of Object.entries(res)) {
    for (const row of rows) {
      if (typeof row.change !== "number") continue;
      const t = typeof row.start === "number" ? row.start : Date.parse(row.start);
      const i = findBucket(t);
      if (i < 0) continue;
      const b = buckets[i];
      b.kwh = (b.kwh ?? 0) + row.change;
      b.perDevice[id] = (b.perDevice[id] ?? 0) + row.change;
    }
  }
  return buckets;
}

export function fmtWatts(w: number) {
  if (w >= 1000) return `${(w / 1000).toLocaleString(locale(), { maximumFractionDigits: 2 })} kW`;
  return `${w.toLocaleString(locale(), { maximumFractionDigits: w < 10 ? 1 : 0 })} W`;
}

export function fmtKwh(k: number) {
  return `${k.toLocaleString(locale(), { maximumFractionDigits: k < 10 ? 2 : 1 })} kWh`;
}
