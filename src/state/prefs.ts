// Kullanıcı tercihleri (favoriler, sidebar). Yerel ve kalıcı; depolama yoksa sessizce varsayılana döner.
import { useCallback, useEffect, useState } from "react";
import { defaultLang, type Lang } from "../i18n";

const KEY = "ha-desktop.prefs";

export interface Prefs {
  /** Sıralı favori listesi (cihaz anahtarı = device_id ya da entity_id) */
  favorites: string[];
  sidebarCollapsed: boolean;
  /** Kapat düğmesi uygulamayı kapatmaz, tepsiye gizler */
  closeToTray: boolean;
  /** Pencereyi aç/gizle genel kısayolu ("" = kapalı) */
  hotkey: string;
  /** Home Assistant'tan (Siri) gelen bilgisayar komutlarını çalıştır */
  pcControl: boolean;
  /** Arayüz dili */
  lang: Lang;
}

const DEFAULTS: Prefs = { favorites: [], sidebarCollapsed: false, closeToTray: true, hotkey: "Ctrl+Alt+H", pcControl: true, lang: defaultLang() };

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function write(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* depolama yoksa yoksay */
  }
}

// Tüm bileşenler aynı tercihi görsün diye basit bir yayın mekanizması
const listeners = new Set<(p: Prefs) => void>();
let current: Prefs | null = null;

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => (current ??= read()));

  useEffect(() => {
    listeners.add(setPrefs);
    return () => {
      listeners.delete(setPrefs);
    };
  }, []);

  const update = useCallback((fn: (p: Prefs) => Prefs) => {
    const next = fn(current ?? read());
    current = next;
    write(next);
    listeners.forEach((l) => l(next));
  }, []);

  const isFavorite = useCallback((key: string) => prefs.favorites.includes(key), [prefs.favorites]);
  const toggleFavorite = useCallback(
    (key: string) =>
      update((p) => ({
        ...p,
        favorites: p.favorites.includes(key) ? p.favorites.filter((k) => k !== key) : [...p.favorites, key],
      })),
    [update],
  );
  /** from konumundaki favoriyi to konumuna taşır */
  const moveFavorite = useCallback(
    (from: number, to: number) =>
      update((p) => {
        const f = [...p.favorites];
        if (from < 0 || from >= f.length || to < 0 || to >= f.length) return p;
        const [x] = f.splice(from, 1);
        f.splice(to, 0, x);
        return { ...p, favorites: f };
      }),
    [update],
  );

  return { prefs, update, isFavorite, toggleFavorite, moveFavorite };
}
