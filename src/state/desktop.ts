// Masaüstü davranışı: pencere görünürlüğü, tepsi, genel kısayol, Windows ile başlatma.
import { useEffect, useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { t } from "../i18n";

/* ---------- Görünürlük ----------
 * Pencere tepsiye gizlenince Rust tarafı WebView2'yi görünmez yapar ve sayfa
 * "visibilitychange" alır. Akışlar, zamanlayıcılar ve arayüz güncellemeleri buna bağlanır
 * ki arka planda neredeyse hiç işlemci/bellek harcanmasın. */

const subscribe = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};
const snapshot = () => document.visibilityState === "visible";

export const isAppVisible = snapshot;

/** Pencere görünürken true. Gizliyken akış/sorgu/zamanlayıcıları durdurmak için. */
export function useAppVisible(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}

/* ---------- Kısayol ---------- */

export const DEFAULT_HOTKEY = "Ctrl+Alt+H";

const MOD_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"]);

/** Klavye olayını "Ctrl+Alt+H" biçimine çevirir. Yalnızca değiştirici tuşsa ya da
 *  güvenli olmayan bir tuşsa null. Fiziksel tuş (e.code) kullanılır: Türkçe klavyede de aynı. */
export function accelFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (MOD_KEYS.has(e.key)) return null;
  let key: string | null = null;
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(c)) key = c;
  else if (c === "Space") key = "Space";
  if (!key) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  // Harf/rakam tek başına ya da yalnız Shift ile genel kısayol olamaz (yazmayı bozar)
  const strong = e.ctrlKey || e.altKey || e.metaKey;
  if (!strong && !/^F/.test(key)) return null;
  return [...mods, key].join("+");
}

/** Kullanıcıya gösterim: "Ctrl + Alt + H" (Super → Win) */
export function prettyAccel(a: string): string {
  return a.split("+").map((p) => (p === "Super" ? "Win" : p)).join(" + ");
}

/* ---------- Rust ile eşitleme ---------- */

export async function applyCloseToTray(enabled: boolean) {
  if (isTauri()) await invoke("set_close_to_tray", { enabled });
}

export async function applyHotkey(accel: string | null) {
  if (isTauri()) await invoke("set_hotkey", { accel });
}

export async function getAutostart(): Promise<boolean | null> {
  if (!isTauri()) return null;
  return invoke<boolean>("autostart_get");
}

export async function setAutostart(enabled: boolean) {
  if (isTauri()) await invoke("autostart_set", { enabled });
}

/** Tercihleri açılışta ve her değişimde Rust'a ilet. Kısayol alınamazsa onError çağrılır. */
export function useDesktopSync(closeToTray: boolean, hotkey: string, lang: string, onError: (msg: string) => void) {
  useEffect(() => {
    if (isTauri()) invoke("set_tray_labels", { show: t("Ev Kontrol'ü aç"), quit: t("Çıkış") }).catch(() => {});
  }, [lang]);
  useEffect(() => {
    applyCloseToTray(closeToTray).catch(() => {});
  }, [closeToTray]);
  useEffect(() => {
    applyHotkey(hotkey || null).catch((e) => {
      // Rust hata metni Türkçe; bilinenleri çevir
      const s = String(e);
      onError(
        s.startsWith("Geçersiz kısayol")
          ? t("Geçersiz kısayol.")
          : s.startsWith("Kısayol alınamadı")
            ? t("Kısayol alınamadı; başka bir uygulama kullanıyor olabilir.")
            : s,
      );
    });
    // onError kararlı olmayabilir; yalnızca kısayol değişince yeniden kaydet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkey]);
}
