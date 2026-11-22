import { describe, expect, it } from "vitest";
import { buildDevices, deviceIsOn, extraInfo, formatState, isSwitchable } from "../devices";
import { ent, sample } from "./fixtures";

describe("buildDevices", () => {
  const { entities, reg } = sample();
  const devices = buildDevices(entities, reg);
  const by = (name: string) => devices.find((d) => d.name === name)!;

  it("bir cihazın varlıklarını tek kartta toplar", () => {
    const y = by("3D Yazıcı 1");
    expect(y.entities.map((e) => e.entity_id).sort()).toEqual(["sensor.yazici_1_enerji", "sensor.yazici_1_guc", "switch.yazici_1"]);
    expect(y.area).toBe("Atölye");
  });

  it("ana varlık olarak kontrol edilebilir olanı seçer ve güç sensörünü ekler", () => {
    const y = by("3D Yazıcı 1");
    expect(y.primary.entity_id).toBe("switch.yazici_1");
    expect(y.power?.entity_id).toBe("sensor.yazici_1_guc");
  });

  it("cihazsız varlık kendi alanıyla tek başına kart olur", () => {
    expect(by("Salon Sıcaklık").area).toBe("Oturma odası");
  });

  it("sistem domainlerini (update) göstermez", () => {
    expect(devices.some((d) => d.primary.entity_id.startsWith("update."))).toBe(false);
  });

  it("erişilemeyen cihaz açık sayılmaz ve anahtarı pasiftir", () => {
    const k = by("Klima");
    expect(deviceIsOn(k)).toBe(false);
    expect(isSwitchable(k.primary)).toBe(false);
  });
});

describe("formatState", () => {
  it("sayıları Türkçe biçimler ve birimi ekler", () => {
    expect(formatState(ent("sensor.g", "52.81", { unit_of_measurement: "W" }))).toBe("52,8 W");
    expect(formatState(ent("sensor.e", "2.1416", { unit_of_measurement: "kWh" }))).toBe("2,14 kWh");
  });
  it("durumları Türkçeleştirir", () => {
    expect(formatState(ent("switch.a", "on"))).toBe("Açık");
    expect(formatState(ent("switch.a", "unavailable"))).toBe("Erişilemiyor");
  });
});

describe("extraInfo", () => {
  const { entities, reg } = sample();
  const devices = buildDevices(entities, reg);
  it("lamba için parlaklık ve sıcaklık gösterir", () => {
    const m = devices.find((d) => d.name === "Masa Lambası")!;
    expect(extraInfo(m)).toEqual(["%50 parlaklık", "21,5 °C"]);
  });
  it("priz için güç gösterir", () => {
    expect(extraInfo(devices.find((d) => d.name === "3D Yazıcı 1")!)).toEqual(["52,8 W"]);
  });
  it("erişilemeyen cihazda ek bilgi uydurmaz", () => {
    expect(extraInfo(devices.find((d) => d.name === "Klima")!)).toEqual([]);
  });
});
