import { useEffect, useRef, useState } from "react";
import { useAppVisible } from "../state/desktop";
import Icon from "../ui/Icon";
import { useDismiss, useToast } from "../state/toast";
import type { ConnStatus } from "../state/ha";
import { STATUS_TEXT } from "./Sidebar";

interface Props {
  title: string;
  summary?: string;
  status: ConnStatus;
  onSettings: () => void;
}

const KIND_ICON = { success: "check", error: "xCircle", warning: "alert", info: "info" } as const;

export default function Header({ title, summary, status, onSettings }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const { history, unread, markRead, clearHistory } = useToast();
  const popRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), popRef);

  const visible = useAppVisible();
  useEffect(() => {
    if (!visible) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, [visible]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="eyebrow">Ev Kontrol</span>
        <h1>{title}</h1>
        {summary && <span className="topbar-summary">{summary}</span>}
      </div>

      <div className="topbar-right">
        <div className="clock" title={now.toLocaleString("tr-TR")}>
          <span className="clock-time">{now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="clock-date">{now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" })}</span>
        </div>

        <span className={`conn-pill ${status}`} role="status">
          <span className={`dot ${status}`} />
          {STATUS_TEXT[status]}
        </span>

        <div className="pop-wrap" ref={popRef}>
          <button
            className="icon-btn"
            aria-label={`Bildirimler${unread ? ` (${unread} yeni)` : ""}`}
            title="Bildirimler"
            onClick={() => {
              setOpen((o) => !o);
              markRead();
            }}
          >
            <Icon name="bell" size={18} />
            {unread > 0 && <span className="badge-count">{unread > 9 ? "9+" : unread}</span>}
          </button>
          {open && (
            <div className="popover notif-pop">
              <div className="pop-head">
                <b>Bildirimler</b>
                {history.length > 0 && (
                  <button className="link" onClick={clearHistory}>
                    Temizle
                  </button>
                )}
              </div>
              {history.length === 0 ? (
                <div className="empty-mini">Henüz bildirim yok.</div>
              ) : (
                <ul className="notif-list">
                  {history.map((h) => (
                    <li key={h.id} className={h.kind}>
                      <Icon name={KIND_ICON[h.kind]} size={15} />
                      <span>{h.text}</span>
                      <time>{new Date(h.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <button className="icon-btn" title="Ayarlar" aria-label="Ayarlar" onClick={onSettings}>
          <Icon name="settings" size={18} />
        </button>
      </div>
    </header>
  );
}
