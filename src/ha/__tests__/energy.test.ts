import { describe, expect, it } from "vitest";
import type { Connection } from "home-assistant-js-websocket";
import { energySeries, livePower, monthlyEnergy, periodTotal } from "../energy";
import { ent } from "./fixtures";

/** sendMessagePromise'u taklit eden sahte bağlantı */
function fakeConn(handler: (msg: Record<string, unknown>) => unknown): Connection {
  return { sendMessagePromise: async (m: Record<string, unknown>) => handler(m) } as unknown as Connection;
}

describe("livePower", () => {
  it("W ve kW sensörlerini toplar, sayısal olmayanları atlar", () => {
    const r = livePower({
      a: ent("sensor.a", "100", { device_class: "power", unit_of_measurement: "W" }),
      b: ent("sensor.b", "1.5", { device_class: "power", unit_of_measurement: "kW" }),
      c: ent("sensor.c", "unavailable", { device_class: "power", unit_of_measurement: "W" }),
      d: ent("sensor.d", "5", { device_class: "energy", unit_of_measurement: "kWh" }),
    });
    expect(r.total).toBe(1600);
    expect(r.items.map((i) => i.entity.entity_id)).toEqual(["sensor.b", "sensor.a"]);
  });
});

describe("periodTotal", () => {
  it("hiç veri yoksa 0 değil null döner", async () => {
    const conn = fakeConn(() => ({ change: null }));
    expect(await periodTotal(conn, ["sensor.x"], { period: "day" })).toBeNull();
    expect(await periodTotal(conn, [], { period: "day" })).toBeNull();
  });
  it("sensörlerin değişimlerini toplar", async () => {
    const conn = fakeConn((m) => ({ change: m.statistic_id === "sensor.a" ? 1.25 : 0.5 }));
    expect(await periodTotal(conn, ["sensor.a", "sensor.b"], { period: "day" })).toBe(1.75);
  });
});

describe("monthlyEnergy", () => {
  const ents = {
    "sensor.a": ent("sensor.a", "1", { device_class: "energy", state_class: "total_increasing" }),
    "sensor.b": ent("sensor.b", "1", { device_class: "energy", state_class: "total_increasing" }),
  };
  it("bağlantı hatasında sahte 0 döndürmez, hatayı iletir", async () => {
    const conn = fakeConn((m) => {
      if (m.type === "energy/get_prefs") throw { code: "not_found" };
      throw { code: 3, message: "Connection lost" };
    });
    await expect(monthlyEnergy(conn, ents)).rejects.toBeTruthy();
  });
  it("verisi olmayan sensörü toplama katmaz", async () => {
    const conn = fakeConn((m) => {
      if (m.type === "energy/get_prefs") throw { code: "not_found" };
      return { change: m.statistic_id === "sensor.a" ? 3.5 : null };
    });
    const r = await monthlyEnergy(conn, ents);
    expect(r.total).toBe(3.5);
    expect(r.items.map((i) => i.statId)).toEqual(["sensor.a"]);
  });
});

describe("energySeries", () => {
  it("eksik dilimleri null bırakır, mevcutları cihaz kırılımıyla toplar", async () => {
    let captured: Record<string, unknown> | null = null;
    const conn = fakeConn((m) => {
      captured = m;
      const first = Date.parse(m.start_time as string);
      return {
        "sensor.a": [
          { start: first, change: 0.2 },
          { start: first + 3600_000, change: 0.3 },
        ],
        "sensor.b": [{ start: first, change: 0.1 }],
      };
    });
    const b = await energySeries(conn, ["sensor.a", "sensor.b"], "24h");
    expect(captured!.period).toBe("hour");
    expect(b.length).toBeGreaterThanOrEqual(23);
    expect(b[0].kwh).toBeCloseTo(0.3);
    expect(b[0].perDevice).toEqual({ "sensor.a": 0.2, "sensor.b": 0.1 });
    expect(b[1].kwh).toBeCloseTo(0.3);
    // Veri gelmeyen dilimler sıfır değil
    expect(b.slice(2).every((x) => x.kwh === null)).toBe(true);
  });
});
