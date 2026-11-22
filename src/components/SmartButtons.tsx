import { useEffect, useMemo, useRef, useState } from "react";
import { useAppVisible } from "../state/desktop";
import type { Connection, HassEntities } from "home-assistant-js-websocket";
import type { Registries } from "../ha/client";
import {
  AutomationConfig, deleteAutomation, getConfig, listAutomations, saveAutomation, setEnabled,
} from "../ha/automations";
import {
  Assignment, Mapping, Slot, SmartButton, automationIdFor, buildAutomation, deriveMapping, discoverButtons,
  readMapping, referencesButton,
} from "../ha/buttons";
import { formatState } from "../ha/devices";
import Toggle from "./Toggle";
import Icon from "../ui/Icon";

interface Props {
  conn: Connection;
  entities: HassEntities;
  registries: Registries;
  baseUrl: string;
  token: string;
}

const PRESS_ACTIONS: { value: string; label: string; domains: string[] }[] = [
  { value: "toggle", label: "Aç / kapat", domains: ["light", "switch", "fan", "input_boolean", "media_player", "cover", "climate", "siren"] },
  { value: "on", label: "Aç", domains: ["light", "switch", "fan", "input_boolean", "media_player", "cover", "climate", "siren"] },
  { value: "off", label: "Kapat", domains: ["light", "switch", "fan", "input_boolean", "media_player", "cover", "climate", "siren"] },
  { value: "run", label: "Sahne / script çalıştır", domains: ["scene", "script"] },
];
const TURN_ACTIONS: { value: string; label: string; domains: string[] }[] = [
  { value: "brightness", label: "Işık parlaklığı", domains: ["light"] },
  { value: "volume", label: "Ses seviyesi", domains: ["media_player"] },
];

interface LastPress {
  entityId: string;
  eventType: string;
  at: number;
}

export default function SmartButtons({ conn, entities, registries, baseUrl, token }: Props) {
  const buttons = useMemo(() => discoverButtons(entities, registries), [entities, registries]);
  const [selected, setSelected] = useState<string | null>(null);
  const btn = buttons.find((b) => b.deviceId === selected) ?? buttons[0];

  // Tüm otomasyon yapılandırmaları (çakışmaları ve bizim ürettiğimizi bulmak için)
  const autos = useMemo(() => listAutomations(entities), [entities]);
  const [configs, setConfigs] = useState<Record<string, AutomationConfig>>({});
  const [reloadTick, setReloadTick] = useState(0);
  const autoKey = autos.map((a) => a.entityId).join(",");
  useEffect(() => {
    let alive = true;
    Promise.all(autos.map((a) => getConfig(conn, a.entityId).then((c) => [a.entityId, c] as const).catch(() => null))).then(
      (res) => {
        if (!alive) return;
        const m: Record<string, AutomationConfig> = {};
        for (const r of res) if (r) m[r[0]] = r[1];
        setConfigs(m);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, autoKey, reloadTick]);

  // Canlı basış algılama: olay varlığının durumu (zaman damgası) değişince
  const prev = useRef<Record<string, string>>({});
  const [lastPress, setLastPress] = useState<Record<string, LastPress>>({});
  useEffect(() => {
    const updates: Record<string, LastPress> = {};
    for (const b of buttons) {
      for (const id of b.entityIds) {
        const e = entities[id];
        if (!e) continue;
        const before = prev.current[id];
        prev.current[id] = e.state;
        if (before !== undefined && before !== e.state && e.state !== "unavailable" && e.state !== "unknown") {
          updates[b.deviceId] = { entityId: id, eventType: String(e.attributes.event_type ?? ""), at: Date.now() };
        }
      }
    }
    if (Object.keys(updates).length) setLastPress((p) => ({ ...p, ...updates }));
  }, [entities, buttons]);

  if (buttons.length === 0) {
    return <div className="placeholder">Home Assistant'ta akıllı düğme bulunamadı.</div>;
  }

  return (
    <div className="buttons-page">
      {buttons.length > 1 && (
        <div className="chips tabs">
          {buttons.map((b) => (
            <button key={b.deviceId} className={b.deviceId === btn.deviceId ? "active" : ""} onClick={() => setSelected(b.deviceId)}>
              {b.name} <span className="muted small">· {b.area}</span>
            </button>
          ))}
        </div>
      )}
      <ButtonEditor
        key={btn.deviceId}
        btn={btn}
        conn={conn}
        entities={entities}
        registries={registries}
        configs={configs}
        autos={autos}
        lastPress={lastPress[btn.deviceId]}
        baseUrl={baseUrl}
        token={token}
        onSaved={() => setReloadTick((t) => t + 1)}
      />
    </div>
  );
}

/* ============== Tek düğme düzenleyici ============== */

interface EditorProps {
  btn: SmartButton;
  conn: Connection;
  entities: HassEntities;
  registries: Registries;
  configs: Record<string, AutomationConfig>;
  autos: ReturnType<typeof listAutomations>;
  lastPress: LastPress | undefined;
  baseUrl: string;
  token: string;
  onSaved: () => void;
}

function ButtonEditor({ btn, conn, entities, registries, configs, autos, lastPress, baseUrl, token, onSaved }: EditorProps) {
  const managedId = automationIdFor(btn.deviceId);
  const managedAuto = autos.find((a) => a.configId === managedId);
  const managedCfg = managedAuto ? configs[managedAuto.entityId] : undefined;
  const names = (id: string) => (entities[id]?.attributes.friendly_name as string) || id;

  // Bu düğmeyi kullanan, bizim üretmediğimiz otomasyonlar
  const others = autos.filter((a) => a.configId !== managedId && configs[a.entityId] && referencesButton(configs[a.entityId], btn));

  // Ev Kontrol otomasyonu yoksa mevcut (açık) otomasyonlardan atamaları çıkar
  const derived = useMemo(
    () =>
      deriveMapping(
        btn,
        others.map((o) => ({ name: o.name, enabled: o.enabled, config: configs[o.entityId] })),
        names,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [btn, others.map((o) => `${o.entityId}:${o.enabled}`).join(","), configs],
  );
  const fromExisting = !managedAuto && Object.keys(derived.mapping).length > 0;
  const saved = useMemo<Mapping>(
    () => readMapping(managedCfg) ?? (managedAuto ? {} : derived.mapping),
    [managedCfg, managedAuto, derived],
  );

  const [draft, setDraft] = useState<Mapping | null>(null);
  const mapping = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  // Mevcut otomasyonlardan okunanlar değişiklik yapılmadan da Ev Kontrol'e taşınabilir
  const canSave = dirty || fromExisting;

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [disableOthers, setDisableOthers] = useState(true);
  const [, force] = useState(0);

  // "x sn önce" yazısını tazele
  const visible = useAppVisible();
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [visible]);

  // Eşlenemeyen bir eylemi olan otomasyon kapatılırsa o eylem kaybolur → onları açık bırak
  const enabledOthers = others.filter((a) => a.enabled && !derived.unmapped[a.name]);
  const keptOthers = others.filter((a) => a.enabled && derived.unmapped[a.name]);

  // Varlık → oda (seçim listesini gruplamak için)
  const areaOf = useMemo(() => {
    const areaName = new Map(registries.areas.map((a) => [a.area_id, a.name]));
    const devArea = new Map(registries.devices.map((d) => [d.id, d.area_id]));
    const m = new Map<string, string>();
    for (const r of registries.entities) {
      const aid = r.area_id ?? (r.device_id ? devArea.get(r.device_id) : null);
      if (aid && areaName.has(aid)) m.set(r.entity_id, areaName.get(aid)!);
    }
    return m;
  }, [registries]);

  function optionsFor(domains: string[]) {
    const groups = new Map<string, { id: string; name: string }[]>();
    for (const e of Object.values(entities)) {
      if (!domains.includes(e.entity_id.split(".")[0])) continue;
      const area = areaOf.get(e.entity_id) ?? "Odasız";
      if (!groups.has(area)) groups.set(area, []);
      groups.get(area)!.push({ id: e.entity_id, name: names(e.entity_id) });
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === "Odasız" ? 1 : b === "Odasız" ? -1 : a.localeCompare(b, "tr")))
      .map(([area, list]) => [area, list.sort((a, b) => a.name.localeCompare(b.name, "tr"))] as const);
  }

  function update(slot: Slot, a: Partial<Assignment> | null) {
    const next = { ...mapping };
    if (a === null) delete next[slot.key];
    else next[slot.key] = { ...(next[slot.key] ?? { action: slot.kind === "press" ? "toggle" : "brightness", target: "" }), ...a } as Assignment;
    setDraft(next);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const clean: Mapping = Object.fromEntries(Object.entries(mapping).filter(([, a]) => a.target));
      if (Object.keys(clean).length === 0) {
        if (managedAuto) await deleteAutomation(baseUrl, token, managedId);
      } else {
        await saveAutomation(baseUrl, token, buildAutomation(btn, clean, names));
        if (disableOthers) {
          for (const o of enabledOthers) await setEnabled(conn, o.entityId, false);
        }
      }
      setDraft(null);
      setMsg("Kaydedildi. Düğmeye basıp deneyebilirsin.");
      onSaved();
    } catch (e) {
      setMsg(`Hata: ${(e as { message?: string })?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const flashing = (s: Slot) =>
    lastPress &&
    Date.now() - lastPress.at < 2000 &&
    lastPress.entityId === s.entityId &&
    (s.eventType === "*" || s.eventType === lastPress.eventType);

  const lastText = (() => {
    if (!lastPress) return "Hangi tuşun hangisi olduğunu görmek için düğmeye bas.";
    const slot = btn.channels.flatMap((c) => c.slots).find(
      (s) => s.entityId === lastPress.entityId && (s.eventType === "*" || s.eventType === lastPress.eventType),
    );
    const ch = btn.channels.find((c) => slot && c.slots.includes(slot));
    const sec = Math.round((Date.now() - lastPress.at) / 1000);
    return `Son basış: ${ch && btn.channels.length > 1 ? `${ch.label} · ` : ""}${slot?.label ?? lastPress.eventType} · ${sec < 2 ? "şimdi" : `${sec} sn önce`}`;
  })();

  return (
    <div className="btn-editor">
      <header className="btn-head">
        <span className="dcard-icon big"><Icon name="button" size={24} /></span>
        <div>
          <h2>{btn.name}</h2>
          <span className="muted small">
            {btn.area}
            {btn.model && ` · ${btn.model}`}
            {btn.battery && ` · Pil: ${btn.battery.entity_id.startsWith("binary_sensor.") ? (btn.battery.state === "on" ? "zayıf ⚠️" : "iyi") : formatState(btn.battery)}`}
          </span>
        </div>
        <div className={`last-press ${lastPress && Date.now() - lastPress.at < 2000 ? "live" : ""}`}>{lastText}</div>
      </header>

      {btn.channels.map((ch) => (
        <section key={ch.label} className="channel">
          {btn.channels.length > 1 && <h4>{ch.label}</h4>}
          {ch.slots.map((s) => {
            const a = mapping[s.key];
            const actions = s.kind === "press" ? PRESS_ACTIONS : TURN_ACTIONS;
            const actDef = actions.find((x) => x.value === a?.action);
            const isCustom = a?.action === "custom";
            // Orijinal özel eylem (geri dönebilmek için menüde kalır)
            const origCustom = saved[s.key]?.action === "custom" ? saved[s.key] : undefined;
            const src = !managedAuto && derived.sources[s.key];
            return (
              <div key={s.key} className={`slot-row ${flashing(s) ? "flash" : ""}`}>
                <span className="slot-dot" />
                <span className="slot-label">
                  {s.label}
                  {src && <span className="slot-src" title={`"${src}" otomasyonundan okundu`}>↳ {src}</span>}
                </span>
                <select
                  value={a?.action ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return update(s, null);
                    if (v === "custom" && origCustom) {
                      setDraft({ ...mapping, [s.key]: origCustom });
                      return;
                    }
                    const def = actions.find((x) => x.value === v)!;
                    // Hedef yeni eylemin türüne uymuyorsa temizle
                    const keep = a?.target && def.domains.includes(a.target.split(".")[0]);
                    setDraft({ ...mapping, [s.key]: { action: v as Assignment["action"], target: keep ? a!.target : "" } });
                  }}
                >
                  <option value="">— Hiçbir şey —</option>
                  {actions.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                  {origCustom && <option value="custom">Özel eylem (mevcut)</option>}
                </select>
                {isCustom ? (
                  <div className="custom-action" title="Orijinal otomasyondaki eylem olduğu gibi korunur">
                    ✦ {a!.label || "Özel eylem"}
                  </div>
                ) : (
                  <select
                    value={a?.target ?? ""}
                    disabled={!a}
                    onChange={(e) => update(s, { target: e.target.value })}
                    className={a && !a.target ? "needs" : ""}
                  >
                    <option value="">{a ? "Cihaz seç…" : ""}</option>
                    {actDef &&
                      optionsFor(actDef.domains).map(([area, list]) => (
                        <optgroup key={area} label={area}>
                          {list.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                  </select>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {others.length > 0 && (
        <section className="channel">
          <h4>Bu düğmeyi kullanan diğer otomasyonlar</h4>
          {others.map((o) => (
            <div key={o.entityId} className="other-auto">
              <Toggle on={o.enabled} onChange={() => setEnabled(conn, o.entityId, !o.enabled)} />
              <div className="auto-text">
                <span className="auto-name">{o.name}</span>
                {configs[o.entityId]?.description && <span className="other-desc">{configs[o.entityId].description}</span>}
                {o.enabled && derived.unmapped[o.name] && (
                  <span className="other-warn">
                    Buradan ayarlanamayan: {derived.unmapped[o.name].join(", ")} — bu yüzden bu otomasyon açık kalır.
                  </span>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="save-bar">
        {managedAuto && !dirty && <span className="muted small">✓ Kayıtlı · {managedAuto.enabled ? "etkin" : "devre dışı"}</span>}
        {fromExisting && !dirty && (
          <span className="muted small">Seçimler mevcut otomasyonlarından okundu. Değiştirip kaydedebilirsin.</span>
        )}
        {canSave && enabledOthers.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={disableOthers} onChange={(e) => setDisableOthers(e.target.checked)} />
            Çakışmasın diye eski {enabledOthers.length} otomasyonu kapat (silinmez)
          </label>
        )}
        {canSave && keptOthers.length > 0 && (
          <span className="muted small">{keptOthers.length} otomasyon açık kalacak (ayarlanamayan eylemi var).</span>
        )}
        {msg && <span className={msg.startsWith("Hata") ? "error-text" : "ok-text"}>{msg}</span>}
        <span style={{ flex: 1 }} />
        {dirty && (
          <button className="btn-small" disabled={busy} onClick={() => setDraft(null)}>
            Geri al
          </button>
        )}
        <button className="btn-primary" disabled={!canSave || busy} onClick={save}>
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </div>
  );
}
