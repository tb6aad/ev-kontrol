import { useMemo, useState } from "react";
import { useHa } from "../state/ha";
import { usePrefs } from "../state/prefs";
import { DeviceFilter, FILTER_LABELS, filterDevices, matchesFilter, sortDevices } from "../ha/filter";
import DeviceCard, { EmptyState } from "../ui/DeviceCard";
import Icon from "../ui/Icon";
import { t } from "../i18n";

const FILTERS: DeviceFilter[] = ["all", "on", "off", "controls", "unavailable", "favorites"];

export default function AllDevices({ onOpen }: { onOpen: (key: string) => void }) {
  const { devices } = useHa();
  const { prefs } = usePrefs();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DeviceFilter>("all");

  const list = useMemo(
    () => sortDevices(filterDevices(devices, query, filter, prefs.favorites)),
    [devices, query, filter, prefs.favorites],
  );
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f, devices.filter((d) => matchesFilter(d, f, prefs.favorites)).length])),
    [devices, prefs.favorites],
  );

  return (
    <div className="page">
      <div className="toolbar2">
        <label className="search-box wide">
          <Icon name="search" size={16} />
          <input
            placeholder={t("Ad, oda, varlık kimliği ya da tür ile ara…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("Cihaz ara")}
          />
          {query && (
            <button className="icon-btn small" onClick={() => setQuery("")} aria-label={t("Aramayı temizle")}>
              <Icon name="close" size={14} />
            </button>
          )}
        </label>
        <div className="chips" role="tablist" aria-label={t("Filtre")}>
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {t(FILTER_LABELS[f])} <span className="chip-count">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={filter === "favorites" ? "star" : "search"}
          title={filter === "favorites" && !query ? t("Henüz favori yok") : t("Eşleşen cihaz yok")}
          text={
            filter === "favorites" && !query
              ? t("Bir cihaz kartındaki yıldıza tıklayarak favorilere ekleyebilirsin.")
              : t("Arama ifadesini ya da filtreyi değiştirmeyi dene.")
          }
        />
      ) : (
        <div className="grid-wrap">
          <div className="device-grid">
            {list.map((d) => (
              <DeviceCard key={d.key} device={d} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
