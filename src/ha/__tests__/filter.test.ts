import { describe, expect, it } from "vitest";
import { buildDevices } from "../devices";
import { filterDevices, groupByArea, matchesQuery, sortDevices } from "../filter";
import { sample } from "./fixtures";

const { entities, reg } = sample();
const devices = buildDevices(entities, reg);
const names = (l: { name: string }[]) => l.map((d) => d.name).sort();

describe("arama", () => {
  it("cihaz adı, oda, varlık kimliği ve tür ile bulur", () => {
    expect(names(filterDevices(devices, "yazıcı", "all", []))).toEqual(["3D Yazıcı 1"]);
    expect(names(filterDevices(devices, "oturma", "all", []))).toEqual(["Klima", "Salon Sıcaklık"]);
    expect(names(filterDevices(devices, "light.masa", "all", []))).toEqual(["Masa Lambası"]);
    expect(names(filterDevices(devices, "ışık", "all", []))).toEqual(["Masa Lambası"]);
  });
  it("birden çok kelimede hepsini arar", () => {
    const d = devices.find((x) => x.name === "Masa Lambası")!;
    expect(matchesQuery(d, "atölye masa")).toBe(true);
    expect(matchesQuery(d, "atölye klima")).toBe(false);
  });
});

describe("filtreler", () => {
  it("açık / kapalı / erişilemeyen / favoriler", () => {
    expect(names(filterDevices(devices, "", "on", []))).toEqual(["3D Yazıcı 1", "Masa Lambası"]);
    expect(names(filterDevices(devices, "", "unavailable", []))).toEqual(["Klima"]);
    // Erişilemeyen cihaz "kapalı" sayılmaz
    expect(names(filterDevices(devices, "", "off", []))).not.toContain("Klima");
    const fav = devices.find((d) => d.name === "Masa Lambası")!.key;
    expect(names(filterDevices(devices, "", "favorites", [fav]))).toEqual(["Masa Lambası"]);
  });
  it("arama ve filtre birlikte çalışır", () => {
    expect(filterDevices(devices, "klima", "on", [])).toHaveLength(0);
  });
});

describe("sıralama ve gruplama", () => {
  it("erişilemeyenleri sona koyar", () => {
    const s = sortDevices(devices);
    expect(s[s.length - 1].name === "Klima" || s.findIndex((d) => d.name === "Klima") > s.findIndex((d) => d.name === "Masa Lambası")).toBe(true);
  });
  it("odaları alfabetik, Odasız'ı en sonda verir", () => {
    const g = groupByArea(devices).map(([a]) => a);
    expect(g[0]).toBe("Atölye");
    expect(g[g.length - 1]).toBe("Odasız");
  });
});
