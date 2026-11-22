import type { Connection, HassEntities } from "home-assistant-js-websocket";
import Icon from "../ui/Icon";
import EnergyWidget from "../components/EnergyWidget";
import PrayerTimes from "../components/PrayerTimes";
import type { ConnStatus } from "../state/ha";
import { t, tk } from "../i18n";

export type Page =
  | "dashboard" | "rooms" | "devices" | "buttons" | "motion" | "cameras" | "vacuum" | "automations" | "energy" | "settings";

export const NAV: { page: Page; label: string; icon: string }[] = [
  { page: "dashboard", label: tk("Kontrol Paneli"), icon: "home" },
  { page: "rooms", label: tk("Odalar"), icon: "rooms" },
  { page: "devices", label: tk("Tüm Cihazlar"), icon: "devices" },
  { page: "buttons", label: tk("Akıllı Düğmeler"), icon: "button" },
  { page: "motion", label: tk("Hareket Sensörleri"), icon: "motion" },
  { page: "cameras", label: tk("Kameralar"), icon: "camera" },
  { page: "vacuum", label: tk("Robot Süpürge"), icon: "vacuum" },
  { page: "automations", label: tk("Otomasyonlar"), icon: "automation" },
  { page: "energy", label: tk("Enerji"), icon: "energy" },
  { page: "settings", label: tk("Ayarlar"), icon: "settings" },
];

export const STATUS_TEXT: Record<ConnStatus, string> = {
  connecting: tk("Bağlanıyor"),
  connected: tk("Bağlı"),
  reconnecting: tk("Yeniden bağlanıyor"),
  disconnected: tk("Bağlantı kesildi"),
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
          title={collapsed ? t("Menüyü genişlet") : t("Menüyü daralt")}
          aria-label={collapsed ? t("Menüyü genişlet") : t("Menüyü daralt")}
        >
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} />
        </button>
      </div>

      <nav className="nav" aria-label={t("Sayfalar")}>
        {NAV.map((n) => (
          <button
            key={n.page}
            className={`nav-item ${page === n.page ? "active" : ""}`}
            onClick={() => onNavigate(n.page)}
            title={collapsed ? t(n.label) : undefined}
            aria-current={page === n.page ? "page" : undefined}
          >
            <Icon name={n.icon} size={18} />
            {!collapsed && <span>{t(n.label)}</span>}
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
            <span>{t(STATUS_TEXT[status])}</span>
            <span className="muted small">{url.replace(/^https?:\/\//, "")}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
