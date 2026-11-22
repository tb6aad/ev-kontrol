import { describe, expect, it } from "vitest";
import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import { presence } from "../presence";
import { ent } from "./fixtures";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const at = (e: HassEntity, iso: string) => ({ ...e, last_updated: iso, last_changed: iso });
const map = (...l: HassEntity[]): HassEntities => Object.fromEntries(l.map((e) => [e.entity_id, e]));

const person = (state: string) =>
  ent("person.ali_veli", state, { friendly_name: "Ali Veli", source: "device_tracker.ali_telefon" });
const gps = (state: string, iso: string) => at(ent("device_tracker.ali_telefon", state, { source_type: "gps" }), iso);

describe("presence", () => {
  it("güncel GPS ve evde değil → Dışarıda", () => {
    const p = presence(map(at(person("not_home"), "2026-11-22T11:00:00Z"), gps("not_home", "2026-11-22T11:50:00Z")), NOW);
    expect(p.value).toBe("Dışarıda");
    expect(p.muted).toBe(false);
  });
  it("GPS 6 saatten eskiyse Dışarıda demez", () => {
    const p = presence(map(person("not_home"), gps("not_home", "2026-11-11T18:30:00Z")), NOW);
    expect(p.value).toBe("Konum güncel değil");
    expect(p.muted).toBe(true);
    expect(p.sub).toContain("Ali");
  });
  it("güncel GPS ve evde → Evde", () => {
    expect(presence(map(person("home"), gps("home", "2026-11-22T10:00:00Z")), NOW).value).toBe("Evde");
  });
  it("GPS olmayan izleyicide eskilik uygulanmaz", () => {
    const router = at(ent("device_tracker.ali_telefon", "home", { source_type: "router" }), "2026-11-01T00:00:00Z");
    expect(presence(map(person("home"), router), NOW).value).toBe("Evde");
  });
  it("biri güncel evde, diğerinin konumu eski → Evde ve not", () => {
    const ayse = ent("person.ayse", "not_home", { friendly_name: "Ayşe", source: "device_tracker.ayse_tel" });
    const ayseTel = at(ent("device_tracker.ayse_tel", "not_home", { source_type: "gps" }), "2026-11-10T00:00:00Z");
    const p = presence(map(person("home"), gps("home", "2026-11-22T11:00:00Z"), ayse, ayseTel), NOW);
    expect(p.value).toBe("Evde");
    expect(p.sub).toContain("Ayşe: konum güncel değil");
  });
});
