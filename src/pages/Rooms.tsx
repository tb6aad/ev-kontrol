import { useMemo, useState } from "react";
import { useHa } from "../state/ha";
import { useToast } from "../state/toast";
import { filterDevices, groupByArea } from "../ha/filter";
import { deviceIsOn, DeviceItem } from "../ha/devices";
import { fmtWatts } from "../ha/energy";
import { areaNameTaken, createArea, deleteArea, renameArea } from "../ha/areas";
import DeviceCard, { EmptyState } from "../ui/DeviceCard";
import Icon from "../ui/Icon";
import { t } from "../i18n";

const errText = (e: unknown) => (e as { message?: string })?.message ?? String(e);

export default function Rooms({ onOpen }: { onOpen: (key: string) => void }) {
  const { devices, registries, conn, status } = useHa();
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const online = status === "connected";

  const areaByName = useMemo(() => new Map(registries.areas.map((a) => [a.name, a])), [registries.areas]);

  // Cihazı olan odalar + (arama yokken) henüz boş olan odalar
  const rooms = useMemo(() => {
    const grouped: (readonly [string, DeviceItem[]])[] = groupByArea(filterDevices(devices, query, "all", []));
    if (query.trim()) return grouped;
    const shown = new Set(grouped.map(([a]) => a));
    const empty = registries.areas.filter((a) => !shown.has(a.name)).map((a) => [a.name, [] as DeviceItem[]] as const);
    const all = [...grouped, ...empty];
    const none = t("Odasız");
    return all.sort(([a], [b]) => (a === none ? 1 : b === none ? -1 : a.localeCompare(b, "tr")));
  }, [devices, query, registries.areas]);

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    if (areaNameTaken(registries, name)) return notify("error", t("\"{name}\" adında bir oda zaten var.", { name }));
    setBusy(true);
    try {
      await createArea(conn, name);
      notify("success", t("\"{name}\" odası eklendi.", { name }));
      setNewName("");
      setAdding(false);
    } catch (e) {
      notify("error", t("Oda eklenemedi: {e}", { e: errText(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="toolbar2">
        <label className="search-box">
          <Icon name="search" size={16} />
          <input placeholder={t("Oda ya da cihaz ara…")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {adding ? (
          <form
            className="room-form"
            onSubmit={(e) => {
              e.preventDefault();
              submitNew();
            }}
          >
            <input autoFocus placeholder={t("Oda adı")} value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
            <button className="btn-primary" type="submit" disabled={busy || !newName.trim() || !online}>{t("Ekle")}</button>
            <button className="btn-small" type="button" onClick={() => setAdding(false)}>{t("Vazgeç")}</button>
          </form>
        ) : (
          <button className="btn-small" disabled={!online} onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> {t("Oda ekle")}
          </button>
        )}
        <div className="room-jump">
          {rooms.map(([area]) => (
            <a key={area} href={`#room-${encodeURIComponent(area)}`} className="chip-link">
              {area}
            </a>
          ))}
        </div>
      </div>

      {rooms.length === 0 && <EmptyState title={t("Eşleşen cihaz yok")} text={t("Arama ifadesini değiştirmeyi dene.")} />}

      {rooms.map(([area, list]) => (
        <RoomSection
          key={area}
          name={area}
          areaId={areaByName.get(area)?.area_id ?? null}
          list={list}
          onOpen={onOpen}
          online={online}
        />
      ))}
    </div>
  );
}

function RoomSection({ name, areaId, list, onOpen, online }: {
  name: string; areaId: string | null; list: DeviceItem[]; onOpen: (key: string) => void; online: boolean;
}) {
  const { conn, registries } = useHa();
  const { notify } = useToast();
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);

  const on = list.filter(deviceIsOn).length;
  const watts = list.reduce((s, d) => s + (d.power && !Number.isNaN(Number(d.power.state)) ? Number(d.power.state) : 0), 0);
  const hasPower = list.some((d) => d.power && !Number.isNaN(Number(d.power.state)));

  const rename = async () => {
    const n = draft.trim();
    if (!areaId || !n || n === name) return setMode("view");
    if (areaNameTaken(registries, n, areaId)) return notify("error", t("\"{name}\" adında bir oda zaten var.", { name: n }));
    setBusy(true);
    try {
      await renameArea(conn, areaId, n);
      notify("success", t("Oda adı \"{name}\" olarak değiştirildi.", { name: n }));
      setMode("view");
    } catch (e) {
      notify("error", t("Oda adı değiştirilemedi: {e}", { e: errText(e) }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!areaId) return;
    setBusy(true);
    try {
      await deleteArea(conn, areaId);
      notify("success", t("\"{name}\" odası silindi.", { name }));
    } catch (e) {
      notify("error", t("Oda silinemedi: {e}", { e: errText(e) }));
      setBusy(false);
      setMode("view");
    }
  };

  return (
    <section id={`room-${encodeURIComponent(name)}`} className="section">
      <div className="section-head">
        {mode === "rename" ? (
          <form className="room-form" onSubmit={(e) => { e.preventDefault(); rename(); }}>
            <input autoFocus value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setMode("view")} aria-label={t("Oda adı")} />
            <button className="btn-primary" type="submit" disabled={busy || !draft.trim() || !online}>{t("Kaydet")}</button>
            <button className="btn-small" type="button" onClick={() => setMode("view")}>{t("Vazgeç")}</button>
          </form>
        ) : (
          <h2>{name}</h2>
        )}
        <span className="section-meta">
          {t("{n} cihaz · {on} açık", { n: list.length, on })}{hasPower ? ` · ${fmtWatts(watts)}` : ""}
        </span>
        {areaId && mode === "view" && (
          <span className="room-tools">
            <button className="link" disabled={!online} onClick={() => { setDraft(name); setMode("rename"); }}>{t("Yeniden adlandır")}</button>
            <button className="link danger-link" disabled={!online} onClick={() => setMode("delete")}>{t("Sil")}</button>
          </span>
        )}
      </div>
      {mode === "delete" && (
        <div className="confirm room-confirm">
          <span>
            {list.length
              ? t("\"{name}\" odası Home Assistant'tan silinsin mi? İçindeki {n} cihaz silinmez, \"Odasız\" olur.", { name, n: list.length })
              : t("\"{name}\" odası Home Assistant'tan silinsin mi?", { name })}
          </span>
          <button className="btn-small danger" disabled={busy || !online} onClick={remove}>{t("Evet, sil")}</button>
          <button className="btn-small" onClick={() => setMode("view")}>{t("Vazgeç")}</button>
        </div>
      )}
      {list.length === 0 ? (
        <div className="empty-mini">{t("Bu odada cihaz yok. Bir cihazın ayrıntısını açıp \"Oda\" seçerek buraya taşıyabilirsin.")}</div>
      ) : (
        <div className="grid-wrap">
          <div className="device-grid">
            {list.map((d) => (
              <DeviceCard key={d.key} device={d} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
