// Bağlantı ayarları.
// Masaüstü uygulamasında token Windows Credential Manager'da tutulur.
// Tarayıcıda (geliştirme önizlemesi) localStorage'a düşer.
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface HaSettings {
  url: string; // ör. http://homeassistant.local:8123
  token: string; // Long-Lived Access Token
}

const KEY = "ha-desktop.settings";

interface Stored {
  url: string;
  token?: string; // yalnızca tarayıcıda ya da eski sürümden kalma
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

export async function loadSettings(): Promise<HaSettings | null> {
  const s = readStored();
  if (!s?.url) return null;

  if (!isTauri()) return s.token ? { url: s.url, token: s.token } : null;

  // Eski sürümden localStorage'da token kaldıysa Credential Manager'a taşı
  if (s.token) {
    await invoke("token_save", { token: s.token });
    localStorage.setItem(KEY, JSON.stringify({ url: s.url }));
    return { url: s.url, token: s.token };
  }
  const token = await invoke<string | null>("token_load");
  return token ? { url: s.url, token } : null;
}

export async function saveSettings(s: HaSettings) {
  if (isTauri()) {
    await invoke("token_save", { token: s.token });
    localStorage.setItem(KEY, JSON.stringify({ url: s.url }));
  } else {
    localStorage.setItem(KEY, JSON.stringify(s));
  }
}

export async function clearSettings() {
  const s = readStored();
  // Adresi hatırla, token'ı sil
  localStorage.setItem(KEY, JSON.stringify({ url: s?.url ?? "" }));
  if (isTauri()) await invoke("token_delete");
}

/** Giriş ekranında adresi önceden doldurmak için. */
export function lastUrl(): string | null {
  return readStored()?.url || null;
}
