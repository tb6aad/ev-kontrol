import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import type { Registries } from "./client";
import type { AutomationConfig } from "./automations";
import { t, tk } from "../i18n";

/* ================= Keşif ================= */

export type SlotKind = "press" | "scroll" | "dial";

export interface Slot {
  /** "<entity_id>|<event_type>" — çevirme slotlarında event_type "*" */
  key: string;
  entityId: string;
  eventType: string; // "*" = her olay (çevirme)
  kind: SlotKind;
  label: string;
  /** scroll için yön: +1 sağ/yukarı, -1 sol/aşağı */
  dir?: 1 | -1;
}

export interface Channel {
  label: string;
  slots: Slot[];
}

export interface SmartButton {
  deviceId: string;
  name: string;
  model: string;
  area: string;
  entityIds: string[];
  channels: Channel[];
  battery?: HassEntity;
}

const TYPE_LABELS: Record<string, string> = {
  multi_press_1: tk("Tek bas"),
  multi_press_2: tk("Çift bas"),
  multi_press_3: tk("Üç kez bas"),
  multi_press_4: tk("Dört kez bas"),
  long_press: tk("Uzun bas"),
  single_click: tk("Tek tık"),
  single: tk("Tek tık"),
  double_click: tk("Çift tık"),
  double: tk("Çift tık"),
  triple_click: tk("Üç tık"),
  long_click: tk("Uzun bas"),
  hold: tk("Basılı tut"),
  press: tk("Bas"),
};

/** Bu olay türleri ayrı bir eylem olarak gösterilmez. */
const SKIP_TYPES = new Set(["long_release", "release", "short_release", "rotation_stop", "initial_press"]);

const typeLabel = (ty: string) => (TYPE_LABELS[ty] ? t(TYPE_LABELS[ty]) : ty.replace(/_/g, " "));

function classify(e: HassEntity): SlotKind {
  const types = (e.attributes.event_types as string[]) ?? [];
  if (types.includes("rotation") || "degrees" in e.attributes) return "dial";
  // Matter kaydırma tekerleri: yalnızca multi_press_N (çok adım), uzun basma yok
  if (types.length >= 5 && types.every((t) => /^multi_press_\d+$/.test(t))) return "scroll";
  return "press";
}

const trailingNum = (id: string) => Number(id.match(/(\d+)$/)?.[1] ?? 0);

export function discoverButtons(entities: HassEntities, reg: Registries): SmartButton[] {
  const entReg = new Map(reg.entities.map((e) => [e.entity_id, e]));
  const devices = new Map(reg.devices.map((d) => [d.id, d]));
  const areaName = new Map(reg.areas.map((a) => [a.area_id, a.name]));

  const byDevice = new Map<string, HassEntity[]>();
  for (const e of Object.values(entities)) {
    if (!e.entity_id.startsWith("event.")) continue;
    const types = (e.attributes.event_types as string[]) ?? [];
    const isButton =
      e.attributes.device_class === "button" ||
      types.some((t) => /press|click|rotation|single|double|hold/.test(t));
    if (!isButton) continue;
    const devId = entReg.get(e.entity_id)?.device_id;
    if (!devId) continue;
    if (!byDevice.has(devId)) byDevice.set(devId, []);
    byDevice.get(devId)!.push(e);
  }

  const out: SmartButton[] = [];
  for (const [devId, list] of byDevice) {
    const dev = devices.get(devId);
    list.sort((a, b) => trailingNum(a.entity_id) - trailingNum(b.entity_id) || a.entity_id.localeCompare(b.entity_id));

    // Kanal oluştur: kaydırma girişleri bir basma girişiyle kapanır (BILRESA: sağ, sol, bas)
    const channels: Channel[] = [];
    let pendingScroll: HassEntity[] = [];
    const pressSlots = (e: HassEntity): Slot[] =>
      ((e.attributes.event_types as string[]) ?? [])
        .filter((t) => !SKIP_TYPES.has(t))
        .map((t) => ({ key: `${e.entity_id}|${t}`, entityId: e.entity_id, eventType: t, kind: "press", label: typeLabel(t) }));
    const scrollSlots = (arr: HassEntity[]): Slot[] =>
      arr.map((e, i) => ({
        key: `${e.entity_id}|*`,
        entityId: e.entity_id,
        eventType: "*",
        kind: "scroll",
        label: arr.length === 2 ? (i === 0 ? t("Sağa çevir") : t("Sola çevir")) : t("Çevir ({n})", { n: i + 1 }),
        dir: i === 0 ? 1 : -1,
      }));

    const hasScroll = list.some((e) => classify(e) === "scroll");
    for (const e of list) {
      const k = classify(e);
      if (k === "scroll") {
        pendingScroll.push(e);
      } else if (k === "dial") {
        channels.push({
          label: t("Çevirme"),
          slots: [{ key: `${e.entity_id}|*`, entityId: e.entity_id, eventType: "*", kind: "dial", label: t("Çevir (sağ = artır, sol = azalt)") }],
        });
      } else {
        const slots = [...scrollSlots(pendingScroll), ...pressSlots(e)];
        pendingScroll = [];
        channels.push({ label: hasScroll ? t("Kanal {n}", { n: channels.length + 1 }) : t("Düğme"), slots });
      }
    }
    if (pendingScroll.length) channels.push({ label: `Kanal ${channels.length + 1}`, slots: scrollSlots(pendingScroll) });

    // Pil sensörü (varsa)
    const battery = Object.values(entities).find(
      (x) =>
        entReg.get(x.entity_id)?.device_id === devId &&
        (x.attributes.device_class === "battery") &&
        (x.entity_id.startsWith("sensor.") || x.entity_id.startsWith("binary_sensor.")),
    );

    const areaId = dev?.area_id ?? entReg.get(list[0].entity_id)?.area_id ?? null;
    out.push({
      deviceId: devId,
      name: dev?.name_by_user || dev?.name || list[0].entity_id,
      model: dev?.model ?? "",
      area: (areaId && areaName.get(areaId)) || t("Odasız"),
      entityIds: list.map((e) => e.entity_id),
      channels,
      battery,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/* ================= Atama modeli ================= */

export type PressAction = "toggle" | "on" | "off" | "run";
export type TurnAction = "brightness" | "volume";

export interface Assignment {
  action: PressAction | TurnAction | "custom";
  target: string;
  /** Yalnızca "custom": orijinal eylem adımları (olduğu gibi korunur) */
  sequence?: unknown[];
  /** Yalnızca "custom": ekranda gösterilecek kısa açıklama */
  label?: string;
}

export type Mapping = Record<string, Assignment>; // slot.key → atama

export const MARKER = "ev_kontrol_dugme";

export const automationIdFor = (deviceId: string) => `ev_kontrol_dugme_${deviceId.slice(0, 12)}`;

/**
 * Uygulamanın ürettiği otomasyondan atamaları geri okur.
 * Özel eylemlerin adımları "variables" içinde değil (HA onları şablon olarak işler),
 * choose seçeneğinin kendisinden geri alınır.
 */
export function readMapping(config: AutomationConfig | undefined): Mapping | null {
  const m = config?.variables?.[MARKER];
  if (!m || typeof m !== "object") return null;
  const slots = (m.slots ?? {}) as Record<string, Assignment & { option?: number }>;
  const options = asArr(asArr(config?.actions ?? config?.action)[0]?.choose);
  const out: Mapping = {};
  for (const [k, a] of Object.entries(slots)) {
    if (a.action === "custom") {
      out[k] = { action: "custom", target: a.target ?? "", label: a.label, sequence: options[a.option ?? -1]?.sequence ?? [] };
    } else {
      out[k] = { action: a.action, target: a.target };
    }
  }
  return out;
}

const asArr = (x: any): any[] => (x == null ? [] : Array.isArray(x) ? x : [x]); // eslint-disable-line @typescript-eslint/no-explicit-any

const objId = (entityId: string) => entityId.split(".")[1];

function pressSequence(a: Assignment) {
  const domain = a.target.split(".")[0];
  if (a.action === "run") {
    return [{ action: domain === "scene" ? "scene.turn_on" : domain === "script" ? "script.turn_on" : "homeassistant.turn_on", target: { entity_id: a.target } }];
  }
  const svc = a.action === "on" ? "turn_on" : a.action === "off" ? "turn_off" : "toggle";
  return [{ action: `homeassistant.${svc}`, target: { entity_id: a.target } }];
}

/** Adım (yüzde) şablonu: scroll → multi_press_N × 5, dial → derece / 3; ±50 ile sınırlı. */
function stepTemplate(slot: Slot) {
  if (slot.kind === "dial") {
    return "{{ [[ ((trigger.to_state.attributes.degrees | float(0)) / 3) | round(0) | int, 50 ] | min, -50 ] | max }}";
  }
  const sign = slot.dir === -1 ? "-" : "";
  return `{{ ${sign}([ (trigger.to_state.attributes.get('event_type','') | regex_findall('\\\\d+') | first | default(1) | int) * 5, 50 ] | min) }}`;
}

function turnSequence(slot: Slot, a: Assignment) {
  const step = stepTemplate(slot);
  if (a.action === "volume") {
    return [
      { variables: { adim: step } },
      {
        action: "media_player.volume_set",
        target: { entity_id: a.target },
        data: {
          volume_level: `{{ [[ (state_attr('${a.target}', 'volume_level') | float(0)) + (adim | float(0)) / 100, 0 ] | max, 1 ] | min }}`,
        },
      },
    ];
  }
  // Parlaklık: brightness_step_pct 0'a inince ışık kendiliğinden kapanır, kapalıyken artırınca açılır
  return [{ action: "light.turn_on", target: { entity_id: a.target }, data: { brightness_step_pct: step } }];
}

const DESC_PRESS: Record<string, string> = { toggle: tk("aç/kapat"), on: tk("aç"), off: tk("kapat"), run: tk("çalıştır") };

export function buildAutomation(
  btn: SmartButton,
  mapping: Mapping,
  names: (id: string) => string,
): AutomationConfig {
  const slots = btn.channels.flatMap((c) => c.slots);
  const used = slots.filter((s) => mapping[s.key]?.target);
  const usedEntities = [...new Set(used.map((s) => s.entityId))];

  const options = used.map((s) => {
    const a = mapping[s.key];
    const conditions: unknown[] = [{ condition: "trigger", id: objId(s.entityId) }];
    if (s.eventType !== "*") {
      conditions.push({ condition: "template", value_template: `{{ trigger.to_state.attributes.get('event_type') == '${s.eventType}' }}` });
    }
    const sequence =
      a.action === "custom" ? a.sequence ?? [] : s.kind === "press" ? pressSequence(a) : turnSequence(s, a);
    return { conditions, sequence };
  });

  const summary = used
    .map((s) => {
      const a = mapping[s.key];
      const ch = btn.channels.find((c) => c.slots.includes(s));
      const prefix = ch && btn.channels.length > 1 ? `${ch.label} ` : "";
      if (a.action === "custom") return `${prefix}${s.label.toLocaleLowerCase("tr")} = ${a.label ?? t("özel eylem")}`;
      const verb = a.action === "brightness" ? t("parlaklık") : a.action === "volume" ? t("ses") : t(DESC_PRESS[a.action]);
      return `${prefix}${s.label.toLocaleLowerCase("tr")} = ${names(a.target)} ${verb}`;
    })
    .join("; ");

  // variables'a yalnızca şablon içermeyen özet yazılır; özel adımlar choose'dan geri okunur
  const stored = Object.fromEntries(
    used.map((s, i) => {
      const a = mapping[s.key];
      return [s.key, a.action === "custom" ? { action: "custom", target: a.target, label: a.label ?? "", option: i } : { action: a.action, target: a.target }];
    }),
  );

  return {
    id: automationIdFor(btn.deviceId),
    alias: `${t("Düğme")} – ${btn.name} (Ev Kontrol)`,
    description: `${t("Ev Kontrol uygulamasının Akıllı Düğmeler sayfasında oluşturuldu.")} ${summary || t("Atama yok.")}`,
    mode: "queued",
    max: 20,
    max_exceeded: "silent",
    variables: { [MARKER]: { version: 1, device_id: btn.deviceId, slots: stored } },
    triggers: usedEntities.map((id) => ({
      trigger: "state",
      entity_id: id,
      not_from: ["unavailable"],
      not_to: ["unavailable", "unknown"],
      id: objId(id),
    })),
    conditions: [],
    actions: [{ choose: options }],
  };
}

/** Bir otomasyon yapılandırması bu düğmenin olay varlıklarından birine dokunuyor mu? */
export function referencesButton(config: AutomationConfig, btn: SmartButton) {
  const s = JSON.stringify(config.triggers ?? config.trigger ?? []);
  return btn.entityIds.some((id) => s.includes(`"${id}"`));
}

/* ================= Mevcut (elle yazılmış) otomasyonları çözümleme ================= */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Derived {
  mapping: Mapping;
  /** slot.key → atamanın geldiği otomasyonun adı */
  sources: Record<string, string>;
  /** Eşlenemeyen dallar: otomasyon adı → açıklamalar */
  unmapped: Record<string, string[]>;
}

const EVENT_TYPE_RE = /'(multi_press_\d+|long_press|long_release|single_click|double_click|triple_click|long_click|single|double|hold|press)'/g;
const COUNT_RE = /\b(?:adet|tik|count|sayi|clicks?)\s*(==|>=)\s*(\d+)/;
const IGNORED_DOMAINS = new Set(["counter", "timer", "input_number", "input_text", "logbook", "system_log"]);

interface Ctx {
  triggerIds: Set<string> | null;
  eventTypes: Set<string> | null;
  count: number | null;
}

function parseConditions(conds: any, ctx: Ctx): Ctx {
  const out: Ctx = {
    triggerIds: ctx.triggerIds ? new Set(ctx.triggerIds) : null,
    eventTypes: ctx.eventTypes ? new Set(ctx.eventTypes) : null,
    count: ctx.count,
  };
  for (const c of asArr(conds)) {
    if (typeof c === "string") continue;
    if (c.condition === "trigger") {
      out.triggerIds = new Set(asArr(c.id).map(String));
    } else if (c.condition === "template" || typeof c.value_template === "string") {
      const t = String(c.value_template ?? "");
      const types = [...t.matchAll(EVENT_TYPE_RE)].map((m) => m[1]);
      if (types.length) out.eventTypes = new Set(types);
      const cm = t.match(COUNT_RE);
      if (cm) out.count = Number(cm[2]);
    }
  }
  return out;
}

/** Adımlardaki servis çağrılarını (iç içe if/choose dahil) toplar. */
function collectCalls(steps: any[]): any[] {
  const calls: any[] = [];
  const visit = (s: any) => {
    if (!s || typeof s !== "object") return;
    const svc = s.action ?? s.service;
    if (typeof svc === "string" && svc.includes(".")) {
      if (!IGNORED_DOMAINS.has(svc.split(".")[0])) calls.push(s);
      return;
    }
    for (const k of ["then", "else", "sequence", "default"]) if (s[k]) asArr(s[k]).forEach(visit);
    if (s.choose) asArr(s.choose).forEach((o: any) => asArr(o.sequence).forEach(visit));
    if (s.repeat?.sequence) asArr(s.repeat.sequence).forEach(visit);
    if (s.parallel) asArr(s.parallel).forEach(visit);
  };
  steps.forEach(visit);
  return calls;
}

const targetOf = (call: any): string => {
  const t = call.target?.entity_id ?? call.entity_id ?? call.data?.entity_id;
  return String(asArr(t)[0] ?? "");
};

const DATA_HINTS: [string[], string][] = [
  [["hs_color", "rgb_color", "xy_color", "rgbw_color"], tk("renk değiştir")],
  [["color_temp_kelvin", "color_temp", "kelvin"], tk("beyaz tonu")],
  [["effect"], tk("efekt")],
  [["brightness_pct", "brightness", "brightness_step_pct"], tk("parlaklık")],
];

function customLabel(calls: any[], names: (id: string) => string) {
  const c = calls[0];
  const svc = String(c.action ?? c.service);
  const keys = Object.keys(c.data ?? {});
  const hint = DATA_HINTS.find(([ks]) => ks.some((k) => keys.includes(k)))?.[1];
  const tgt = targetOf(c);
  const who = tgt ? names(tgt) : svc;
  const extra = calls.length > 1 ? ` +${calls.length - 1}` : "";
  return `${who}: ${hint ? t(hint) : svc.split(".")[1].replace(/_/g, " ")}${extra}`;
}

function classifyEffect(slot: Slot, seq: any[], prelude: any[], names: (id: string) => string): Assignment | null {
  const calls = collectCalls(seq);
  if (calls.length === 0) return null;
  const first = calls[0];
  const svc = String(first.action ?? first.service);
  const [dom, name] = svc.split(".");
  const tgt = targetOf(first);
  const custom = (): Assignment => ({
    action: "custom",
    target: tgt,
    label: customLabel(calls, names),
    sequence: [...prelude, ...seq],
  });

  if (slot.kind !== "press") {
    const hasBrightness = calls.some(
      (c) => String(c.action ?? c.service).startsWith("light.") && c.data && ["brightness_step_pct", "brightness_pct", "brightness_step"].some((k) => k in c.data),
    );
    if (hasBrightness && tgt) return { action: "brightness", target: tgt };
    if (dom === "media_player" && name.startsWith("volume")) return { action: "volume", target: tgt };
    return custom();
  }

  // Tek, verisiz, düz bir çağrı → basit eylem; diğer her şey özel
  const plain = calls.length === 1 && seq.length === 1 && !!(seq[0].action ?? seq[0].service) && !Object.keys(first.data ?? {}).length;
  if (plain && tgt) {
    if (dom === "scene" || dom === "script") return { action: "run", target: tgt };
    if (name === "toggle") return { action: "toggle", target: tgt };
    if (name === "turn_on") return { action: "on", target: tgt };
    if (name === "turn_off") return { action: "off", target: tgt };
  }
  return custom();
}

const COUNT_TYPES: Record<number, string[]> = {
  1: ["multi_press_1", "single_click", "single", "press"],
  2: ["multi_press_2", "double_click", "double"],
  3: ["multi_press_3", "triple_click"],
};

export function deriveMapping(
  btn: SmartButton,
  autos: { name: string; enabled: boolean; config: AutomationConfig | undefined }[],
  names: (id: string) => string,
): Derived {
  const slots = btn.channels.flatMap((c) => c.slots);
  const result: Derived = { mapping: {}, sources: {}, unmapped: {} };

  for (const a of autos) {
    const cfg = a.config;
    if (!a.enabled || !cfg) continue;

    // Tetikleyici id → varlıklar
    const trigById = new Map<string, string[]>();
    const allEntities: string[] = [];
    for (const t of asArr(cfg.triggers ?? cfg.trigger)) {
      const ids = asArr(t.entity_id).map(String).filter((id) => btn.entityIds.includes(id));
      if (!ids.length) continue;
      allEntities.push(...ids);
      if (t.id != null) trigById.set(String(t.id), [...(trigById.get(String(t.id)) ?? []), ...ids]);
    }
    if (!allEntities.length) continue;

    const prelude: any[] = [];
    const branches: { ctx: Ctx; seq: any[] }[] = [];
    const main: any[] = [];
    const base: Ctx = { triggerIds: null, eventTypes: null, count: null };

    for (const step of asArr(cfg.actions ?? cfg.action)) {
      if (step.variables) {
        prelude.push(step);
      } else if (step.choose) {
        for (const opt of asArr(step.choose)) branches.push({ ctx: parseConditions(opt.conditions, base), seq: asArr(opt.sequence) });
      } else if (step.if) {
        const ctx = parseConditions(step.if, base);
        if (ctx.eventTypes || ctx.count != null || ctx.triggerIds) branches.push({ ctx, seq: asArr(step.then) });
        else main.push(step);
      } else {
        main.push(step);
      }
    }
    if (collectCalls(main).length) branches.push({ ctx: base, seq: main });

    for (const br of branches) {
      const calls = collectCalls(br.seq);
      if (calls.length === 0) continue; // sayaç vb. yardımcı dallar
      const ents = br.ctx.triggerIds ? [...br.ctx.triggerIds].flatMap((id) => trigById.get(id) ?? []) : allEntities;
      let targets = slots.filter((s) => ents.includes(s.entityId));
      if (br.ctx.eventTypes) {
        targets = targets.filter((s) => s.eventType !== "*" && br.ctx.eventTypes!.has(s.eventType));
      } else if (br.ctx.count != null) {
        const types = COUNT_TYPES[br.ctx.count] ?? [`multi_press_${br.ctx.count}`];
        targets = targets.filter((s) => types.includes(s.eventType));
      } else {
        targets = targets.filter((s) => s.eventType === "*");
      }

      if (targets.length === 0) {
        const desc = customLabel(calls, names) + (br.ctx.count != null ? ` (${t("{n} tık", { n: br.ctx.count })})` : "");
        (result.unmapped[a.name] ??= []).push(desc);
        continue;
      }
      for (const s of targets) {
        if (result.mapping[s.key]) continue; // ilk bulunan kazanır
        const asg = classifyEffect(s, br.seq, prelude, names);
        if (!asg) continue;
        result.mapping[s.key] = asg;
        result.sources[s.key] = a.name;
      }
    }
  }
  return result;
}
