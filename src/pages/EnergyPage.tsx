import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppVisible } from "../state/desktop";
import { useHa } from "../state/ha";
import {
  Bucket, RANGES, RangeKey, dailyEnergy, energySeries, energyStatIds, fmtKwh, fmtWatts, livePower, monthlyEnergy,
} from "../ha/energy";
import Icon from "../ui/Icon";
import { locale, t } from "../i18n";

const RANGE_KEYS: RangeKey[] = ["1h", "24h", "7d", "30d"];

function bucketLabel(t: number, range: RangeKey, long = false) {
  const d = new Date(t);
  if (range === "1h" || range === "24h") {
    const hm = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    return long ? `${d.toLocaleDateString(locale(), { day: "numeric", month: "short" })} ${hm}` : hm;
  }
  return d.toLocaleDateString(locale(), long ? { weekday: "short", day: "numeric", month: "long" } : { day: "numeric", month: "short" });
}

/* ---------- Çubuk grafik (tek seri: toplam kWh) ---------- */

function BarChart({ buckets, range, names }: { buckets: Bucket[]; range: RangeKey; names: (id: string) => string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 230;
  const pad = { l: 48, r: 8, t: 12, b: 26 };
  const plotW = w - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const values = buckets.map((b) => b.kwh).filter((v): v is number => v != null);
  const rawMax = Math.max(0, ...values);
  // "Güzel" üst sınır ve yuvarlak eksen adımları (0,05 · 0,1 · 0,2 · 0,5 · 1 …)
  const { niceMax, tickStep } = (() => {
    if (rawMax <= 0) return { niceMax: 1, tickStep: 0.25 };
    const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
    const n = rawMax / pow;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    const step = { 1: 0.2, 2: 0.5, 2.5: 0.5, 5: 1, 10: 2 }[m]! * pow;
    return { niceMax: m * pow, tickStep: step };
  })();
  const slot = plotW / Math.max(1, buckets.length);
  const barW = Math.max(2, Math.min(28, slot - 2)); // komşu çubuklar arasında ≥2 px boşluk
  const y = (v: number) => pad.t + plotH - (v / niceMax) * plotH;
  const ticks = Array.from({ length: Math.round(niceMax / tickStep) + 1 }, (_, i) => i * tickStep);
  const labelEvery = Math.ceil(buckets.length / Math.max(2, Math.floor(plotW / 64)));
  const decimals = Math.max(0, -Math.floor(Math.log10(tickStep) + 1e-9));
  const fmtTick = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: decimals, minimumFractionDigits: 0 });

  const hb = hover != null ? buckets[hover] : null;
  const top = hb
    ? Object.entries(hb.perDevice).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];

  return (
    <div className="chart" ref={wrap} onMouseLeave={() => setHover(null)}>
      <svg width={w} height={H} role="img" aria-label={t("{range} enerji tüketimi, kWh", { range: t(RANGES[range].label) })}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={pad.l - 8} y={y(t)} className="axis-text" textAnchor="end" dominantBaseline="middle">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const x = cx - barW / 2;
          const base = y(0);
          return (
            <g key={b.start}>
              {b.kwh == null ? (
                // Veri yok: sıfır çubuğu değil, taban çizgisinde boş işaret
                <line x1={x} x2={x + barW} y1={base - 1} y2={base - 1} className="gap-mark" />
              ) : (
                (() => {
                  const h = Math.max(b.kwh > 0 ? 2 : 0, base - y(b.kwh));
                  const r = Math.min(4, barW / 2, h);
                  const top = base - h;
                  return (
                    <path
                      className={`bar-mark ${hover === i ? "hot" : ""}`}
                      d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`}
                    />
                  );
                })()
              )}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} className="axis-text" textAnchor="middle">
                  {bucketLabel(b.start, range)}
                </text>
              )}
              {/* İşaretten büyük vurgu alanı */}
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
        <line x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} className="base-line" />
      </svg>
      {hb && hover != null && (
        <div
          className="chart-tip"
          style={{ left: Math.min(w - 190, Math.max(0, pad.l + slot * hover + slot / 2 - 90)) }}
        >
          <b>{bucketLabel(hb.start, range, true)}</b>
          <span className="tip-val">{hb.kwh == null ? t("Veri yok") : fmtKwh(hb.kwh)}</span>
          {top.map(([id, v]) => (
            <span key={id} className="tip-row">
              <span>{names(id)}</span>
              <span>{fmtKwh(v)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Sayfa ---------- */

export default function EnergyPage() {
  const { conn, entities, status } = useHa();
  const [range, setRange] = useState<RangeKey>("24h");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);
  const [statIds, setStatIds] = useState<string[] | null>(null);
  const [daily, setDaily] = useState<{ today: number | null; yesterday: number | null } | null>(null);
  const [month, setMonth] = useState<number | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const entRef = useRef(entities);
  entRef.current = entities;

  const live = useMemo(() => livePower(entities), [entities]);
  const names = (id: string) =>
    ((entities[id]?.attributes.friendly_name as string) || id).replace(/ (Enerji|Month Energy|Güç|Current Power)$/i, "");

  const energyKey = useMemo(
    () => Object.values(entities).filter((e) => e.attributes.device_class === "energy").map((e) => e.entity_id).sort().join(","),
    [entities],
  );

  const connected = status === "connected";

  // Bağlantı yokken sorgu yapılmaz; hata "veri yok" gibi gösterilmez, bağlanınca tazelenir
  useEffect(() => {
    if (!energyKey || !connected) return;
    let alive = true;
    energyStatIds(conn, entRef.current)
      .then(({ grid, devices }) => alive && setStatIds(devices.length ? devices : grid))
      .catch(() => {});
    dailyEnergy(conn, entRef.current).then((d) => alive && setDaily(d)).catch(() => {});
    monthlyEnergy(conn, entRef.current).then((m) => alive && setMonth(m.items.length ? m.total : null)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [conn, energyKey, connected]);

  const visible = useAppVisible();
  const shownRange = useRef<string | null>(null);
  useEffect(() => {
    if (!statIds || !connected || !visible) return; // pencere gizliyken sorgu yok
    let alive = true;
    // Yalnızca aralık değişince "yükleniyor"a dön; pencere tekrar açılınca eski grafik yerinde kalsın
    if (shownRange.current !== range) setBuckets(null);
    shownRange.current = range;
    setErr(null);
    const load = () =>
      energySeries(conn, statIds, range)
        .then((b) => alive && setBuckets(b))
        .catch((e) => alive && setErr((e as { message?: string })?.message ?? String(e)));
    load();
    const t = setInterval(load, range === "1h" ? 60_000 : 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [conn, statIds, range, connected, visible]);

  const total = buckets?.reduce((s, b) => s + (b.kwh ?? 0), 0) ?? null;
  const missing = buckets?.filter((b) => b.kwh == null).length ?? 0;

  // Cihaz kırılımı: anlık güç + seçili aralıktaki tüketim
  const perDevice = useMemo(() => {
    const kwh = new Map<string, number>();
    for (const b of buckets ?? []) for (const [id, v] of Object.entries(b.perDevice)) kwh.set(id, (kwh.get(id) ?? 0) + v);
    // Güç sensörünü aynı cihazın enerji sensörüyle eşle (aynı önek)
    const prefix = (id: string) => id.replace(/^sensor\./, "").replace(/_(enerji|energy|guc|power|current_power|month_energy|today_energy)$/, "");
    const rows = new Map<string, { name: string; watts: number | null; kwh: number | null }>();
    for (const id of statIds ?? []) rows.set(prefix(id), { name: names(id), watts: null, kwh: kwh.get(id) ?? null });
    for (const it of live.items) {
      const k = prefix(it.entity.entity_id);
      const r = rows.get(k) ?? { name: names(it.entity.entity_id), watts: null, kwh: null };
      r.watts = it.watts;
      rows.set(k, r);
    }
    return [...rows.values()].sort((a, b) => (b.kwh ?? -1) - (a.kwh ?? -1) || (b.watts ?? -1) - (a.watts ?? -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, live, statIds]);
  const maxW = Math.max(1, ...perDevice.map((r) => r.watts ?? 0));
  const maxK = Math.max(0.001, ...perDevice.map((r) => r.kwh ?? 0));
  const stale = status !== "connected";

  const kv = (v: number | null | undefined) => (v === undefined ? "…" : v === null ? t("Veri yok") : fmtKwh(v));

  return (
    <div className="page">
      <div className="kpi-row three">
        <div className={`kpi ${stale ? "stale" : ""}`}>
          <div className="kpi-head"><span className="kpi-icon"><Icon name="energy" size={16} /></span><span className="kpi-label">{t("Anlık güç")}</span></div>
          <span className="kpi-value">{live.items.length ? fmtWatts(live.total) : t("Veri yok")}</span>
          <span className="kpi-sub">{t("{n} güç sensörünün toplamı (W)", { n: live.items.length })}</span>
        </div>
        <div className={`kpi ${stale ? "stale" : ""}`}>
          <div className="kpi-head"><span className="kpi-icon"><Icon name="chart" size={16} /></span><span className="kpi-label">{t("Bugün")}</span></div>
          <span className="kpi-value">{daily ? kv(daily.today) : "…"}</span>
          <span className="kpi-sub">{daily?.yesterday != null ? t("Dün toplam {x}", { x: fmtKwh(daily.yesterday) }) : t("Dün için veri yok")}</span>
        </div>
        <div className={`kpi ${stale ? "stale" : ""}`}>
          <div className="kpi-head"><span className="kpi-icon"><Icon name="clock" size={16} /></span><span className="kpi-label">{t("Bu ay")}</span></div>
          <span className="kpi-value">{kv(month)}</span>
          <span className="kpi-sub">{t("{month} ayı, kWh", { month: new Date().toLocaleDateString(locale(), { month: "long" }) })}</span>
        </div>
      </div>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h2>{t("Enerji tüketimi")}</h2>
            <span className="section-meta">
              {t(RANGES[range].label)} · {total != null && buckets ? t("toplam {x}", { x: fmtKwh(total) }) : t("yükleniyor…")}
              {missing > 0 && buckets && ` · ${missing} dilimde veri yok`}
            </span>
          </div>
          <div className="panel-tools">
            <div className="seg small" role="tablist" aria-label={t("Zaman aralığı")}>
              {RANGE_KEYS.map((k) => (
                <button key={k} role="tab" aria-selected={range === k} className={range === k ? "active" : ""} onClick={() => setRange(k)}>
                  {k === "1h" ? t("1 sa") : k === "24h" ? t("24 sa") : k === "7d" ? t("7 gün") : t("30 gün")}
                </button>
              ))}
            </div>
            <div className="seg small" role="tablist" aria-label={t("Görünüm")}>
              <button className={view === "chart" ? "active" : ""} onClick={() => setView("chart")}>{t("Grafik")}</button>
              <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>{t("Tablo")}</button>
            </div>
          </div>
        </div>

        {err && <div className="drawer-note warn"><Icon name="alert" size={15} /> {t("Geçmiş veriler alınamadı: {e}", { e: err })}</div>}
        {!statIds && !energyKey && <div className="empty-mini">{t("Enerji (kWh) ölçen sensör yok.")}</div>}
        {buckets && view === "chart" && <BarChart buckets={buckets} range={range} names={names} />}
        {buckets && view === "table" && (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>{t("Dilim")}</th><th className="num">{t("Tüketim (kWh)")}</th></tr></thead>
              <tbody>
                {[...buckets].reverse().map((b) => (
                  <tr key={b.start}>
                    <td>{bucketLabel(b.start, range, true)}</td>
                    <td className="num">{b.kwh == null ? <span className="muted">{t("veri yok")}</span> : b.kwh.toLocaleString(locale(), { maximumFractionDigits: 3 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!buckets && statIds && !err && <div className="chart-skeleton" />}
        <p className="muted small">
          {t("Toplam, enerji ölçen prizlerin toplamıdır (evin tamamı değil). Boş dilimler kayıt olmayan zamanları gösterir; sıfır tüketim anlamına gelmez.")}
        </p>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <div>
            <h2>{t("Cihaz bazında")}</h2>
            <span className="section-meta">{t("Anlık güç (W) ve {range} tüketim (kWh)", { range: t(RANGES[range].label).toLocaleLowerCase(locale()) })}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>{t("Cihaz")}</th><th>{t("Anlık güç")}</th><th className="num">W</th><th>{t(RANGES[range].label)}</th><th className="num">kWh</th></tr>
            </thead>
            <tbody>
              {perDevice.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="bar-cell">{r.watts != null && <div className="bar"><div style={{ width: `${(r.watts / maxW) * 100}%` }} /></div>}</td>
                  <td className="num">{r.watts != null ? fmtWatts(r.watts) : <span className="muted">—</span>}</td>
                  <td className="bar-cell">{r.kwh != null && <div className="bar"><div style={{ width: `${(r.kwh / maxK) * 100}%` }} /></div>}</td>
                  <td className="num">{r.kwh != null ? r.kwh.toLocaleString(locale(), { maximumFractionDigits: 3 }) : <span className="muted">{t("veri yok")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
