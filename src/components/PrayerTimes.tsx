import { useEffect, useMemo, useState } from "react";
import { useAppVisible } from "../state/desktop";
import type { HassEntities } from "home-assistant-js-websocket";
import { locale, t, tk } from "../i18n";

const LABELS: [RegExp, string][] = [
  [/sabah|fajr|imsak/, tk("İmsak")],
  [/gun_dogumu|sunrise/, tk("Güneş")],
  [/ogle|dhuhr/, tk("Öğle")],
  [/ikindi|asr/, tk("İkindi")],
  [/aksam|maghrib/, tk("Akşam")],
  [/yatsi|isha/, tk("Yatsı")],
];

interface Vakit {
  label: string;
  time: Date;
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

function fmtLeft(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h > 0 ? t("{h} sa {m} dk", { h, m: m % 60 }) : t("{m} dk", { m });
}

export default function PrayerTimes({ entities }: { entities: HassEntities }) {
  const [now, setNow] = useState(() => new Date());
  const visible = useAppVisible();
  useEffect(() => {
    if (!visible) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [visible]);

  const vakitler = useMemo<Vakit[]>(() => {
    const out: Vakit[] = [];
    for (const e of Object.values(entities)) {
      if (!e.entity_id.startsWith("sensor.islamic_prayer_times")) continue;
      const label = LABELS.find(([re]) => re.test(e.entity_id))?.[1];
      const t = new Date(e.state);
      if (label && !Number.isNaN(t.getTime())) out.push({ label, time: t });
    }
    return out.sort((a, b) => a.time.getTime() - b.time.getTime());
  }, [entities]);

  if (vakitler.length === 0) return null;

  // Sıradaki vakit; hepsi geçtiyse yarının imsakı (sensör gece yarısından sonra güncellenir)
  let nextIdx = vakitler.findIndex((v) => v.time > now);
  let nextTime: Date;
  if (nextIdx === -1) {
    nextIdx = 0;
    nextTime = new Date(vakitler[0].time.getTime() + 24 * 3600_000);
  } else {
    nextTime = vakitler[nextIdx].time;
  }

  return (
    <div className="widget prayer">
      <div className="widget-title">{t("Namaz Vakitleri")}</div>
      <div className="prayer-next">
        <span className="prayer-next-label">{t(vakitler[nextIdx].label)}</span>
        <span className="prayer-next-left">{t("{x} kaldı", { x: fmtLeft(nextTime.getTime() - now.getTime()) })}</span>
      </div>
      <ul className="prayer-list">
        {vakitler.map((v, i) => (
          <li key={v.label} className={i === nextIdx ? "next" : v.time < now ? "past" : ""}>
            <span>{t(v.label)}</span>
            <span>{fmtTime(v.time)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
