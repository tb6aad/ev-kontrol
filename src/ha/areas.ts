// Oda (HA alanı) yönetimi: oluştur, yeniden adlandır, sil ve cihaz/varlık taşı.
// Değişiklikler doğrudan Home Assistant'a yazılır; arayüz kayıt olaylarıyla kendini tazeler.
import type { Connection } from "home-assistant-js-websocket";
import type { AreaEntry, Registries } from "./client";
import type { DeviceItem } from "./devices";

export function createArea(conn: Connection, name: string) {
  return conn.sendMessagePromise<AreaEntry>({ type: "config/area_registry/create", name });
}

export function renameArea(conn: Connection, areaId: string, name: string) {
  return conn.sendMessagePromise<AreaEntry>({ type: "config/area_registry/update", area_id: areaId, name });
}

/** HA alanı silince içindeki cihaz ve varlıkların alanını kendisi boşaltır. */
export function deleteArea(conn: Connection, areaId: string) {
  return conn.sendMessagePromise({ type: "config/area_registry/delete", area_id: areaId });
}

/** Aynı adda (büyük/küçük harf ve boşluk farkı gözetmeden) oda var mı */
export function areaNameTaken(reg: Registries, name: string, exceptId?: string) {
  const n = name.trim().toLocaleLowerCase("tr");
  return reg.areas.some((a) => a.area_id !== exceptId && a.name.trim().toLocaleLowerCase("tr") === n);
}

/** Kart HA'da taşınabilir mi: bir cihaza bağlıysa ya da varlık kayıtlıysa (unique_id'si varsa) */
export function canMove(d: DeviceItem, reg: Registries) {
  if (d.deviceId) return true;
  return reg.entities.some((e) => e.entity_id === d.key);
}

/**
 * Kartı başka odaya taşır (areaId null = odasız).
 * Cihazsa cihazın alanı değişir; kartın varlıklarında cihazdan farklı elle verilmiş bir alan varsa
 * o da temizlenir ki kart gerçekten yeni odada görünsün. Cihazsız varlıkta varlığın alanı değişir.
 */
export async function moveToArea(conn: Connection, reg: Registries, d: DeviceItem, areaId: string | null) {
  if (d.deviceId) {
    await conn.sendMessagePromise({ type: "config/device_registry/update", device_id: d.deviceId, area_id: areaId });
    const ids = new Set(d.entities.map((e) => e.entity_id));
    const overridden = reg.entities.filter((e) => ids.has(e.entity_id) && e.area_id && e.area_id !== areaId);
    for (const e of overridden) {
      await conn.sendMessagePromise({ type: "config/entity_registry/update", entity_id: e.entity_id, area_id: null });
    }
    return;
  }
  await conn.sendMessagePromise({ type: "config/entity_registry/update", entity_id: d.key, area_id: areaId });
}
