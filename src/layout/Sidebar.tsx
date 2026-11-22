import type { Connection, HassEntities } from "home-assistant-js-websocket";
import Icon from "../ui/Icon";
import EnergyWidget from "../components/EnergyWidget";
import PrayerTimes from "../components/PrayerTimes";
import type { ConnStatus } from "../state/ha";

export type Page =
  | "dashboard" | "rooms" | "devices" | "buttons" | "motion" | "cameras" | "vacuum" | "automations" | "energy" | "settings";

export const NAV: { page: Page; label: string; icon: string }[] = [
  { page: "dashboard", label: "Kontrol Paneli", icon: "home" },
  { page: "rooms", label: "Odalar", icon: "rooms" },
  { page: "devices", label: "Tüm Cihazlar", icon: "devices" },
  { page: "buttons", label: "Akıllı Düğmeler", icon: "button" },
  { page: "motion", label: "Hareket Sensörleri", icon: "motion" },
  { page: "cameras", label: "Kameralar", icon: "camera" },
  { page: "vacuum", label: "Robot Süpürge", icon: "vacuum" },
  { page: "automations", label: "Otomasyonlar", icon: "automation" },
  { page: "energy", label: "Enerji", icon: "energy" },
  { page: "settings", label: "Ayarlar", icon: "settings" },
];

export const STATUS_TEXT: Record<ConnStatus, string> = {
  connecting: "Bağlanıyor",
  connected: "Bağlı",
  reconnecting: "Yeniden bağlanıyor",
  disconnected: "Bağlantı kesildi",
};

interface Props {
  page: Page;
  onNavigate: (p: Page) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  conn: Connection;
  entities: HassEntities;
  status: ConnStatus;
  url: string;
}

export default function Sidebar({ page, onNavigate, collapsed, onToggleCollapsed, conn, entities, status, url }: Props) {
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <span className="brand-mark">
          <Icon name="home" size={18} />
        </span>
        {!collapsed && <span className="brand-name">Ev Kontrol</span>}
        <button
          className="icon-btn collapse-btn"
          onClick={onToggleCollapsed}
          title={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
          aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}
        >
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} />
        </button>
      </div>

      <nav className="nav" aria-label="Sayfalar">
        {NAV.map((n) => (
          <button
            key={n.page}
            className={`nav-item ${page === n.page ? "active" : ""}`}
            onClick={() => onNavigate(n.page)}
            title={collapsed ? n.label : undefined}
            aria-current={page === n.page ? "page" : undefined}
          >
            <Icon name={n.icon} size={18} />
            {!collapsed && <span>{n.label}</span>}
          </button>
        ))}
      </nav>

      {!collapsed && (
        <div className="widgets">
          <EnergyWidget conn={conn} entities={entities} onOpen={() => onNavigate("energy")} connected={status === "connected"} />
          <PrayerTimes entities={entities} />
        </div>
      )}

      <div className="sidebar-foot" title={url}>
        <span className={`dot ${status}`} />
        {!collapsed && (
          <div className="foot-text">
            <span>{STATUS_TEXT[status]}</span>
            <span className="muted small">{url.replace(/^https?:\/\//, "")}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
