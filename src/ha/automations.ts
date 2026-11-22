import type { Connection, HassEntities, HassEntity } from "home-assistant-js-websocket";
import { callService } from "home-assistant-js-websocket";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AutomationConfig = Record<string, any> & { id?: string; alias?: string; description?: string };

export interface AutomationItem {
  entity: HassEntity;
  entityId: string;
  configId: string | undefined;
  name: string;
  enabled: boolean;
  running: number;
  lastTriggered: Date | null;
  mode: string;
}

export function listAutomations(entities: HassEntities): AutomationItem[] {
  return Object.values(entities)
    .filter((e) => e.entity_id.startsWith("automation."))
    .map((e) => {
      const lt = e.attributes.last_triggered as string | null;
      return {
        entity: e,
        entityId: e.entity_id,
        configId: e.attributes.id as string | undefined,
        name: (e.attributes.friendly_name as string) || e.entity_id,
        enabled: e.state === "on",
        running: Number(e.attributes.current ?? 0),
        lastTriggered: lt ? new Date(lt) : null,
        mode: (e.attributes.mode as string) ?? "single",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export async function getConfig(conn: Connection, entityId: string): Promise<AutomationConfig> {
  const r = await conn.sendMessagePromise<{ config: AutomationConfig }>({ type: "automation/config", entity_id: entityId });
  return r.config;
}

export function setEnabled(conn: Connection, entityId: string, on: boolean) {
  return callService(conn, "automation", on ? "turn_on" : "turn_off", { entity_id: entityId });
}

/** Koşulları atlayıp eylemleri hemen çalıştırır. */
export function runNow(conn: Connection, entityId: string) {
  return callService(conn, "automation", "trigger", { entity_id: entityId, skip_condition: true });
}

/* ---------- REST (oluştur / sil) ---------- */

async function rest(baseUrl: string, token: string, method: string, path: string, body?: unknown) {
  const f = isTauri() ? tauriFetch : window.fetch.bind(window);
  const res = await f(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${txt}`.trim());
  }
  return res.json().catch(() => null);
}

export function deleteAutomation(baseUrl: string, token: string, configId: string) {
  return rest(baseUrl, token, "DELETE", `/api/config/automation/config/${encodeURIComponent(configId)}`);
}

/** Oluşturur ya da günceller (id aynıysa üzerine yazar). HA otomasyonları kendisi yeniden yükler. */
export function saveAutomation(baseUrl: string, token: string, config: AutomationConfig) {
  const id = config.id || String(Date.now());
  return rest(baseUrl, token, "POST", `/api/config/automation/config/${encodeURIComponent(id)}`, { ...config, id });
}

/* ---------- Yerel yedek (silinenler) ---------- */

export interface DeletedBackup {
  config: AutomationConfig;
  deletedAt: string;
}

const BACKUP_KEY = "ha-desktop.deleted-automations";
const MAX_BACKUPS = 30;

export function loadBackups(): DeletedBackup[] {
  try {
    return JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addBackup(config: AutomationConfig) {
  const list = [{ config, deletedAt: new Date().toISOString() }, ...loadBackups()].slice(0, MAX_BACKUPS);
  localStorage.setItem(BACKUP_KEY, JSON.stringify(list));
  return list;
}

export function removeBackup(id: string | undefined) {
  const list = loadBackups().filter((b) => b.config.id !== id);
  localStorage.setItem(BACKUP_KEY, JSON.stringify(list));
  return list;
}

/* ---------- İnsan okunur özet ---------- */

type Names = (entityId: string) => string;

const asList = (x: any): any[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

function ents(x: any, names: Names) {
  return asList(x).map((id) => names(String(id))).join(", ");
}

const STATE_WORDS: Record<string, string> = { on: "açık", off: "kapalı", home: "evde", not_home: "dışarıda", open: "açık", closed: "kapalı" };
const sw = (s: any) => STATE_WORDS[String(s)] ?? String(s);

export function describeTrigger(t: any, names: Names): string {
  const kind = t.trigger ?? t.platform;
  switch (kind) {
    case "state": {
      const who = ents(t.entity_id, names);
      if (t.to != null && t.from != null) return `${who}: ${sw(t.from)} → ${sw(t.to)}`;
      if (t.to != null) return `${who} ${sw(t.to)} olunca`;
      return `${who} değişince`;
    }
    case "numeric_state": {
      const who = ents(t.entity_id, names);
      const parts = [];
      if (t.above != null) parts.push(`> ${t.above}`);
      if (t.below != null) parts.push(`< ${t.below}`);
      return `${who} ${parts.join(" ve ")}`;
    }
    case "time":
      return `Saat ${asList(t.at).join(", ")}`;
    case "time_pattern":
      return `Periyodik (${[t.hours && `saat ${t.hours}`, t.minutes && `dakika ${t.minutes}`, t.seconds && `saniye ${t.seconds}`].filter(Boolean).join(", ")})`;
    case "sun":
      return `${t.event === "sunset" ? "Gün batımı" : "Gün doğumu"}${t.offset ? ` (${t.offset})` : ""}`;
    case "homeassistant":
      return t.event === "shutdown" ? "HA kapanırken" : "HA açılınca";
    case "device":
      return `Cihaz tetikleyicisi (${t.type ?? t.subtype ?? "?"})`;
    case "zone":
      return `${ents(t.entity_id, names)} ${t.event === "leave" ? "bölgeden çıkınca" : "bölgeye girince"}`;
    case "template":
      return "Şablon koşulu doğru olunca";
    case "event":
      return `Olay: ${t.event_type}`;
    case "webhook":
      return "Webhook";
    case "mqtt":
      return `MQTT: ${t.topic}`;
    case "conversation":
      return `Sesli komut: "${asList(t.command).join('", "')}"`;
    default:
      return String(kind ?? "Bilinmeyen tetikleyici");
  }
}

export function describeCondition(c: any, names: Names): string {
  const kind = c.condition;
  switch (kind) {
    case "state":
      return `${ents(c.entity_id, names)} ${sw(c.state)} ise`;
    case "numeric_state":
      return `${ents(c.entity_id, names)} ${[c.above != null && `> ${c.above}`, c.below != null && `< ${c.below}`].filter(Boolean).join(" ve ")}`;
    case "time": {
      const days = c.weekday ? ` (${asList(c.weekday).join(", ")})` : "";
      return `Saat ${c.after ?? "…"} – ${c.before ?? "…"}${days}`;
    }
    case "sun":
      return `Güneş: ${[c.after && `${c.after} sonrası`, c.before && `${c.before} öncesi`].filter(Boolean).join(", ")}`;
    case "and":
    case "or":
    case "not":
      return `${kind.toUpperCase()} (${asList(c.conditions).length} koşul)`;
    case "template":
      return "Şablon";
    default:
      return String(kind ?? "Koşul");
  }
}

export function describeAction(a: any, names: Names): string {
  const svc = a.action ?? a.service;
  if (svc) {
    const target = a.target?.entity_id ?? a.entity_id ?? a.data?.entity_id;
    const t = target ? ents(target, names) : a.target?.area_id ? `alan: ${asList(a.target.area_id).join(", ")}` : "";
    const verb: Record<string, string> = { turn_on: "Aç", turn_off: "Kapat", toggle: "Değiştir" };
    const [dom, name] = String(svc).split(".");
    if (verb[name]) return `${verb[name]}: ${t || dom}`;
    if (dom === "notify") return `Bildirim gönder (${name})`;
    return `${svc}${t ? ` → ${t}` : ""}`;
  }
  if (a.delay) return `Bekle ${typeof a.delay === "string" ? a.delay : JSON.stringify(a.delay)}`;
  if (a.wait_for_trigger) return "Tetikleyici bekle";
  if (a.wait_template) return "Şablon bekle";
  if (a.choose) return `Seçim (${asList(a.choose).length} seçenek)`;
  if (a.if) return "Eğer / değilse";
  if (a.repeat) return "Tekrarla";
  if (a.scene) return `Sahne: ${names(a.scene)}`;
  if (a.condition) return `Koşul: ${describeCondition(a, names)}`;
  if (a.event) return `Olay gönder: ${a.event}`;
  if (a.device_id) return `Cihaz eylemi (${a.type ?? "?"})`;
  if (a.stop) return `Durdur: ${a.stop}`;
  return "Eylem";
}

export function relTime(d: Date | null) {
  if (!d) return "Hiç çalışmadı";
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("tr", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return d.toLocaleDateString("tr-TR");
}

export const asArray = asList;
