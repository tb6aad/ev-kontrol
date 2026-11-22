import { useEffect, useRef, useState } from "react";
import type { HassEntity } from "home-assistant-js-websocket";
import { callService } from "home-assistant-js-websocket";
import type { DeviceItem } from "../ha/devices";
import {
  ACTION_DOMAINS, DOMAIN_LABELS, PRESS_DOMAINS, domainOf, formatState, iconName, isOn, isUnavailable, shortName,
} from "../ha/devices";
import { useHa } from "../state/ha";
import { usePrefs } from "../state/prefs";
import Toggle from "../components/Toggle";
import Icon from "./Icon";
import { locale, t, tk } from "../i18n";

interface Props {
  device: DeviceItem;
  onClose: () => void;
}

const COLOR_MODES = ["hs", "rgb", "xy", "rgbw", "rgbww"];
const HVAC_TR: Record<string, string> = {
  off: tk("Kapalı"), heat: tk("Isıtma"), cool: tk("Soğutma"), auto: tk("Otomatik"), dry: tk("Nem alma"), fan_only: tk("Fan"), heat_cool: tk("Isıt/Soğut"),
};

const hexToRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (rgb: number[]) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Kaydırıcı: sürüklerken yerel değer, bırakınca komut (her pikselde komut göndermemek için) */
function Slider({ value, min, max, step = 1, disabled, onCommit, format }: {
  value: number; min: number; max: number; step?: number; disabled?: boolean;
  onCommit: (v: number) => void; format: (v: number) => string;
}) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);
  const commit = () => {
    dragging.current = false;
    if (local !== value) onCommit(local);
  };
  return (
    <div className="slider-row">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        onChange={(e) => {
          dragging.current = true;
          setLocal(Number(e.target.value));
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        aria-valuetext={format(local)}
      />
      <span className="slider-val">{format(local)}</span>
    </div>
  );
}

export default function DeviceDrawer({ device: d, onClose }: Props) {
  const { conn, commands, status } = useHa();
  const { isFavorite, toggleFavorite } = usePrefs();
  const closeRef = useRef<HTMLButtonElement>(null);
  const p = d.primary;
  const dom = domainOf(p.entity_id);
  const offline = status !== "connected";
  const unavailable = isUnavailable(p);
  const disabled = offline || unavailable;
  const busy = commands.pending.has(p.entity_id);
  const a = p.attributes;

  useEffect(() => {
    closeRef.current?.focus();
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const svc = (domain: string, service: string, data: Record<string, unknown> = {}, target = p.entity_id) =>
    callService(conn, domain, service, data, { entity_id: target });
  // Ayar komutları (parlaklık, renk…) başarıda sessiz; değişmezse ya da hata olursa yine bildirilir
  const act = (fn: () => Promise<unknown>, label?: string) => commands.call(p, fn, { label: label ?? d.name, silent: true });

  // Cihazın ölçüm sensörleri (güç, enerji, gerilim, akım…): her sınıftan en kısa adlı olan "ana" ölçüm
  const measure = (dc: string) =>
    d.entities
      .filter((e) => e.entity_id.startsWith("sensor.") && e.attributes.device_class === dc)
      .sort((x, y) => x.entity_id.length - y.entity_id.length)[0];
  const measurements = ["power", "energy", "voltage", "current", "temperature", "humidity", "battery", "illuminance"]
    .map((dc) => [dc, measure(dc)] as const)
    .filter(([, e]) => e);
  const MEAS_TR: Record<string, string> = {
    power: t("Güç"), energy: t("Enerji"), voltage: t("Gerilim"), current: t("Akım"), temperature: t("Sıcaklık"),
    humidity: t("Nem"), battery: t("Pil"), illuminance: t("Aydınlık"),
  };
  const shownIds = new Set([p.entity_id, ...measurements.map(([, e]) => e!.entity_id)]);
  const otherControls = d.entities.filter((e) => !shownIds.has(e.entity_id) && ACTION_DOMAINS.has(domainOf(e.entity_id)));
  const otherInfo = d.entities.filter((e) => !shownIds.has(e.entity_id) && !ACTION_DOMAINS.has(domainOf(e.entity_id)));

  /* ---------- Türüne göre ana kontroller ---------- */
  const modes = (a.supported_color_modes as string[] | undefined) ?? [];
  const capabilities: string[] = [];

  let controls: React.ReactNode = null;
  if (dom === "light") {
    const dimmable = modes.some((m) => m !== "onoff");
    const ct = modes.includes("color_temp");
    const color = modes.some((m) => COLOR_MODES.includes(m));
    if (dimmable) capabilities.push(t("Parlaklık"));
    if (ct) capabilities.push(t("Renk sıcaklığı"));
    if (color) capabilities.push(t("Renk"));
    const bri = typeof a.brightness === "number" ? Math.round(((a.brightness as number) / 255) * 100) : 0;
    const minK = Number(a.min_color_temp_kelvin ?? 2000);
    const maxK = Number(a.max_color_temp_kelvin ?? 6500);
    const kelvin = Number(a.color_temp_kelvin ?? Math.round((minK + maxK) / 2));
    const rgb = (a.rgb_color as number[] | undefined) ?? [255, 200, 120];
    controls = (
      <>
        {dimmable && (
          <div className="ctl">
            <label>{t("Parlaklık")}</label>
            <Slider
              value={p.state === "on" ? bri : 0}
              min={0}
              max={100}
              disabled={disabled}
              format={(v) => (v === 0 ? t("Kapalı") : `%${v}`)}
              onCommit={(v) => act(() => (v === 0 ? svc("light", "turn_off") : svc("light", "turn_on", { brightness_pct: v })))}
            />
          </div>
        )}
        {ct && (
          <div className="ctl">
            <label>{t("Renk sıcaklığı")}</label>
            <Slider
              value={kelvin}
              min={minK}
              max={maxK}
              step={50}
              disabled={disabled}
              format={(v) => `${v} K`}
              onCommit={(v) => act(() => svc("light", "turn_on", { color_temp_kelvin: v }))}
            />
            <div className="ct-scale" />
          </div>
        )}
        {color && (
          <div className="ctl">
            <label>{t("Renk")}</label>
            <div className="color-row">
              <input
                type="color"
                value={rgbToHex(rgb)}
                disabled={disabled}
                onChange={(e) => {
                  const v = hexToRgb(e.target.value);
                  act(() => svc("light", "turn_on", { rgb_color: v }));
                }}
              />
              {[[255, 60, 40], [255, 150, 30], [255, 220, 60], [60, 220, 90], [40, 200, 220], [70, 110, 255], [170, 80, 255], [255, 80, 170]].map((c) => (
                <button
                  key={c.join()}
                  className="swatch"
                  style={{ background: `rgb(${c.join(",")})` }}
                  disabled={disabled}
                  aria-label={`Renk ${rgbToHex(c)}`}
                  onClick={() => act(() => svc("light", "turn_on", { rgb_color: c }))}
                />
              ))}
            </div>
          </div>
        )}
      </>
    );
  } else if (dom === "climate") {
    const hvac = (a.hvac_modes as string[]) ?? [];
    const step = Number(a.target_temp_step ?? 0.5);
    const target = Number(a.temperature ?? NaN);
    const fanModes = (a.fan_modes as string[] | undefined) ?? [];
    capabilities.push(t("Mod"), t("Hedef sıcaklık"), ...(fanModes.length ? [t("Fan modu")] : []));
    controls = (
      <>
        <div className="ctl">
          <label>{t("Çalışma modu")}</label>
          <div className="seg">
            {hvac.map((m) => (
              <button key={m} className={p.state === m ? "active" : ""} disabled={disabled}
                onClick={() => act(() => svc("climate", "set_hvac_mode", { hvac_mode: m }))}>
                {HVAC_TR[m] ? t(HVAC_TR[m]) : m}
              </button>
            ))}
          </div>
        </div>
        {!Number.isNaN(target) && (
          <div className="ctl">
            <label>{t("Hedef sıcaklık · ortam {x}", { x: a.current_temperature != null ? `${a.current_temperature}°` : t("veri yok") })}</label>
            <div className="stepper">
              <button className="icon-btn" disabled={disabled} onClick={() => act(() => svc("climate", "set_temperature", { temperature: target - step }))} aria-label={t("Azalt")}>−</button>
              <span className="stepper-val">{target}°</span>
              <button className="icon-btn" disabled={disabled} onClick={() => act(() => svc("climate", "set_temperature", { temperature: target + step }))} aria-label={t("Artır")}>+</button>
            </div>
          </div>
        )}
        {fanModes.length > 0 && (
          <div className="ctl">
            <label>{t("Fan modu")}</label>
            <select value={String(a.fan_mode ?? "")} disabled={disabled} onChange={(e) => act(() => svc("climate", "set_fan_mode", { fan_mode: e.target.value }))}>
              {fanModes.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        )}
      </>
    );
  } else if (dom === "vacuum") {
    capabilities.push(t("Başlat"), t("Duraklat"), t("İstasyona gönder"));
    controls = (
      <div className="ctl-buttons">
        <button className="btn-primary" disabled={disabled} onClick={() => act(() => svc("vacuum", "start"))}><Icon name="play" size={14} /> {t("Başlat")}</button>
        <button className="btn-small" disabled={disabled} onClick={() => act(() => svc("vacuum", "pause"))}><Icon name="pause" size={14} /> {t("Duraklat")}</button>
        <button className="btn-small" disabled={disabled} onClick={() => act(() => svc("vacuum", "return_to_base"))}><Icon name="dock" size={14} /> {t("Şarja gönder")}</button>
      </div>
    );
  } else if (dom === "cover") {
    capabilities.push(t("Aç|perde"), t("Kapat|perde"), t("Durdur"));
    controls = (
      <>
        <div className="ctl-buttons">
          <button className="btn-small" disabled={disabled} onClick={() => act(() => svc("cover", "open_cover"))}><Icon name="arrowUp" size={14} /> {t("Aç|perde")}</button>
          <button className="btn-small" disabled={disabled} onClick={() => act(() => svc("cover", "stop_cover"))}><Icon name="stop" size={14} /> {t("Durdur")}</button>
          <button className="btn-small" disabled={disabled} onClick={() => act(() => svc("cover", "close_cover"))}><Icon name="arrowDown" size={14} /> {t("Kapat|perde")}</button>
        </div>
        {typeof a.current_position === "number" && (
          <div className="ctl">
            <label>{t("Konum")}</label>
            <Slider value={a.current_position as number} min={0} max={100} disabled={disabled} format={(v) => `%${v}`}
              onCommit={(v) => act(() => svc("cover", "set_cover_position", { position: v }))} />
          </div>
        )}
      </>
    );
  } else if (dom === "media_player") {
    capabilities.push(t("Oynat/Duraklat"), ...(typeof a.volume_level === "number" ? [t("Ses")] : []));
    controls = (
      <>
        <div className="ctl-buttons">
          <button className="btn-small" disabled={disabled} onClick={() => act(() => svc("media_player", "media_play_pause"))}>
            <Icon name={p.state === "playing" ? "pause" : "play"} size={14} /> {p.state === "playing" ? t("Duraklat") : t("Oynat")}
          </button>
        </div>
        {typeof a.volume_level === "number" && (
          <div className="ctl">
            <label>{t("Ses")}</label>
            <Slider value={Math.round((a.volume_level as number) * 100)} min={0} max={100} disabled={disabled} format={(v) => `%${v}`}
              onCommit={(v) => act(() => svc("media_player", "volume_set", { volume_level: v / 100 }))} />
          </div>
        )}
      </>
    );
  } else if (dom === "fan" && typeof a.percentage === "number") {
    capabilities.push(t("Hız"));
    controls = (
      <div className="ctl">
        <label>{t("Hız")}</label>
        <Slider value={a.percentage as number} min={0} max={100} step={Number(a.percentage_step ?? 1)} disabled={disabled}
          format={(v) => `%${Math.round(v)}`} onCommit={(v) => act(() => svc("fan", "set_percentage", { percentage: v }))} />
      </div>
    );
  }

  const mainSwitchable = ACTION_DOMAINS.has(dom) && !PRESS_DOMAINS.has(dom) && !["vacuum", "climate"].includes(dom);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t("{name} ayrıntıları", { name: d.name })} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <span className="dcard-icon big"><Icon name={iconName(p)} size={24} /></span>
          <div className="drawer-title">
            <h2>{d.name}</h2>
            <span className="muted small">{d.area} · {t(DOMAIN_LABELS[dom] ?? dom)}</span>
          </div>
          <button className={`fav-btn ${isFavorite(d.key) ? "active" : ""}`} onClick={() => toggleFavorite(d.key)}
            title={isFavorite(d.key) ? t("Favorilerden çıkar") : t("Favorilere ekle")} aria-pressed={isFavorite(d.key)}>
            <Icon name="star" size={18} filled={isFavorite(d.key)} />
          </button>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label={t("Kapat|pencere")}><Icon name="close" size={18} /></button>
        </header>

        <section className="drawer-status">
          <div>
            <span className="kpi-label">{t("Durum")}</span>
            <span className={`status-big ${isOn(p) ? "on" : ""}`}>{busy ? t("Komut gönderiliyor…") : formatState(p)}</span>
          </div>
          {mainSwitchable && !unavailable && (
            <Toggle on={isOn(p)} busy={busy} disabled={offline} label={d.name} onChange={() => commands.run(p, d.name)} />
          )}
          {dom === "lock" && !unavailable && (
            <button className="btn-small" disabled={offline || busy} onClick={() => commands.run(p, d.name)}>
              {p.state === "locked" ? t("Kilidi aç") : t("Kilitle")}
            </button>
          )}
          {PRESS_DOMAINS.has(dom) && !unavailable && (
            <button className="btn-small" disabled={offline || busy} onClick={() => commands.run(p, d.name)}><Icon name="play" size={14} /> {t("Çalıştır")}</button>
          )}
        </section>
        {offline && <div className="drawer-note warn"><Icon name="alert" size={15} /> {t("Bağlantı yok — gösterilen değerler güncel olmayabilir.")}</div>}
        {unavailable && <div className="drawer-note"><Icon name="info" size={15} /> {t("Cihaz şu an Home Assistant'a yanıt vermiyor.")}</div>}

        {controls && <section className="drawer-sec">{controls}</section>}

        {measurements.length > 0 && (
          <section className="drawer-sec">
            <h4>{t("Ölçümler")}</h4>
            <div className="meas-grid">
              {measurements.map(([dc, e]) => (
                <div key={dc} className="meas">
                  <span className="kpi-label">{MEAS_TR[dc]}</span>
                  <span className="meas-val">{isUnavailable(e!) ? t("Veri yok") : formatState(e!)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {otherControls.length > 0 && (
          <section className="drawer-sec">
            <h4>{t("Diğer kontroller")}</h4>
            {otherControls.map((e) => <EntityRow key={e.entity_id} e={e} deviceName={d.name} />)}
          </section>
        )}
        {otherInfo.length > 0 && (
          <section className="drawer-sec">
            <h4>{t("Bilgiler")}</h4>
            {otherInfo.map((e) => <EntityRow key={e.entity_id} e={e} deviceName={d.name} />)}
          </section>
        )}

        <section className="drawer-sec tech">
          <h4>{t("Teknik")}</h4>
          <dl>
            <dt>{t("Varlık")}</dt><dd><code>{p.entity_id}</code></dd>
            <dt>{t("Bağlantı")}</dt><dd>{offline ? t("HA bağlantısı yok") : unavailable ? t("Erişilemiyor") : t("Çevrimiçi")}</dd>
            <dt>{t("Son değişim")}</dt><dd>{new Date(p.last_changed).toLocaleString(locale())}</dd>
            {capabilities.length > 0 && (<><dt>{t("Desteklenen")}</dt><dd>{capabilities.join(", ")}</dd></>)}
            {d.entities.length > 1 && (<><dt>{t("Varlık sayısı")}</dt><dd>{d.entities.length}</dd></>)}
          </dl>
        </section>
      </aside>
    </div>
  );
}

function EntityRow({ e, deviceName }: { e: HassEntity; deviceName: string }) {
  const { commands, status } = useHa();
  const d = domainOf(e.entity_id);
  const unavailable = isUnavailable(e);
  const busy = commands.pending.has(e.entity_id);
  const offline = status !== "connected";
  return (
    <div className={`detail-row ${unavailable ? "unavailable" : ""}`} title={e.entity_id}>
      <span className="detail-icon"><Icon name={iconName(e)} size={16} /></span>
      <div className="detail-text">
        <span className="detail-name">{shortName(e, deviceName)}</span>
        <span className="detail-sub">{t(DOMAIN_LABELS[d] ?? d)}</span>
      </div>
      {ACTION_DOMAINS.has(d) && !unavailable ? (
        PRESS_DOMAINS.has(d) ? (
          <button className="btn-small" disabled={busy || offline} onClick={() => commands.run(e, shortName(e, deviceName))}>
            {busy ? "…" : t("Çalıştır")}
          </button>
        ) : (
          <div className="detail-control">
            <span className="detail-state">{formatState(e)}</span>
            <Toggle on={isOn(e)} busy={busy} disabled={offline} onChange={() => commands.run(e, shortName(e, deviceName))} />
          </div>
        )
      ) : (
        <span className="detail-state">{formatState(e)}</span>
      )}
    </div>
  );
}
