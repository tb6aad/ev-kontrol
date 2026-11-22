import { useEffect, useMemo, useState } from "react";
import { useAppVisible } from "../state/desktop";
import type { Connection, HassEntities, HassEntity } from "home-assistant-js-websocket";
import { callService } from "home-assistant-js-websocket";
import type { Registries } from "../ha/client";
import {
  AutomationConfig, deleteAutomation, getConfig, listAutomations, relTime, saveAutomation, setEnabled,
} from "../ha/automations";
import { formatState } from "../ha/devices";
import Toggle from "./Toggle";

interface Props {
  conn: Connection;
  entities: HassEntities;
  registries: Registries;
  baseUrl: string;
  token: string;
}

interface Sensor {
  entity: HassEntity;
  name: string;
  area: string;
  lux?: HassEntity;
  battery?: HassEntity;
  batteryLow?: HassEntity;
}

const DAY_MS = 24 * 3600_000;
const MARKER = "ev_kontrol_hareket";

/* ---------- Sensör keşfi ---------- */

function discover(entities: HassEntities, reg: Registries): Sensor[] {
  const entReg = new Map(reg.entities.map((e) => [e.entity_id, e]));
  const devices = new Map(reg.devices.map((d) => [d.id, d]));
  const areaName = new Map(reg.areas.map((a) => [a.area_id, a.name]));
  const out: Sensor[] = [];
  for (const e of Object.values(entities)) {
    if (!e.entity_id.startsWith("binary_sensor.")) continue;
    if (!["motion", "occupancy", "presence"].includes(String(e.attributes.device_class))) continue;
    const r = entReg.get(e.entity_id);
    if (r?.hidden_by || r?.disabled_by) continue;
    const devId = r?.device_id;
    const sib = (pred: (x: HassEntity) => boolean) =>
      devId
        ? Object.values(entities).find((x) => x.entity_id !== e.entity_id && entReg.get(x.entity_id)?.device_id === devId && pred(x))
        : undefined;
    const areaId = r?.area_id ?? (devId ? devices.get(devId)?.area_id : null);
    out.push({
      entity: e,
      name: ((e.attributes.friendly_name as string) || e.entity_id).replace(/ (Varlık|Occupancy|Motion)$/i, ""),
      area: (areaId && areaName.get(areaId)) || "Odasız",
      lux: sib((x) => x.attributes.device_class === "illuminance"),
      battery: sib((x) => x.entity_id.startsWith("sensor.") && x.attributes.device_class === "battery"),
      batteryLow: sib((x) => x.entity_id.startsWith("binary_sensor.") && x.attributes.device_class === "battery"),
    });
  }
  // Erişilemeyenler sona
  return out.sort((a, b) => Number(a.entity.state === "unavailable") - Number(b.entity.state === "unavailable") || a.area.localeCompare(b.area, "tr"));
}

/* ---------- 24 saatlik geçmiş ---------- */

interface Period {
  from: number;
  to: number;
}

type HistRow = { s?: string; state?: string; lu?: number; lc?: number; last_changed?: string; last_updated?: string };

async function fetchHistory(conn: Connection, ids: string[]): Promise<Record<string, Period[]>> {
  const end = Date.now();
  const start = end - DAY_MS;
  const res = await conn.sendMessagePromise<Record<string, HistRow[]>>({
    type: "history/history_during_period",
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    entity_ids: ids,
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
  });
  const out: Record<string, Period[]> = {};
  for (const id of ids) {
    const rows = (res[id] ?? []).map((r) => ({
      state: r.s ?? r.state ?? "",
      t: r.lc != null ? r.lc * 1000 : r.lu != null ? r.lu * 1000 : Date.parse(r.last_changed ?? r.last_updated ?? "") || start,
    }));
    const periods: Period[] = [];
    let openAt: number | null = null;
    for (const r of rows) {
      if (r.state === "on" && openAt == null) openAt = Math.max(r.t, start);
      else if (r.state !== "on" && openAt != null) {
        periods.push({ from: openAt, to: r.t });
        openAt = null;
      }
    }
    if (openAt != null) periods.push({ from: openAt, to: end });
    out[id] = periods;
  }
  return out;
}

/* ---------- "Hareketle ışık" kuralı ---------- */

interface Rule {
  target: string;
  minutes: number;
  darkOnly: boolean;
  luxBelow: number;
  timeWindow: boolean;
  after: string;
  before: string;
}

const ruleId = (sensorId: string) => `ev_kontrol_hareket_${sensorId.split(".")[1]}`.slice(0, 60);

function buildRule(s: Sensor, rule: Rule, names: (id: string) => string): AutomationConfig {
  const conditions: unknown[] = [];
  if (rule.darkOnly) {
    conditions.push(
      s.lux
        ? { condition: "numeric_state", entity_id: s.lux.entity_id, below: rule.luxBelow }
        : { condition: "state", entity_id: "sun.sun", state: "below_horizon" },
    );
  }
  if (rule.timeWindow) conditions.push({ condition: "time", after: `${rule.after}:00`, before: `${rule.before}:00` });

  const darkText = rule.darkOnly ? (s.lux ? ` (ışık ${rule.luxBelow} lx altındaysa)` : " (güneş battıysa)") : "";
  const timeText = rule.timeWindow ? ` ${rule.after}–${rule.before} arası` : "";
  return {
    id: ruleId(s.entity.entity_id),
    alias: `Hareket – ${s.name} → ${names(rule.target)} (Ev Kontrol)`,
    description: `Ev Kontrol Hareket Sensörleri sayfasında oluşturuldu. Hareket algılanınca${timeText}${darkText} ${names(rule.target)} açılır; ${rule.minutes} dk hareket olmazsa kapanır.`,
    mode: "restart",
    variables: { [MARKER]: { ...rule } },
    triggers: [{ trigger: "state", entity_id: s.entity.entity_id, to: "on" }],
    conditions,
    actions: [
      { action: "homeassistant.turn_on", target: { entity_id: rule.target } },
      {
        wait_for_trigger: [{ trigger: "state", entity_id: s.entity.entity_id, to: "off", for: { minutes: rule.minutes } }],
      },
      { action: "homeassistant.turn_off", target: { entity_id: rule.target } },
    ],
  };
}

/* ================= Sayfa ================= */

export default function Motion({ conn, entities, registries, baseUrl, token }: Props) {
  const sensors = useMemo(() => discover(entities, registries), [entities, registries]);
  const [history, setHistory] = useState<Record<string, Period[]>>({});
  const [configs, setConfigs] = useState<Record<string, AutomationConfig>>({});
  const [reload, setReload] = useState(0);
  const [, tick] = useState(0);

  const autos = useMemo(() => listAutomations(entities), [entities]);
  const sensorKey = sensors.map((s) => s.entity.entity_id).join(",");
  const stateKey = sensors.map((s) => s.entity.state).join(",");

  // Geçmiş: açılışta ve sensör durumu değiştikçe
  useEffect(() => {
    if (!sensorKey) return;
    fetchHistory(conn, sensorKey.split(",")).then(setHistory).catch(() => {});
  }, [conn, sensorKey, stateKey]);

  // "x dk önce" yazıları için dakikalık tazeleme
  const visible = useAppVisible();
  useEffect(() => {
    if (!visible) return;
    tick((n) => n + 1);
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [visible]);

  const autoKey = autos.map((a) => a.entityId).join(",");
  useEffect(() => {
    let alive = true;
    Promise.all(autos.map((a) => getConfig(conn, a.entityId).then((c) => [a.entityId, c] as const).catch(() => null))).then((res) => {
      if (!alive) return;
      const m: Record<string, AutomationConfig> = {};
      for (const r of res) if (r) m[r[0]] = r[1];
      setConfigs(m);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, autoKey, reload]);

  if (sensors.length === 0) return <div className="placeholder">Hareket sensörü bulunamadı.</div>;

  return (
    <div className="motion-page">
      {sensors.map((s) => (
        <SensorCard
          key={s.entity.entity_id}
          s={s}
          conn={conn}
          entities={entities}
          registries={registries}
          periods={history[s.entity.entity_id] ?? []}
          autos={autos}
          configs={configs}
          baseUrl={baseUrl}
          token={token}
          onChanged={() => setReload((n) => n + 1)}
        />
      ))}
    </div>
  );
}

/* ---------- Sensör kartı ---------- */

interface CardProps {
  s: Sensor;
  conn: Connection;
  entities: HassEntities;
  registries: Registries;
  periods: Period[];
  autos: ReturnType<typeof listAutomations>;
  configs: Record<string, AutomationConfig>;
  baseUrl: string;
  token: string;
  onChanged: () => void;
}

function SensorCard({ s, conn, entities, periods, autos, configs, baseUrl, token, onChanged }: CardProps) {
  const id = s.entity.entity_id;
  const on = s.entity.state === "on";
  const unavailable = s.entity.state === "unavailable";
  const names = (eid: string) => (entities[eid]?.attributes.friendly_name as string) || eid;
  const [ruleOpen, setRuleOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const managedId = ruleId(id);
  const managed = autos.find((a) => a.configId === managedId);
  const related = autos.filter((a) => {
    if (a.configId === managedId) return false;
    const c = configs[a.entityId];
    return c && JSON.stringify(c).includes(`"${id}"`);
  });

  // İlgili otomasyonların kullandığı yardımcılar (karanlık mod anahtarı, manuel kapatma zamanlayıcısı…)
  const helpers = useMemo(() => {
    const set = new Set<string>();
    for (const a of related) {
      const txt = JSON.stringify(configs[a.entityId] ?? {});
      for (const m of txt.matchAll(/"((?:input_boolean|timer)\.[a-z0-9_]+)"/g)) set.add(m[1]);
    }
    return [...set].map((h) => entities[h]).filter(Boolean);
  }, [related, configs, entities]);

  const lastChanged = new Date(s.entity.last_changed);
  const count = periods.length;
  const now = Date.now();
  const dayStart = now - DAY_MS;

  return (
    <section className={`motion-card ${on ? "on" : ""} ${unavailable ? "unavailable" : ""}`}>
      <header className="motion-head">
        <span className={`motion-dot ${on ? "on" : ""}`} />
        <div className="motion-title">
          <h3>{s.name}</h3>
          <span className="muted small">{s.area}</span>
        </div>
        <div className="motion-state">
          <b>{unavailable ? "Erişilemiyor" : on ? "Hareket var" : "Sakin"}</b>
          <span className="muted small">{unavailable ? "" : `${on ? "başladı" : "son hareket"}: ${relTime(lastChanged)}`}</span>
        </div>
      </header>

      <div className="motion-chips">
        {s.lux && <span className="chip">☀ {formatState(s.lux)}</span>}
        {s.battery && <span className="chip">🔋 {formatState(s.battery)}</span>}
        {s.batteryLow && <span className={`chip ${s.batteryLow.state === "on" ? "warn" : ""}`}>🔋 {s.batteryLow.state === "on" ? "Pil zayıf" : "Pil iyi"}</span>}
        <span className="chip">Son 24 saatte {count} hareket</span>
      </div>

      {/* 24 saatlik zaman çizelgesi */}
      <div className="timeline" title="Son 24 saat">
        {periods.map((p, i) => (
          <div
            key={i}
            className="tl-on"
            style={{ left: `${((p.from - dayStart) / DAY_MS) * 100}%`, width: `max(2px, ${((p.to - p.from) / DAY_MS) * 100}%)` }}
            title={`${new Date(p.from).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} – ${new Date(p.to).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`}
          />
        ))}
      </div>
      <div className="tl-axis">
        {[24, 18, 12, 6, 0].map((h) => (
          <span key={h}>{h === 0 ? "şimdi" : new Date(now - h * 3600_000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
        ))}
      </div>

      {(related.length > 0 || managed) && (
        <div className="motion-autos">
          <h4>Bu sensörü kullanan otomasyonlar</h4>
          {[...(managed ? [managed] : []), ...related].map((a) => (
            <div key={a.entityId} className="other-auto">
              <Toggle on={a.enabled} onChange={() => setEnabled(conn, a.entityId, !a.enabled)} />
              <div className="auto-text">
                <span className="auto-name">
                  {a.name} <span className="muted small">· {relTime(a.lastTriggered)}</span>
                </span>
                {configs[a.entityId]?.description && <span className="other-desc">{configs[a.entityId].description}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {helpers.length > 0 && (
        <div className="motion-helpers">
          {helpers.map((h) =>
            h.entity_id.startsWith("input_boolean.") ? (
              <label key={h.entity_id} className="helper">
                <Toggle on={h.state === "on"} onChange={() => callService(conn, "input_boolean", "toggle", {}, { entity_id: h.entity_id })} />
                {names(h.entity_id)}
              </label>
            ) : (
              <span key={h.entity_id} className="helper">
                ⏱ {names(h.entity_id)}: {h.state === "active" ? `çalışıyor (${String(h.attributes.finishes_at ? new Date(h.attributes.finishes_at as string).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) + "'de biter" : h.attributes.remaining)})` : h.state === "paused" ? "duraklatıldı" : `boşta (${h.attributes.duration})`}
                {h.state === "active" && (
                  <button className="btn-small ghost" onClick={() => callService(conn, "timer", "cancel", {}, { entity_id: h.entity_id })}>iptal</button>
                )}
              </span>
            ),
          )}
        </div>
      )}

      <div className="motion-foot">
        <button className="btn-small" onClick={() => setRuleOpen((o) => !o)}>
          {ruleOpen ? "Kapat" : managed ? "✎ Hareketle ışık kuralını düzenle" : "+ Hareketle ışık kuralı ekle"}
        </button>
        {msg && <span className={msg.startsWith("Hata") ? "error-text" : "ok-text"}>{msg}</span>}
      </div>

      {ruleOpen && (
        <RuleForm
          s={s}
          entities={entities}
          names={names}
          initial={managed ? (configs[managed.entityId]?.variables?.[MARKER] as Rule | undefined) : undefined}
          exists={!!managed}
          onSave={async (rule) => {
            try {
              await saveAutomation(baseUrl, token, buildRule(s, rule, names));
              setMsg("Kural kaydedildi");
              setRuleOpen(false);
              onChanged();
            } catch (e) {
              setMsg(`Hata: ${(e as Error).message}`);
            }
          }}
          onDelete={async () => {
            try {
              await deleteAutomation(baseUrl, token, managedId);
              setMsg("Kural silindi");
              setRuleOpen(false);
              onChanged();
            } catch (e) {
              setMsg(`Hata: ${(e as Error).message}`);
            }
          }}
        />
      )}
    </section>
  );
}

/* ---------- Kural formu ---------- */

function RuleForm({
  s, entities, names, initial, exists, onSave, onDelete,
}: {
  s: Sensor;
  entities: HassEntities;
  names: (id: string) => string;
  initial?: Rule;
  exists: boolean;
  onSave: (r: Rule) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [rule, setRule] = useState<Rule>(
    initial ?? { target: "", minutes: 2, darkOnly: true, luxBelow: 10, timeWindow: false, after: "18:00", before: "07:00" },
  );
  const [busy, setBusy] = useState(false);
  const targets = Object.values(entities)
    .filter((e) => /^(light|switch|fan|input_boolean)\./.test(e.entity_id))
    .sort((a, b) => names(a.entity_id).localeCompare(names(b.entity_id), "tr"));
  const set = (p: Partial<Rule>) => setRule((r) => ({ ...r, ...p }));

  return (
    <div className="rule-form">
      <label>
        Ne açılsın
        <select value={rule.target} onChange={(e) => set({ target: e.target.value })} className={!rule.target ? "needs" : ""}>
          <option value="">Cihaz seç…</option>
          {targets.map((t) => (
            <option key={t.entity_id} value={t.entity_id}>
              {names(t.entity_id)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Hareket bitince kaç dakika sonra kapansın
        <input type="number" min={1} max={120} value={rule.minutes} onChange={(e) => set({ minutes: Math.max(1, Number(e.target.value) || 1) })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={rule.darkOnly} onChange={(e) => set({ darkOnly: e.target.checked })} />
        Sadece karanlıkta
        {rule.darkOnly &&
          (s.lux ? (
            <>
              — ışık
              <input type="number" min={0} className="tiny" value={rule.luxBelow} onChange={(e) => set({ luxBelow: Number(e.target.value) || 0 })} />
              lx altındaysa <span className="muted small">(şu an {formatState(s.lux)})</span>
            </>
          ) : (
            <span className="muted small"> — güneş battıktan sonra</span>
          ))}
      </label>
      <label className="check">
        <input type="checkbox" checked={rule.timeWindow} onChange={(e) => set({ timeWindow: e.target.checked })} />
        Sadece şu saatlerde
        {rule.timeWindow && (
          <>
            <input type="time" value={rule.after} onChange={(e) => set({ after: e.target.value })} />–
            <input type="time" value={rule.before} onChange={(e) => set({ before: e.target.value })} />
          </>
        )}
      </label>
      <div className="rule-actions">
        {exists && (
          <button className="btn-small danger" disabled={busy} onClick={async () => { setBusy(true); await onDelete(); setBusy(false); }}>
            Kuralı sil
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button
          className="btn-primary"
          disabled={!rule.target || busy}
          onClick={async () => {
            setBusy(true);
            await onSave(rule);
            setBusy(false);
          }}
        >
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </div>
  );
}

