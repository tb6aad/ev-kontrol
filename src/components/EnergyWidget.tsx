import { useEffect, useMemo, useRef, useState } from "react";
import { useAppVisible } from "../state/desktop";
import type { Connection, HassEntities } from "home-assistant-js-websocket";
import { dailyEnergy, fmtKwh, fmtWatts, livePower, monthlyEnergy } from "../ha/energy";
import Icon from "../ui/Icon";
import { t } from "../i18n";

interface Props {
  conn: Connection;
  entities: HassEntities;
  onOpen: () => void;
  /** Bağlı değilken sorgu yapılmaz; son değerler korunur */
  connected: boolean;
}

const REFRESH_MS = 5 * 60_000;

/** Sol paneldeki kısa enerji özeti; tıklayınca Enerji sayfası açılır. */
export default function EnergyWidget({ conn, entities, onOpen, connected }: Props) {
  const [month, setMonth] = useState<number | null | undefined>(undefined);
  const [today, setToday] = useState<number | null | undefined>(undefined);
  const entRef = useRef(entities);
  entRef.current = entities;

  const live = useMemo(() => livePower(entities), [entities]);

  // Enerji sensörleri listesi gelince (ya da değişince) yeniden hesapla
  const energyKey = useMemo(
    () =>
      Object.values(entities)
        .filter((e) => e.entity_id.startsWith("sensor.") && e.attributes.device_class === "energy")
        .map((e) => e.entity_id)
        .sort()
        .join(","),
    [entities],
  );

  const visible = useAppVisible();
  useEffect(() => {
    if (!energyKey || !connected || !visible) return; // gizliyken sorgulama yok; varlıklar henüz gelmedi ya da bağlantı yok
    let alive = true;
    // Hata durumunda son değer korunur (bağlantı hatası "veri yok" gibi gösterilmez)
    const load = () => {
      monthlyEnergy(conn, entRef.current)
        .then((m) => alive && setMonth(m.items.length ? m.total : null))
        .catch(() => {});
      dailyEnergy(conn, entRef.current)
        .then((d) => alive && setToday(d.today))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [conn, energyKey, connected, visible]);

  const show = (v: number | null | undefined) => (v === undefined ? "…" : v === null ? t("Veri yok") : fmtKwh(v));

  return (
    <button className="widget energy" onClick={onOpen} title={t("Enerji sayfasını aç")}>
      <div className="widget-title">
        <Icon name="energy" size={13} /> {t("Enerji")}
      </div>
      <div className="energy-row">
        <span className="muted">{t("Anlık")}</span>
        <span className="energy-big">{live.items.length ? fmtWatts(live.total) : t("Veri yok")}</span>
      </div>
      <div className="energy-row">
        <span className="muted">{t("Bugün")}</span>
        <span>{show(today)}</span>
      </div>
      <div className="energy-row">
        <span className="muted">{t("Bu ay")}</span>
        <span>{show(month)}</span>
      </div>
    </button>
  );
}
