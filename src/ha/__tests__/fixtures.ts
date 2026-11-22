import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import type { Registries } from "../client";

export function ent(entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  return {
    entity_id,
    state,
    attributes,
    last_changed: "2026-11-21T10:00:00Z",
    last_updated: "2026-11-21T10:00:00Z",
    context: { id: "x", parent_id: null, user_id: null },
  } as HassEntity;
}

/** Gerçek evdeki yapıya benzeyen küçük örnek: priz (anahtar+güç+enerji), lamba, sensör, odasız buton */
export function sample(): { entities: HassEntities; reg: Registries } {
  const list = [
    ent("switch.yazici_1", "on", { friendly_name: "3D Yazıcı 1" }),
    ent("sensor.yazici_1_guc", "52.81", { friendly_name: "3D Yazıcı 1 Güç", device_class: "power", unit_of_measurement: "W" }),
    ent("sensor.yazici_1_enerji", "2.1416", { friendly_name: "3D Yazıcı 1 Enerji", device_class: "energy", unit_of_measurement: "kWh", state_class: "total_increasing" }),
    ent("light.masa", "on", { friendly_name: "Masa Lambası", brightness: 128 }),
    ent("sensor.masa_sicaklik", "21.456", { friendly_name: "Masa Lambası Sıcaklık", device_class: "temperature", unit_of_measurement: "°C" }),
    ent("switch.klima", "unavailable", { friendly_name: "Klima" }),
    ent("sensor.salon_sicaklik", "22.3", { friendly_name: "Salon Sıcaklık", device_class: "temperature", unit_of_measurement: "°C" }),
    ent("scene.uyku", "unknown", { friendly_name: "Uyku" }),
    ent("update.firmware", "off", { friendly_name: "Firmware" }),
  ];
  const entities: HassEntities = Object.fromEntries(list.map((e) => [e.entity_id, e]));
  const reg: Registries = {
    areas: [
      { area_id: "atolye", name: "Atölye" },
      { area_id: "salon", name: "Oturma odası" },
    ],
    devices: [
      { id: "dev_yazici", area_id: "atolye", name: "3D Yazıcı 1", name_by_user: null },
      { id: "dev_masa", area_id: "atolye", name: "Masa Lambası", name_by_user: null },
      { id: "dev_klima", area_id: "salon", name: "Klima", name_by_user: null },
    ],
    entities: [
      { entity_id: "switch.yazici_1", device_id: "dev_yazici", area_id: null, hidden_by: null, disabled_by: null, entity_category: null },
      { entity_id: "sensor.yazici_1_guc", device_id: "dev_yazici", area_id: null, hidden_by: null, disabled_by: null, entity_category: null },
      { entity_id: "sensor.yazici_1_enerji", device_id: "dev_yazici", area_id: null, hidden_by: null, disabled_by: null, entity_category: null },
      { entity_id: "light.masa", device_id: "dev_masa", area_id: null, hidden_by: null, disabled_by: null, entity_category: null },
      { entity_id: "sensor.masa_sicaklik", device_id: "dev_masa", area_id: null, hidden_by: null, disabled_by: null, entity_category: null },
      { entity_id: "switch.klima", device_id: "dev_klima", area_id: null, hidden_by: null, disabled_by: null, entity_category: null },
      { entity_id: "sensor.salon_sicaklik", device_id: null, area_id: "salon", hidden_by: null, disabled_by: null, entity_category: null },
    ],
  };
  return { entities, reg };
}
