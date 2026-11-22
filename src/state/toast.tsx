import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../ui/Icon";
import { t } from "../i18n";

export type ToastKind = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  at: number;
  /** Aynı anahtarlı bildirimler kısa sürede tekrarlanmaz (bağlantı hatası yağmuru vb.) */
  key?: string;
}

interface ToastApi {
  notify: (kind: ToastKind, text: string, opts?: { key?: string; cooldownMs?: number }) => void;
  history: ToastItem[];
  unread: number;
  markRead: () => void;
  clearHistory: () => void;
}

const Ctx = createContext<ToastApi | null>(null);

const MAX_VISIBLE = 4;
const MAX_HISTORY = 40;
const LIFETIME: Record<ToastKind, number> = { success: 3000, info: 3500, warning: 6000, error: 7000 };
const ICON: Record<ToastKind, string> = { success: "check", info: "info", warning: "alert", error: "xCircle" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState<ToastItem[]>([]);
  const [history, setHistory] = useState<ToastItem[]>([]);
  const [unread, setUnread] = useState(0);
  const lastByKey = useRef(new Map<string, number>());
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setVisible((v) => v.filter((t) => t.id !== id)), []);

  const notify = useCallback<ToastApi["notify"]>((kind, text, opts) => {
    const now = Date.now();
    if (opts?.key) {
      const last = lastByKey.current.get(opts.key);
      if (last && now - last < (opts.cooldownMs ?? 30_000)) return;
      lastByKey.current.set(opts.key, now);
    }
    const t: ToastItem = { id: ++seq.current, kind, text, at: now, key: opts?.key };
    setVisible((v) => [...v.filter((x) => !(opts?.key && x.key === opts.key)), t].slice(-MAX_VISIBLE));
    setHistory((h) => [t, ...h].slice(0, MAX_HISTORY));
    setUnread((n) => n + 1);
    setTimeout(() => dismiss(t.id), LIFETIME[kind]);
  }, [dismiss]);

  const api = useMemo<ToastApi>(
    () => ({
      notify,
      history,
      unread,
      markRead: () => setUnread(0),
      clearHistory: () => {
        setHistory([]);
        setUnread(0);
      },
    }),
    [notify, history, unread],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {visible.map((item) => (
          <div key={item.id} className={`toast2 ${item.kind}`}>
            <Icon name={ICON[item.kind]} size={18} />
            <span>{item.text}</span>
            <button className="toast-x" onClick={() => dismiss(item.id)} aria-label={t("Kapat|pencere")}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast ToastProvider dışında kullanıldı");
  return c;
}

/** Sayfa dışına tıklama / Esc ile kapanan açılır menüler için küçük yardımcı. */
export function useDismiss(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose, ref]);
}
