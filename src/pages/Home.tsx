import { useEffect, useMemo, useRef, useState } from "react";
import { useAppVisible } from "../state/desktop";

import { useHa } from "../state/ha";
import { usePrefs } from "../state/prefs";
import { activeStats, deviceIsOn, friendly, isUnavailable } from "../ha/devices";
import { groupByArea } from "../ha/filter";
import { dailyEnergy, fmtKwh, fmtWatts, livePower } from "../ha/energy";
import { relTime } from "../ha/automations";
import { presence } from "../ha/presence";
import DeviceCard, { EmptyState } from "../ui/DeviceCard";
import Icon from "../ui/Icon";
import type { Page } from "../layout/Sidebar";
import { discoverCameras } from "../ha/cameras";
import { CameraCard } from "./Cameras";

interface Props {
  onOpen: (key: string) => void;
  onNavigate: (p: Page) => void;
}

/* ---------- KPI ---------- */

function Kpi({ icon, label, value, sub, stale, muted }: { icon: string; label: string; value: string; sub?: string; stale?: boolean; muted?: boolean }) {
  return (
    <div className={`kpi ${stale ? "stale" : ""}`}>
      <div className="kpi-head">
        <span className="kpi-icon"><Icon name={icon} size={16} /></span>
        <span className="kpi-label">{label}</span>
        {stale && <span className="stale-tag" title="Bağlantı yok; değer güncel olmayabilir">güncel değil</span>}
      </div>
      <span className={`kpi-value ${muted ? "muted" : ""}`}>{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

export default function Home({ onOpen, onNavigate }: Props) {
  const { conn, entities, devices, status, commands } = useHa();
  const { prefs, moveFavorite } = usePrefs();
  const stale = status !== "connected";

  /* KPI verileri */
  const active = activeStats(devices);
  const live = useMemo(() => livePower(entities), [entities]);
  const pres = useMemo(() => presence(entities), [entities]);

  const [daily, setDaily] = useState<{ today: number | null; yesterday: number | null } | undefined>(undefined);
  const entRef = useRef(entities);
  entRef.current = entities;
  const visible = useAppVisible();
  const hasEnergy = Object.values(entities).some((e) => e.attributes.device_class === "energy");
  useEffect(() => {
    // Bağlantı yokken sorgulama: hata "veri yok" sanılmasın, son değer korunur; bağlanınca tazelenir
    if (!hasEnergy || stale || !visible) return;
    let alive = true;
    const load = () => dailyEnergy(conn, entRef.current).then((d) => alive && setDaily(d)).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [conn, hasEnergy, stale, visible]);

  const dailyValue = daily === undefined ? (hasEnergy ? "…" : "Veri yok") : daily.today == null ? "Veri yok" : fmtKwh(daily.today);
  const dailySub =
    daily?.yesterday != null ? `Dün toplam ${fmtKwh(daily.yesterday)}` : daily ? "Dün için veri yok" : undefined;

  /* Sahneler: yalnızca HA'da gerçekten var olanlar */
  const scenes = Object.values(entities)
    .filter((e) => e.entity_id.startsWith("scene.") && !isUnavailable(e))
    .sort((a, b) => friendly(a).localeCompare(friendly(b), "tr"));

  /* Favoriler (kayıtlı sırayla; artık olmayan cihazlar atlanır) */
  const byKey = useMemo(() => new Map(devices.map((d) => [d.key, d])), [devices]);
  const favs = prefs.favorites.map((k, i) => ({ d: byKey.get(k), i })).filter((x) => x.d);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const rooms = useMemo(() => groupByArea(devices), [devices]);
  const { registries } = useHa();
  const cams = useMemo(() => discoverCameras(entities, registries), [entities, registries]);

  return (
    <div className="page">
      <div className="kpi-row">
        <Kpi icon="power" label="Aktif cihazlar" value={`${active.on} / ${active.total}`} sub="açık / kontrol edilebilir" stale={stale} />
        <Kpi
          icon="energy"
          label="Anlık tüketim"
          value={live.items.length ? fmtWatts(live.total) : "Veri yok"}
          sub={live.items.length ? `${live.items.filter((i) => i.watts > 0.5).length} cihaz çekiyor` : "Güç sensörü yok"}
          stale={stale}
          muted={!live.items.length}
        />
        <Kpi icon="chart" label="Bugünkü enerji" value={dailyValue} sub={dailySub} stale={stale} muted={daily?.today == null && daily !== undefined} />
        <Kpi icon="user" label="Ev durumu" value={pres.value} sub={pres.sub} stale={stale} muted={pres.muted} />
      </div>

      {scenes.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Hızlı sahneler</h2>
            <span className="section-meta">Home Assistant'taki sahneler</span>
          </div>
          <div className="scene-row">
            {scenes.map((s) => {
              const busy = commands.pending.has(s.entity_id);
              const last = Date.parse(s.state);
              return (
                <button key={s.entity_id} className={`scene-btn ${busy ? "busy" : ""}`} disabled={stale || busy} onClick={() => commands.run(s, friendly(s))}>
                  <Icon name="scene" size={16} />
                  <span className="scene-name">{friendly(s)}</span>
                  <span className="scene-sub">{busy ? "Çalıştırılıyor…" : Number.isNaN(last) ? "Hiç çalışmadı" : relTime(new Date(last))}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Favoriler</h2>
          {favs.length > 1 && <span className="section-meta">Sıralamak için sürükle</span>}
        </div>
        {favs.length === 0 ? (
          <EmptyState icon="star" title="Henüz favori yok" text="Cihaz kartlarındaki yıldıza tıklayarak sık kullandıklarını buraya sabitleyebilirsin." />
        ) : (
          <div className="grid-wrap">
            <div className="device-grid" onDragEnd={() => { setDragFrom(null); setDragOver(null); }}>
              {favs.map(({ d, i }) => (
                <div key={d!.key} className={`drop-slot ${dragOver === i && dragFrom !== null && dragFrom !== i ? "over" : ""}`}>
                  <DeviceCard
                    device={d!}
                    onOpen={onOpen}
                    draggable
                    dragging={dragFrom === i}
                    onDragStart={() => setDragFrom(i)}
                    onDragOver={() => setDragOver(i)}
                    onDrop={() => {
                      if (dragFrom !== null && dragFrom !== i) moveFavorite(dragFrom, i);
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {cams.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Kameralar</h2>
            <button className="link" onClick={() => onNavigate("cameras")}>Kameralar sayfası</button>
          </div>
          <div className="cam-grid small">
            {cams.map((c) => (
              <CameraCard key={c.key} cam={c} compact />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Odalar</h2>
          <button className="link" onClick={() => onNavigate("rooms")}>Tümünü gör</button>
        </div>
        <div className="room-cards">
          {rooms.map(([area, list]) => {
            const on = list.filter(deviceIsOn).length;
            const unavail = list.filter((d) => isUnavailable(d.primary)).length;
            return (
              <button key={area} className="room-card" onClick={() => onNavigate("rooms")}>
                <span className="room-name">{area}</span>
                <span className="room-meta">
                  {list.length} cihaz · <b className={on ? "on" : ""}>{on} açık</b>
                  {unavail > 0 && <> · <span className="warn-text">{unavail} erişilemiyor</span></>}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
