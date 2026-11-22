import { memo } from "react";
import type { DeviceItem } from "../ha/devices";
import { PRESS_DOMAINS, deviceIsOn, domainOf, extraInfo, formatState, iconName, isSwitchable, isUnavailable } from "../ha/devices";
import { useHaControls } from "../state/ha";
import { usePrefs } from "../state/prefs";
import Toggle from "../components/Toggle";
import Icon from "./Icon";

interface Props {
  device: DeviceItem;
  onOpen: (key: string) => void;
  /** Sürükle-bırak için (favoriler) */
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  dragging?: boolean;
}

function DeviceCardInner({ device: d, onOpen, draggable, onDragStart, onDragOver, onDrop, dragging }: Props) {
  const { commands, status } = useHaControls();
  const { isFavorite, toggleFavorite } = usePrefs();
  const p = d.primary;
  const id = p.entity_id;
  const dom = domainOf(id);
  const offline = status !== "connected";
  const unavailable = isUnavailable(p);
  const busy = commands.pending.has(id);
  const failed = commands.failed.has(id);
  const on = deviceIsOn(d);
  const fav = isFavorite(d.key);
  const extras = extraInfo(d);

  const stateText = busy ? "Komut gönderiliyor…" : failed ? "Komut doğrulanamadı" : formatState(p);
  const cls = [
    "dcard",
    on && "on",
    unavailable && "unavailable",
    busy && "busy",
    failed && "failed",
    offline && "stale",
    dragging && "dragging",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(d.key)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(d.key))}
      aria-label={`${d.name}, ${stateText}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDragOver?.();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
    >
      <div className="dcard-top">
        <span className="dcard-icon">
          <Icon name={iconName(p)} size={20} />
        </span>
        {isSwitchable(p) ? (
          <Toggle
            on={on}
            busy={busy}
            disabled={offline}
            label={`${d.name} ${on ? "kapat" : "aç"}`}
            onChange={() => commands.run(p, d.name)}
          />
        ) : PRESS_DOMAINS.has(dom) && !unavailable ? (
          <button
            className="icon-btn small"
            disabled={offline || busy}
            title="Çalıştır"
            aria-label={`${d.name} çalıştır`}
            onClick={(e) => {
              e.stopPropagation();
              commands.run(p, d.name);
            }}
          >
            <Icon name="play" size={14} />
          </button>
        ) : null}
      </div>

      <div className="dcard-mid">
        <span className="dcard-name" title={d.name}>
          {d.name}
        </span>
        <span className="dcard-state">{stateText}</span>
      </div>

      <div className="dcard-bottom">
        <span className="dcard-extra">{extras.length ? extras.join(" · ") : " "}</span>
        <button
          className={`fav-btn ${fav ? "active" : ""}`}
          title={fav ? "Favorilerden çıkar" : "Favorilere ekle"}
          aria-label={fav ? "Favorilerden çıkar" : "Favorilere ekle"}
          aria-pressed={fav}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(d.key);
          }}
        >
          <Icon name="star" size={15} filled={fav} />
        </button>
      </div>
    </div>
  );
}

/** Çok cihazda gereksiz yeniden çizimi azaltmak için: yalnızca kendi varlıkları değişince çiz */
const DeviceCard = memo(DeviceCardInner, (a, b) => {
  if (a.dragging !== b.dragging || a.draggable !== b.draggable || a.onOpen !== b.onOpen) return false;
  const ea = a.device.entities;
  const eb = b.device.entities;
  if (ea.length !== eb.length || a.device.name !== b.device.name) return false;
  return ea.every((e, i) => e === eb[i]);
});

export default DeviceCard;

/** Boş sonuç durumu */
export function EmptyState({ icon = "search", title, text }: { icon?: string; title: string; text?: string }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={28} />
      <b>{title}</b>
      {text && <span>{text}</span>}
    </div>
  );
}
