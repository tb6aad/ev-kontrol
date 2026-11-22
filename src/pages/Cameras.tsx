import { useEffect, useMemo, useRef, useState } from "react";
import { useAppVisible } from "../state/desktop";
import { useHa } from "../state/ha";
import { CameraDevice, discoverCameras, isCameraOnline, mjpegUrl, snapshotUrl } from "../ha/cameras";
import { relTime } from "../ha/automations";
import Toggle from "../components/Toggle";
import { EmptyState } from "../ui/DeviceCard";
import Icon from "../ui/Icon";
import { t } from "../i18n";

const SNAPSHOT_EVERY_MS = 10_000;

export default function Cameras() {
  const { entities, registries } = useHa();
  const cams = useMemo(() => discoverCameras(entities, registries), [entities, registries]);
  if (cams.length === 0) {
    return (
      <div className="page">
        <EmptyState icon="camera" title={t("Kamera bulunamadı")} text={t("Home Assistant'ta camera.* varlığı olan bir cihaz yok.")} />
      </div>
    );
  }
  return (
    <div className="page">
      <div className="cam-grid">
        {cams.map((c) => (
          <CameraCard key={c.key} cam={c} />
        ))}
      </div>
      <p className="muted small">
        {t("Canlı görüntü Home Assistant üzerinden aktarılır ve yalnızca bu sayfa açıkken akar. Önizleme 10 saniyede bir yenilenir.")}
      </p>
    </div>
  );
}

export function CameraCard({ cam, compact = false }: { cam: CameraDevice; compact?: boolean }) {
  const { settings, commands, status } = useHa();
  const [streamIdx, setStreamIdx] = useState(cam.streams.length > 1 && compact ? cam.streams.length - 1 : 0);
  const [live, setLive] = useState(!compact);
  const [tick, setTick] = useState(() => Date.now());
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const stream = cam.streams[Math.min(streamIdx, cam.streams.length - 1)];
  const e = stream.entity;
  const visible = useAppVisible();
  const online = isCameraOnline(e) && status === "connected";
  /** Pencere tepsideyken akış ve önizleme tamamen durur (ağ + çözme maliyeti sıfır) */
  const active = online && visible;
  const privacyOn = cam.privacy?.state === "on";

  // Canlı değilken önizlemeyi periyodik tazele
  useEffect(() => {
    if (live || !active) return;
    setTick(Date.now());
    const t = setInterval(() => setTick(Date.now()), SNAPSHOT_EVERY_MS);
    return () => clearInterval(t);
  }, [live, active]);

  // Akış/kaynak değişince hata ve yükleme durumunu sıfırla
  const src = active ? (live ? mjpegUrl(settings.url, e) : snapshotUrl(settings.url, e, tick)) : null;
  const srcKey = active ? `${e.entity_id}|${live}|${live ? e.attributes.access_token : ""}` : "off";
  useEffect(() => {
    setError(false);
    setLoaded(false);
  }, [srcKey]);

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else box.current?.requestFullscreen?.();
  };

  return (
    <section className={`cam-card ${compact ? "compact" : ""}`}>
      <div className="cam-view" ref={box} onDoubleClick={fullscreen}>
        {src && !error ? (
          <>
            <img
              key={srcKey}
              src={src}
              alt={t("{name} görüntüsü", { name: cam.name })}
              onLoad={() => setLoaded(true)}
              onError={() => setError(true)}
              draggable={false}
            />
            {!loaded && <div className="cam-overlay"><div className="spinner" /><span>{t("Görüntü bekleniyor…")}</span></div>}
            {live && loaded && <span className="cam-live"><span className="rec-dot" /> CANLI</span>}
          </>
        ) : (
          <div className="cam-overlay">
            <Icon name="camera" size={32} />
            {status !== "connected" ? (
              <span>{t("Home Assistant bağlantısı yok")}</span>
            ) : !isCameraOnline(e) ? (
              <>
                <b>{t("Kamera çevrimdışı")}</b>
                <span className="muted small">{t("{when} erişilemez oldu. Fişini ve Wi-Fi bağlantısını kontrol et.", { when: relTime(new Date(e.last_changed)) })}</span>
              </>
            ) : privacyOn ? (
              <span>{t("Gizlilik modu açık; kamera görüntü vermiyor.")}</span>
            ) : (
              <>
                <span>{t("Görüntü alınamadı.")}</span>
                <button className="btn-small" onClick={() => { setError(false); setTick(Date.now()); }}>{t("Tekrar dene")}</button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="cam-bar">
        <div className="cam-title">
          <b>{cam.name}</b>
          <span className="muted small">{cam.area}{cam.motion && cam.motion.state === "on" ? " · " + t("hareket algılandı") : ""}</span>
        </div>
        <div className="cam-tools">
          {cam.streams.length > 1 && (
            <div className="seg small" role="tablist" aria-label={t("Akış kalitesi")}>
              {cam.streams.map((s, i) => (
                <button key={s.entity.entity_id} className={i === streamIdx ? "active" : ""} onClick={() => setStreamIdx(i)}>
                  {s.label || t("Akış {n}", { n: i + 1 })}
                </button>
              ))}
            </div>
          )}
          <button
            className={`btn-small ${live && online ? "active-soft" : ""}`}
            disabled={!online}
            onClick={() => setLive((l) => !l)}
            title={live && online ? t("Canlıyı durdur (önizlemeye geç)") : t("Canlı izle")}
          >
            <Icon name={live && online ? "pause" : "play"} size={14} /> {live && online ? t("Durdur") : t("Canlı")}
          </button>
          {!compact && (
            <button className="icon-btn small" onClick={fullscreen} disabled={!online} title={t("Tam ekran")} aria-label={t("Tam ekran")}>
              <Icon name="external" size={15} />
            </button>
          )}
          {cam.privacy && cam.privacy.state !== "unavailable" && (
            <label className="cam-privacy" title={t("Gizlilik modu: açıkken kamera kayıt ve görüntü vermez")}>
              <Toggle
                on={privacyOn}
                busy={commands.pending.has(cam.privacy.entity_id)}
                disabled={status !== "connected"}
                label={t("Gizlilik modu")}
                onChange={() => commands.run(cam.privacy!, t("Gizlilik modu"))}
              />
              Gizlilik
            </label>
          )}
        </div>
      </div>
    </section>
  );
}
