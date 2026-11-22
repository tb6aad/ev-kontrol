import { useMemo, useState } from "react";
import { useHa } from "../state/ha";
import { filterDevices, groupByArea } from "../ha/filter";
import { deviceIsOn } from "../ha/devices";
import { fmtWatts } from "../ha/energy";
import DeviceCard, { EmptyState } from "../ui/DeviceCard";
import Icon from "../ui/Icon";

export default function Rooms({ onOpen }: { onOpen: (key: string) => void }) {
  const { devices } = useHa();
  const [query, setQuery] = useState("");
  const rooms = useMemo(() => groupByArea(filterDevices(devices, query, "all", [])), [devices, query]);

  return (
    <div className="page">
      <div className="toolbar2">
        <label className="search-box">
          <Icon name="search" size={16} />
          <input placeholder="Oda ya da cihaz ara…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="room-jump">
          {rooms.map(([area]) => (
            <a key={area} href={`#room-${encodeURIComponent(area)}`} className="chip-link">
              {area}
            </a>
          ))}
        </div>
      </div>

      {rooms.length === 0 && <EmptyState title="Eşleşen cihaz yok" text="Arama ifadesini değiştirmeyi dene." />}

      {rooms.map(([area, list]) => {
        const on = list.filter(deviceIsOn).length;
        const watts = list.reduce((s, d) => s + (d.power && !Number.isNaN(Number(d.power.state)) ? Number(d.power.state) : 0), 0);
        const hasPower = list.some((d) => d.power && !Number.isNaN(Number(d.power.state)));
        return (
          <section key={area} id={`room-${encodeURIComponent(area)}`} className="section">
            <div className="section-head">
              <h2>{area}</h2>
              <span className="section-meta">
                {list.length} cihaz · {on} açık{hasPower ? ` · ${fmtWatts(watts)}` : ""}
              </span>
            </div>
            <div className="grid-wrap">
              <div className="device-grid">
                {list.map((d) => (
                  <DeviceCard key={d.key} device={d} onOpen={onOpen} />
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
