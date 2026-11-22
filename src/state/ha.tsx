import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Connection, HassEntities, HassEntity } from "home-assistant-js-websocket";
import type { Registries } from "../ha/client";
import { lockAction, pressButton, toggle } from "../ha/client";
import type { DeviceItem } from "../ha/devices";
import { domainOf, friendly } from "../ha/devices";
import type { HaSettings } from "../ha/settings";
import { useToast } from "./toast";
import { t, tk } from "../i18n";

export type ConnStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface HaState {
  conn: Connection;
  entities: HassEntities;
  registries: Registries;
  devices: DeviceItem[];
  settings: HaSettings;
  status: ConnStatus;
  commands: CommandTracker;
}

export const HaCtx = createContext<HaState | null>(null);

export function useHa() {
  const c = useContext(HaCtx);
  if (!c) throw new Error("useHa HaCtx dışında kullanıldı");
  return c;
}

/**
 * Yalnızca bağlantı durumu + komutlar. Varlık güncellemeleri (saniyede birkaç kez) bu bağlamı
 * değiştirmez; böylece kartlar sadece kendi verileri değişince yeniden çizilir.
 */
export interface HaControls {
  status: ConnStatus;
  commands: CommandTracker;
}
export const ControlsCtx = createContext<HaControls | null>(null);

export function useHaControls() {
  const c = useContext(ControlsCtx);
  if (!c) throw new Error("useHaControls ControlsCtx dışında kullanıldı");
  return c;
}

/* ================= Komut takibi ================= */

export interface CommandTracker {
  /** Varlık için komut gönder; sonuç HA'dan gelen gerçek durumla doğrulanır. */
  run: (e: HassEntity, label?: string) => Promise<void>;
  /** Özel servis çağrısı + doğrulama (parlaklık, sıcaklık vb.) */
  call: (e: HassEntity, fn: () => Promise<unknown>, opts?: { label?: string; silent?: boolean }) => Promise<void>;
  pending: Set<string>;
  failed: Set<string>;
}

interface PendingInfo {
  prevState: string;
  prevUpdated: string;
  startedAt: number;
  label: string;
  silent: boolean;
}

const VERIFY_TIMEOUT_MS = 8000;

const STATE_WORD: Record<string, string> = {
  on: tk("{label} açıldı."), off: tk("{label} kapatıldı."), locked: tk("{label} kilitlendi."), unlocked: tk("{label} kilidi açıldı."),
  open: tk("{label} açıldı."), closed: tk("{label} kapatıldı."), opening: tk("{label} açılıyor."), closing: tk("{label} kapanıyor."),
  playing: tk("{label} oynatılıyor."), paused: tk("{label} duraklatıldı."), cleaning: tk("{label} temizliğe başladı."),
  returning: tk("{label} istasyona dönüyor."), docked: tk("{label} istasyonda."),
};

export function useCommandTracker(entities: HassEntities, conn: Connection | null, connected: boolean): CommandTracker {
  const { notify } = useToast();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const info = useRef(new Map<string, PendingInfo>());
  const entRef = useRef(entities);
  entRef.current = entities;

  const finish = useCallback((id: string) => {
    info.current.delete(id);
    setPending((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
  }, []);

  const markFailed = useCallback((id: string) => {
    setFailed((f) => new Set(f).add(id));
    setTimeout(
      () =>
        setFailed((f) => {
          const n = new Set(f);
          n.delete(id);
          return n;
        }),
      5000,
    );
  }, []);

  // Durum değişince doğrula
  useEffect(() => {
    for (const [id, p] of info.current) {
      const e = entities[id];
      if (!e) continue;
      if (e.state !== p.prevState || e.last_updated !== p.prevUpdated) {
        finish(id);
        if (e.state === "unavailable") {
          notify("error", t("{label}: cihaza ulaşılamıyor.", { label: p.label }));
          markFailed(id);
        } else if (!p.silent) {
          const d = domainOf(id);
          const word = STATE_WORD[e.state];
          notify(
            "success",
            d === "scene"
              ? t("{label} sahnesi çalıştırıldı.", { label: p.label })
              : d === "script" || d === "button"
                ? t("{label} çalıştırıldı.", { label: p.label })
                : t(word ?? tk("{label}: komut uygulandı."), { label: p.label }),
          );
        }
      }
    }
  }, [entities, finish, markFailed, notify]);

  // Zaman aşımı denetimi
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [id, p] of info.current) {
        if (now - p.startedAt > VERIFY_TIMEOUT_MS) {
          finish(id);
          notify("warning", t("{label}: komut gönderildi ama cihaz durumu değişmedi.", { label: p.label }));
          markFailed(id);
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [finish, markFailed, notify]);

  const call = useCallback<CommandTracker["call"]>(
    async (e, fn, opts) => {
      const id = e.entity_id;
      const label = opts?.label ?? friendly(e);
      if (!conn || !connected) {
        notify("error", t("Home Assistant bağlantısı yok; komut gönderilemedi."), { key: "cmd-offline", cooldownMs: 5000 });
        return;
      }
      if (info.current.has(id)) return; // aynı cihaza üst üste komut gönderme
      const cur = entRef.current[id] ?? e;
      info.current.set(id, {
        prevState: cur.state,
        prevUpdated: cur.last_updated,
        startedAt: Date.now(),
        label,
        silent: !!opts?.silent,
      });
      setPending((p) => new Set(p).add(id));
      try {
        await fn();
      } catch (err) {
        finish(id);
        markFailed(id);
        notify("error", `${label}: ${(err as { message?: string })?.message ?? t("komut başarısız")}`);
      }
    },
    [conn, connected, finish, markFailed, notify],
  );

  const run = useCallback<CommandTracker["run"]>(
    (e, label) => {
      const id = e.entity_id;
      const d = domainOf(id);
      return call(
        e,
        () => {
          if (!conn) throw new Error(t("Bağlantı yok"));
          if (d === "lock") return lockAction(conn, id, e.state === "locked");
          if (["button", "input_button", "script", "scene"].includes(d)) return pressButton(conn, id);
          return toggle(conn, id, e.state);
        },
        { label },
      );
    },
    [call, conn],
  );

  return useMemo(() => ({ run, call, pending, failed }), [run, call, pending, failed]);
}
