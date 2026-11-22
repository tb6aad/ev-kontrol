import { useEffect, useMemo, useState } from "react";
import type { Connection, HassEntities, HassEntity } from "home-assistant-js-websocket";
import { callService } from "home-assistant-js-websocket";
import type { Registries } from "../ha/client";
import { formatState } from "../ha/devices";
import Toggle from "./Toggle";
import Icon from "../ui/Icon";
import { t, tk } from "../i18n";

interface Props {
  conn: Connection;
  entities: HassEntities;
  registries: Registries;
  baseUrl: string;
}

const STATUS_TR: Record<string, string> = {
  sleeping: tk("Uykuda"), idle: tk("Boşta"), cleaning: tk("Temizliyor"), returning_home: tk("İstasyona dönüyor"),
  remote_control_active: tk("Uzaktan kumanda"), charging: tk("Şarj oluyor"), paused: tk("Duraklatıldı"), error: tk("Hata"),
  updating: tk("Güncelleniyor"), emptying_the_bin: tk("Çöp boşaltılıyor"), mapping: tk("Harita çıkarıyor"),
  saving_map: tk("Harita kaydediliyor"), relocating: tk("Konum buluyor"), sweeping: tk("Süpürüyor"), mopping: tk("Paspaslıyor"),
  sweep_and_mop: tk("Süpürüp paspaslıyor"), transitioning: tk("Geçiş"), waiting_to_charge: tk("Şarj bekliyor"),
  docked: tk("İstasyonda"), returning: tk("Dönüyor"), unknown: tk("Bilinmiyor"), unavailable: tk("Erişilemiyor"),
};

const FAN_TR: Record<string, string> = {
  off: tk("Kapalı"), quiet: tk("Sessiz"), balanced: tk("Dengeli"), turbo: tk("Turbo"), max: tk("Max"), max_plus: "Max+",
};
const MODE_TR: Record<string, string> = {
  vac_and_mop: tk("Süpür + Paspas"), vacuum: tk("Sadece süpür"), mop: tk("Sadece paspas"), customized: tk("Özel"), custom: tk("Özel"),
};
const WATER = [
  { code: 0, label: tk("Kapalı") },
  { code: 1, label: tk("Az") },
  { code: 2, label: tk("Orta") },
  { code: 3, label: tk("Çok") },
];

/** Sarf malzemesi önerilen ömürleri (saat) — Roborock kılavuz değerleri */
const LIFE_H: Record<string, number> = { main_brush: 300, side_brush: 200, filter: 150, sensor: 30 };

const PREF_KEY = "ha-desktop.vacuum.prefs";
interface Prefs {
  water?: number;
  passes?: 1 | 2;
  rooms?: string[];
}
function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
  } catch {
    return {};
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* yoksay */
  }
}

export default function Vacuum({ conn, entities, registries, baseUrl }: Props) {
  const vacuums = Object.values(entities).filter((e) => e.entity_id.startsWith("vacuum."));
  const [selId, setSelId] = useState<string | null>(null);
  const vac = vacuums.find((v) => v.entity_id === selId) ?? vacuums[0];

  if (!vac) return <div className="placeholder">{t("Home Assistant'ta robot süpürge bulunamadı.")}</div>;
  return (
    <>
      {vacuums.length > 1 && (
        <div className="chips tabs">
          {vacuums.map((v) => (
            <button key={v.entity_id} className={v.entity_id === vac.entity_id ? "active" : ""} onClick={() => setSelId(v.entity_id)}>
              {(v.attributes.friendly_name as string) || v.entity_id}
            </button>
          ))}
        </div>
      )}
      <VacuumPanel key={vac.entity_id} vac={vac} conn={conn} entities={entities} registries={registries} baseUrl={baseUrl} />
    </>
  );
}

function VacuumPanel({ vac, conn, entities, registries, baseUrl }: { vac: HassEntity } & Props) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => savePrefs(prefs), [prefs]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  // Aynı cihazdaki yardımcı varlıklar (çeviri anahtarına göre)
  const rel = useMemo(() => {
    const devId = registries.entities.find((e) => e.entity_id === vac.entity_id)?.device_id;
    const ids = registries.entities.filter((e) => devId && e.device_id === devId).map((e) => e.entity_id);
    const find = (re: RegExp, domain?: string) =>
      ids.map((id) => entities[id]).find((e) => e && (!domain || e.entity_id.startsWith(domain + ".")) && re.test(e.entity_id));
    return {
      map: find(/harita|map/, "image"),
      status: find(/durum|status/, "sensor"),
      battery: find(/pil|battery/, "sensor"),
      progress: find(/ilerleme|progress|clean_percent/, "sensor"),
      cleanTime: find(/(?<!toplam_)temizlik_suresi$|(?<!total_)cleaning_time$/, "sensor"),
      cleanArea: find(/(?<!toplam_)temizleme_alani$|(?<!total_)cleaning_area$/, "sensor"),
      totalCount: find(/toplam_temizlik_sayisi|total_cleaning_count/, "sensor"),
      totalArea: find(/toplam_temizlik_alani|total_cleaning_area/, "sensor"),
      totalTime: find(/toplam_temizlik_suresi|total_cleaning_time/, "sensor"),
      mode: find(/temizleme_modu|cleaning_mode/, "select"),
      volume: find(/_ses$|volume/, "number"),
      emptyBin: find(/cop|dustbin|empty/, "button"),
      consumables: [
        { key: "main_brush", label: tk("Ana fırça"), e: find(/ana_firca|main_brush/, "sensor") },
        { key: "side_brush", label: tk("Yan fırça"), e: find(/yan_firca|side_brush/, "sensor") },
        { key: "filter", label: tk("Filtre"), e: find(/filtre|filter/, "sensor") },
        { key: "sensor", label: tk("Sensörler"), e: find(/sensor_suresi|sensor_life/, "sensor") },
      ],
      switches: ids
        .filter((id) => id.startsWith("switch.") && entities[id] && entities[id].state !== "unknown")
        .map((id) => entities[id]),
    };
  }, [registries, entities, vac.entity_id]);

  const status = rel.status?.state ?? vac.state;
  const cleaning = ["cleaning", "sweeping", "mopping", "sweep_and_mop", "returning_home", "relocating", "mapping"].includes(status) || vac.state === "cleaning";
  const paused = status === "paused" || vac.state === "paused";
  const fanList = (vac.attributes.fan_speed_list as string[]) ?? [];
  const fan = vac.attributes.fan_speed as string | undefined;
  const modeOptions = (rel.mode?.attributes.options as string[]) ?? [];

  // Harita: görüntü varlığının durumu (zaman damgası) değişince yeniden yükle
  const mapUrl = rel.map?.attributes.entity_picture
    ? `${baseUrl.replace(/\/+$/, "")}${rel.map.attributes.entity_picture}&v=${encodeURIComponent(rel.map.state)}`
    : null;

  async function run(label: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(label);
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg(`${t("Hata")}: ${(e as { message?: string })?.message ?? String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const svc = (service: string, data?: Record<string, unknown>) =>
    callService(conn, "vacuum", service, data, { entity_id: vac.entity_id });
  const sendDp = (command: string, params: unknown) => svc("send_command", { command, params });

  // Oda temizliği için HA alanları (süpürgenin oda eşlemesi HA'da tanımlıysa çalışır)
  const areas = useMemo(
    () => [...registries.areas].sort((a, b) => a.name.localeCompare(b.name, "tr")),
    [registries.areas],
  );
  const rooms = prefs.rooms ?? [];

  async function start() {
    // Deneysel ayarlar: başlatmadan önce cihaza gönder
    if (prefs.water != null) await sendDp("dpWaterLevel", prefs.water).catch(() => {});
    if (prefs.passes) await sendDp("dpCleanCount", prefs.passes).catch(() => {});
    if (rooms.length) {
      await callService(conn, "vacuum", "clean_area", { cleaning_area_id: rooms }, { entity_id: vac.entity_id });
    } else {
      await svc("start");
    }
  }

  const battery = rel.battery ? Number(rel.battery.state) : NaN;
  const progress = rel.progress ? Number(rel.progress.state) : NaN;

  return (
    <div className="vac">
      <header className="vac-head">
        <span className="dcard-icon big"><Icon name="vacuum" size={24} /></span>
        <div>
          <h2>{(vac.attributes.friendly_name as string) || vac.entity_id}</h2>
          <span className={`vac-status ${cleaning ? "active" : ""} ${status === "error" ? "err" : ""}`}>
            {STATUS_TR[status] ? t(STATUS_TR[status]) : status}
          </span>
        </div>
        {!Number.isNaN(battery) && (
          <div className="vac-battery" title={t("Pil")}>
            <div className="batt">
              <div style={{ width: `${battery}%` }} className={battery < 20 ? "low" : ""} />
            </div>
            {battery}%
          </div>
        )}
      </header>

      <div className="vac-grid">
        {/* ---------- Harita ---------- */}
        <section className="vac-map">
          {mapUrl ? (
            <img src={mapUrl} alt={t("Süpürge haritası")} />
          ) : (
            <div className="placeholder">{t("Harita görüntüsü yok")}</div>
          )}
          {cleaning && !Number.isNaN(progress) && (
            <div className="vac-progress">
              <div style={{ width: `${progress}%` }} />
              <span>
                %{progress}
                {rel.cleanArea && ` · ${formatState(rel.cleanArea)}`}
                {rel.cleanTime && ` · ${formatState(rel.cleanTime)}`}
              </span>
            </div>
          )}
        </section>

        {/* ---------- Kontroller ---------- */}
        <section className="vac-side">
          <div className="vac-controls">
            {cleaning ? (
              <button className="btn-primary" disabled={!!busy} onClick={() => run("pause", () => svc("pause"))}>
                ⏸ {t("Duraklat")}
              </button>
            ) : (
              <button className="btn-primary" disabled={!!busy} onClick={() => run("start", start, rooms.length ? t("Seçili odalar temizleniyor") : t("Temizlik başladı"))}>
                ▶ {paused ? t("Devam et") : rooms.length ? t("{n} odayı temizle", { n: rooms.length }) : t("Tüm evi temizle")}
              </button>
            )}
            <button className="btn-small" disabled={!!busy} onClick={() => run("stop", () => svc("stop"))}>⏹ {t("Durdur")}</button>
            <button className="btn-small" disabled={!!busy} onClick={() => run("home", () => svc("return_to_base"), t("İstasyona dönüyor"))}>{t("⌂ İstasyona dön")}</button>
            <button className="btn-small" disabled={!!busy} onClick={() => run("locate", () => svc("locate"), t("Süpürge ses çıkarıyor"))}>🔊 {t("Bul")}</button>
            {rel.emptyBin && (
              <button className="btn-small" disabled={!!busy} onClick={() => run("empty", () => callService(conn, "button", "press", {}, { entity_id: rel.emptyBin!.entity_id }), t("Çöp kutusu boşaltılıyor"))}>
                🗑 {t("Çöpü boşalt")}
              </button>
            )}
          </div>

          <div className="vac-setting">
            <h4>{t("Emiş gücü")}</h4>
            <div className="seg">
              {fanList.map((f) => (
                <button key={f} className={f === fan ? "active" : ""} disabled={!!busy} onClick={() => run("fan", () => svc("set_fan_speed", { fan_speed: f }))}>
                  {FAN_TR[f] ? t(FAN_TR[f]) : f}
                </button>
              ))}
            </div>
          </div>

          {rel.mode && (
            <div className="vac-setting">
              <h4>{t("Temizleme modu")}</h4>
              <div className="seg">
                {modeOptions.map((m) => (
                  <button
                    key={m}
                    className={m === rel.mode!.state ? "active" : ""}
                    disabled={!!busy}
                    onClick={() => run("mode", () => callService(conn, "select", "select_option", { option: m }, { entity_id: rel.mode!.entity_id }))}
                  >
                    {MODE_TR[m] ? t(MODE_TR[m]) : m}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="vac-setting">
            <h4>
              {t("Islaklık")} <span className="exp" title={t("Bu model için HA'da hazır ayar yok; komut doğrudan cihaza gönderilir. Etkisi HA'da görünmez.")}>{t("deneysel")}</span>
            </h4>
            <div className="seg">
              {WATER.map((w) => (
                <button
                  key={w.code}
                  className={prefs.water === w.code ? "active" : ""}
                  disabled={!!busy}
                  onClick={() => run("water", async () => {
                    await sendDp("dpWaterLevel", w.code);
                    setPrefs((p) => ({ ...p, water: w.code }));
                  }, t("Islaklık: {x} gönderildi", { x: t(w.label) }))}
                >
                  {t(w.label)}
                </button>
              ))}
            </div>
          </div>

          <div className="vac-setting">
            <h4>
              {t("Geçiş sayısı")} <span className="exp" title={t("Temizlik başlatılırken cihaza gönderilir. Etkisi HA'da görünmez.")}>{t("deneysel")}</span>
            </h4>
            <div className="seg">
              {([1, 2] as const).map((n) => (
                <button
                  key={n}
                  className={(prefs.passes ?? 1) === n ? "active" : ""}
                  disabled={!!busy}
                  onClick={() => run("passes", async () => {
                    await sendDp("dpCleanCount", n);
                    setPrefs((p) => ({ ...p, passes: n }));
                  }, n === 2 ? t("Çift geçiş seçildi") : t("Tek geçiş seçildi"))}
                >
                  {n === 1 ? t("Tek geçiş") : t("Çift geçiş")}
                </button>
              ))}
            </div>
          </div>

          <div className="vac-setting">
            <h4>
              Odalar <span className="muted small">{t("(boş = tüm ev)")}</span>
            </h4>
            <div className="room-grid">
              {areas.map((a) => {
                const on = rooms.includes(a.area_id);
                return (
                  <button
                    key={a.area_id}
                    className={on ? "active" : ""}
                    onClick={() =>
                      setPrefs((p) => ({
                        ...p,
                        rooms: on ? rooms.filter((r) => r !== a.area_id) : [...rooms, a.area_id],
                      }))
                    }
                  >
                    {a.name}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* ---------- Alt bilgiler ---------- */}
      <div className="vac-bottom">
        <section className="channel">
          <h4>{t("Sarf malzemeleri")}</h4>
          {rel.consumables.filter((c) => c.e).map((c) => {
            const used = Number(c.e!.state);
            const life = LIFE_H[c.key];
            const left = Math.max(0, life - used);
            const pct = Math.min(100, (used / life) * 100);
            return (
              <div key={c.key} className="bar-row">
                <span className="bar-name">{t(c.label)}</span>
                <div className="bar"><div className={pct > 85 ? "warn" : ""} style={{ width: `${pct}%` }} /></div>
                <span className="bar-val" title={t("{used} sa kullanıldı / önerilen {life} sa", { used, life })}>
                  {left > 0 ? t("{n} sa kaldı", { n: Math.round(left) }) : t("Değiştir")}
                </span>
              </div>
            );
          })}
        </section>

        <section className="channel">
          <h4>{t("Ayarlar")}</h4>
          {rel.switches.map((s) => (
            <div key={s.entity_id} className="detail-row">
              <span className="detail-text">
                <span className="detail-name">{((s.attributes.friendly_name as string) || s.entity_id).replace(/^.*?S8 Pro /, "")}</span>
              </span>
              <Toggle on={s.state === "on"} onChange={() => run(s.entity_id, () => callService(conn, "switch", "toggle", {}, { entity_id: s.entity_id }))} />
            </div>
          ))}
          {rel.volume && (
            <div className="detail-row">
              <span className="detail-text"><span className="detail-name">{t("Ses")}</span></span>
              <input
                type="range"
                min={Number(rel.volume.attributes.min ?? 0)}
                max={Number(rel.volume.attributes.max ?? 100)}
                step={Number(rel.volume.attributes.step ?? 1)}
                defaultValue={Number(rel.volume.state)}
                onMouseUp={(e) => run("vol", () => callService(conn, "number", "set_value", { value: Number((e.target as HTMLInputElement).value) }, { entity_id: rel.volume!.entity_id }))}
              />
              <span className="detail-state">{formatState(rel.volume)}</span>
            </div>
          )}
        </section>

        <section className="channel">
          <h4>{t("İstatistik")}</h4>
          {[
            [t("Son temizlik"), rel.cleanArea && rel.cleanTime ? `${formatState(rel.cleanArea)} · ${formatState(rel.cleanTime)}` : "—"],
            [t("Toplam temizlik"), rel.totalCount ? `${rel.totalCount.state} kez` : "—"],
            [t("Toplam alan"), rel.totalArea ? formatState(rel.totalArea) : "—"],
            [t("Toplam süre"), rel.totalTime ? formatState(rel.totalTime) : "—"],
          ].map(([k, v]) => (
            <div key={k} className="detail-row">
              <span className="detail-text"><span className="detail-name">{k}</span></span>
              <span className="detail-state">{v}</span>
            </div>
          ))}
        </section>
      </div>

      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
