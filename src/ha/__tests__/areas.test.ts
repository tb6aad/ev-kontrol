import { describe, expect, it, vi } from "vitest";
import type { Connection } from "home-assistant-js-websocket";
import { areaNameTaken, canMove, moveToArea } from "../areas";
import type { Registries } from "../client";
import type { DeviceItem } from "../devices";

const reg: Registries = {
  areas: [
    { area_id: "salon", name: "Salon" },
    { area_id: "mutfak", name: "Mutfak" },
  ],
  devices: [{ id: "dev1", area_id: "salon", name: "Lamba", name_by_user: null }],
  entities: [
    { entity_id: "light.lamba", area_id: null, device_id: "dev1", hidden_by: null, disabled_by: null, entity_category: null },
    { entity_id: "sensor.lamba_guc", area_id: "mutfak", device_id: "dev1", hidden_by: null, disabled_by: null, entity_category: null },
    { entity_id: "switch.tekil", area_id: null, device_id: null, hidden_by: null, disabled_by: null, entity_category: null },
  ],
};

const ent = (id: string) => ({ entity_id: id, state: "on", attributes: {}, last_changed: "", last_updated: "", context: { id: "", parent_id: null, user_id: null } });

const card = (over: Partial<DeviceItem>): DeviceItem => ({
  key: "dev1", name: "Lamba", area: "Salon", areaId: "salon", deviceId: "dev1",
  entities: [ent("light.lamba"), ent("sensor.lamba_guc")], primary: ent("light.lamba"), ...over,
});

const fakeConn = () => {
  const sent: Record<string, unknown>[] = [];
  const conn = { sendMessagePromise: vi.fn(async (m: Record<string, unknown>) => { sent.push(m); return {}; }) } as unknown as Connection;
  return { conn, sent };
};

describe("odalar", () => {
  it("aynı adı büyük/küçük harf ve boşluk farkıyla da yakalar", () => {
    expect(areaNameTaken(reg, "  salon ")).toBe(true);
    expect(areaNameTaken(reg, "Salon", "salon")).toBe(false); // kendi adını korumak serbest
    expect(areaNameTaken(reg, "Banyo")).toBe(false);
  });

  it("cihazı taşırken cihazdan farklı elle verilmiş varlık alanını da temizler", async () => {
    const { conn, sent } = fakeConn();
    await moveToArea(conn, reg, card({}), "mutfak");
    expect(sent).toEqual([{ type: "config/device_registry/update", device_id: "dev1", area_id: "mutfak" }]);

    const second = fakeConn();
    await moveToArea(second.conn, reg, card({}), "salon");
    expect(second.sent).toEqual([
      { type: "config/device_registry/update", device_id: "dev1", area_id: "salon" },
      { type: "config/entity_registry/update", entity_id: "sensor.lamba_guc", area_id: null },
    ]);
  });

  it("cihazsız varlığın kendi alanını değiştirir; kayıtsız varlık taşınamaz", async () => {
    const { conn, sent } = fakeConn();
    const single = card({ key: "switch.tekil", deviceId: undefined, entities: [ent("switch.tekil")], primary: ent("switch.tekil") });
    expect(canMove(single, reg)).toBe(true);
    await moveToArea(conn, reg, single, null);
    expect(sent).toEqual([{ type: "config/entity_registry/update", entity_id: "switch.tekil", area_id: null }]);
    expect(canMove(card({ key: "sensor.kayitsiz", deviceId: undefined }), reg)).toBe(false);
  });
});
