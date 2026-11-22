import { describe, expect, it } from "vitest";
import type { HassEntities } from "home-assistant-js-websocket";
import type { Registries } from "../client";
import { discoverCameras, isCameraOnline, mjpegUrl, snapshotUrl } from "../cameras";
import { ent } from "./fixtures";

const entities: HassEntities = {
  "camera.yatak_kamerasi_hd_stream": ent("camera.yatak_kamerasi_hd_stream", "idle", { friendly_name: "Yatak Odası Kamerası HD Stream", access_token: "abc" }),
  "camera.yatak_kamerasi_sd_stream": ent("camera.yatak_kamerasi_sd_stream", "unavailable", { friendly_name: "Yatak Odası Kamerası SD Stream" }),
  "switch.yatak_kamerasi_privacy": ent("switch.yatak_kamerasi_privacy", "off", { friendly_name: "Privacy" }),
};
const reg: Registries = {
  areas: [{ area_id: "yatak", name: "Yatak odası" }],
  devices: [{ id: "cam1", area_id: "yatak", name: "Tapo_C100", name_by_user: null }],
  entities: Object.keys(entities).map((id) => ({ entity_id: id, device_id: "cam1", area_id: null, hidden_by: null, disabled_by: null, entity_category: null })),
};

describe("discoverCameras", () => {
  const cams = discoverCameras(entities, reg);
  it("aynı cihazın HD/SD akışlarını tek kamerada toplar, HD önce", () => {
    expect(cams).toHaveLength(1);
    expect(cams[0].streams.map((s) => s.label)).toEqual(["HD", "SD"]);
    expect(cams[0].area).toBe("Yatak odası");
    expect(cams[0].privacy?.entity_id).toBe("switch.yatak_kamerasi_privacy");
  });
  it("akış son ekini addan atar", () => {
    expect(cams[0].name).toBe("Yatak Odası Kamerası");
  });
  it("erişilemeyen ya da jetonsuz akışı çevrimdışı sayar", () => {
    expect(isCameraOnline(cams[0].streams[0].entity)).toBe(true);
    expect(isCameraOnline(cams[0].streams[1].entity)).toBe(false);
  });
  it("vekil adreslerini kamera jetonuyla kurar", () => {
    const e = cams[0].streams[0].entity;
    expect(mjpegUrl("http://ha.local/", e)).toBe("http://ha.local/api/camera_proxy_stream/camera.yatak_kamerasi_hd_stream?token=abc");
    expect(snapshotUrl("http://ha.local", e, 5)).toBe("http://ha.local/api/camera_proxy/camera.yatak_kamerasi_hd_stream?token=abc&t=5");
  });
});
