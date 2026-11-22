import type { Connection, HassEntities, HassEntity } from "home-assistant-js-websocket";
import { callService } from "home-assistant-js-websocket";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getLang, locale, t, tk } from "../i18n";

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

const STATE_WORDS: Record<string, string> = {
  on: tk("açık"), off: tk("kapalı"), home: tk("evde"), not_home: tk("dışarıda"), open: tk("açık"), closed: tk("kapalı"),
};
const sw = (s: any) => (STATE_WORDS[String(s)] ? t(STATE_WORDS[String(s)]) : String(s));

export function describeTrigger(trg: any, names: Names): string {
  const kind = trg.trigger ?? trg.platform;
  switch (kind) {
    case "state": {
      const who = ents(trg.entity_id, names);
      if (trg.to != null && trg.from != null) return `${who}: ${sw(trg.from)} → ${sw(trg.to)}`;
      if (trg.to != null) return t("{who} {state} olunca", { who, state: sw(trg.to) });
      return t("{who} değişince", { who });
    }
    case "numeric_state": {
      const who = ents(trg.entity_id, names);
      const parts = [];
      if (trg.above != null) parts.push(`> ${trg.above}`);
      if (trg.below != null) parts.push(`< ${trg.below}`);
      return `${who} ${parts.join(" " + t("ve") + " ")}`;
    }
    case "time":
      return t("Saat {at}", { at: asList(trg.at).join(", ") });
    case "time_pattern":
      return t("Periyodik ({x})", {
        x: [
          trg.hours && t("saat {v}", { v: trg.hours }),
          trg.minutes && t("dakika {v}", { v: trg.minutes }),
          trg.seconds && t("saniye {v}", { v: trg.seconds }),
        ].filter(Boolean).join(", "),
      });
    case "sun":
      return `${trg.event === "sunset" ? t("Gün batımı") : t("Gün doğumu")}${trg.offset ? ` (${trg.offset})` : ""}`;
    case "homeassistant":
      return trg.event === "shutdown" ? t("HA kapanırken") : t("HA açılınca");
    case "device":
      return t("Cihaz tetikleyicisi ({x})", { x: trg.type ?? trg.subtype ?? "?" });
    case "zone":
      return `${ents(trg.entity_id, names)} ${trg.event === "leave" ? t("bölgeden çıkınca") : t("bölgeye girince")}`;
    case "template":
      return t("Şablon koşulu doğru olunca");
    case "event":
      return t("Olay: {x}", { x: trg.event_type });
    case "webhook":
      return "Webhook";
    case "mqtt":
      return `MQTT: ${trg.topic}`;
    case "conversation":
      return t("Sesli komut: {x}", { x: `"${asList(trg.command).join('", "')}"` });
    default:
      return String(kind ?? t("Bilinmeyen tetikleyici"));
  }
}

export function describeCondition(c: any, names: Names): string {
  const kind = c.condition;
  switch (kind) {
    case "state":
      return t("{who} {state} ise", { who: ents(c.entity_id, names), state: sw(c.state) });
    case "numeric_state":
      return `${ents(c.entity_id, names)} ${[c.above != null && `> ${c.above}`, c.below != null && `< ${c.below}`].filter(Boolean).join(" " + t("ve") + " ")}`;
    case "time": {
      const days = c.weekday ? ` (${asList(c.weekday).join(", ")})` : "";
      return t("Saat {from} – {to}", { from: c.after ?? "…", to: c.before ?? "…" }) + days;
    }
    case "sun":
      return t("Güneş: {x}", {
        x: [c.after && t("{v} sonrası", { v: c.after }), c.before && t("{v} öncesi", { v: c.before })].filter(Boolean).join(", "),
      });
    case "and":
    case "or":
    case "not":
      return `${kind.toUpperCase()} (${t("{n} koşul", { n: asList(c.conditions).length })})`;
    case "template":
      return t("Şablon");
    default:
      return String(kind ?? t("Koşul"));
  }
}

const VERBS: Record<string, string> = { turn_on: tk("Aç"), turn_off: tk("Kapat"), toggle: tk("Değiştir|eylem") };

export function describeAction(a: any, names: Names): string {
  const svc = a.action ?? a.service;
  if (svc) {
    const target = a.target?.entity_id ?? a.entity_id ?? a.data?.entity_id;
    const tgt = target ? ents(target, names) : a.target?.area_id ? t("alan: {x}", { x: asList(a.target.area_id).join(", ") }) : "";
    const [dom, name] = String(svc).split(".");
    if (VERBS[name]) return `${t(VERBS[name])}: ${tgt || dom}`;
    if (dom === "notify") return t("Bildirim gönder ({x})", { x: name });
    return `${svc}${tgt ? ` → ${tgt}` : ""}`;
  }
  if (a.delay) return t("Bekle {x}", { x: typeof a.delay === "string" ? a.delay : JSON.stringify(a.delay) });
  if (a.wait_for_trigger) return t("Tetikleyici bekle");
  if (a.wait_template) return t("Şablon bekle");
  if (a.choose) return t("Seçim ({n} seçenek)", { n: asList(a.choose).length });
  if (a.if) return t("Eğer / değilse");
  if (a.repeat) return t("Tekrarla");
  if (a.scene) return t("Sahne: {x}", { x: names(a.scene) });
  if (a.condition) return t("Koşul: {x}", { x: describeCondition(a, names) });
  if (a.event) return t("Olay gönder: {x}", { x: a.event });
  if (a.device_id) return t("Cihaz eylemi ({x})", { x: a.type ?? "?" });
  if (a.stop) return t("Durdur: {x}", { x: a.stop });
  return t("Eylem");
}

export function relTime(d: Date | null) {
  if (!d) return t("Hiç çalışmadı");
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return d.toLocaleDateString(locale());
}

export const asArray = asList;
