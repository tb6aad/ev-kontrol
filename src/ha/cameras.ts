// Kamera keşfi ve görüntü adresleri (HA kamera vekil uç noktaları)
import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import type { Registries } from "./client";
import { friendly } from "./devices";
import { t } from "../i18n";

export interface CameraStream {
  entity: HassEntity;
  /** "HD" / "SD" / tek akışlı kamerada "" */
  label: string;
}

export interface CameraDevice {
  key: string;
  name: string;
  area: string;
  streams: CameraStream[];
  /** Aynı cihazdaki yardımcılar */
  privacy?: HassEntity;
  motion?: HassEntity;
}

export const CAMERA_SUPPORT_STREAM = 2;

function streamLabel(e: HassEntity): string {
  const id = e.entity_id.toLowerCase();
  if (/_hd(_|$)|high|main/.test(id)) return "HD";
  if (/_sd(_|$)|low|sub/.test(id)) return "SD";
  return "";
}

export function discoverCameras(entities: HassEntities, reg: Registries): CameraDevice[] {
  const entReg = new Map(reg.entities.map((e) => [e.entity_id, e]));
  const devices = new Map(reg.devices.map((d) => [d.id, d]));
  const areaName = new Map(reg.areas.map((a) => [a.area_id, a.name]));
  const groups = new Map<string, CameraDevice>();

  for (const e of Object.values(entities)) {
    if (!e.entity_id.startsWith("camera.")) continue;
    const r = entReg.get(e.entity_id);
    if (r?.hidden_by || r?.disabled_by) continue;
    const devId = r?.device_id ?? null;
    const key = devId ?? e.entity_id;
    if (!groups.has(key)) {
      const dev = devId ? devices.get(devId) : undefined;
      const areaId = r?.area_id ?? dev?.area_id ?? null;
      const siblings = Object.values(entities).filter((x) => devId && entReg.get(x.entity_id)?.device_id === devId);
      groups.set(key, {
        key,
        name: cleanName(dev?.name_by_user || friendly(e)),
        area: (areaId && areaName.get(areaId)) || t("Odasız"),
        streams: [],
        privacy: siblings.find((x) => x.entity_id.startsWith("switch.") && /privacy|gizlilik/.test(x.entity_id)),
        motion: siblings.find((x) => x.entity_id.startsWith("binary_sensor.") && x.attributes.device_class === "motion"),
      });
    }
    groups.get(key)!.streams.push({ entity: e, label: streamLabel(e) });
  }
  for (const g of groups.values()) {
    // HD önce
    g.streams.sort((a, b) => (a.label === "HD" ? -1 : b.label === "HD" ? 1 : a.label.localeCompare(b.label)));
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/** "Yatak Odası Kamerası HD Stream" → "Yatak Odası Kamerası" */
function cleanName(n: string) {
  return n.replace(/\s+(HD|SD)\s+Stream$/i, "").replace(/\s+Stream$/i, "").trim();
}

export function isCameraOnline(e: HassEntity) {
  return e.state !== "unavailable" && e.state !== "unknown" && !!e.attributes.access_token;
}

const base = (url: string) => url.replace(/\/+$/, "");

/** Tek kare (anlık görüntü). t: önbelleği atlatmak için */
export function snapshotUrl(baseUrl: string, e: HassEntity, t: number) {
  return `${base(baseUrl)}/api/camera_proxy/${e.entity_id}?token=${encodeURIComponent(String(e.attributes.access_token))}&t=${t}`;
}

/** Canlı MJPEG akışı (<img> ile oynatılır; tarayıcı bağlantıyı kapatınca akış durur) */
export function mjpegUrl(baseUrl: string, e: HassEntity) {
  return `${base(baseUrl)}/api/camera_proxy_stream/${e.entity_id}?token=${encodeURIComponent(String(e.attributes.access_token))}`;
}
