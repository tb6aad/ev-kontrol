// Bilgisayar kontrolü: HA'da bir betik "ev_kontrol_command" olayını { command, target? } ile
// tetikler, uygulama dinler ve Rust tarafında izin verilen komutu çalıştırır.
// Siri → Apple Ev sahnesi → HomeKit köprüsündeki HA betiği → bu olay → bilgisayar.
import type { Connection } from "home-assistant-js-websocket";
import { invoke, isTauri } from "@tauri-apps/api/core";

export const PC_EVENT = "ev_kontrol_command";

/** Kabul edilen komutlar (Rust'taki pc::COMMANDS ile aynı) ve HA'daki betik adları */
export const PC_COMMANDS: { command: string; label: string; script: string }[] = [
  { command: "lock", label: "Bilgisayarı kilitle", script: "bilgisayari_kilitle" },
  { command: "sleep", label: "Bilgisayarı uyut", script: "bilgisayari_uyut" },
  { command: "monitor_off", label: "Ekranı kapat", script: "bilgisayar_ekranini_kapat" },
  { command: "mute", label: "Sesi kapat / aç", script: "bilgisayar_sesini_kapat" },
  { command: "volume_up", label: "Sesi aç (+%10)", script: "bilgisayar_sesini_ac" },
  { command: "volume_down", label: "Sesi kıs (−%10)", script: "bilgisayar_sesini_kis" },
  { command: "play_pause", label: "Müziği oynat / duraklat", script: "bilgisayar_muzik_oynat_duraklat" },
  { command: "next", label: "Sonraki parça", script: "bilgisayar_sonraki_parca" },
  { command: "previous", label: "Önceki parça", script: "bilgisayar_onceki_parca" },
  { command: "shutdown", label: "Bilgisayarı kapat (60 sn sonra)", script: "bilgisayari_kapat" },
  { command: "shutdown_cancel", label: "Kapatmayı iptal et", script: "bilgisayar_kapatmayi_iptal_et" },
];

type Report = (kind: "success" | "error", text: string) => void;

/**
 * Komut olaylarını dinlemeye başla. isEnabled her olayda okunur (ayar anında etkili olur).
 * Dönen fonksiyon aboneliği bırakır. Bağlantı kopup gelince kütüphane aboneliği kendisi yeniler.
 */
export function watchPcCommands(conn: Connection, isEnabled: () => boolean, report: Report): () => void {
  if (!isTauri()) return () => {};
  let name = "";
  invoke<string>("pc_name").then((n) => (name = n)).catch(() => {});
  const known = new Set(PC_COMMANDS.map((c) => c.command));
  const unsub = conn.subscribeEvents<{ data?: { command?: unknown; target?: unknown } }>((ev) => {
    const command = ev.data?.command;
    const target = ev.data?.target;
    if (!isEnabled() || typeof command !== "string" || !known.has(command)) return;
    // Birden çok bilgisayar varsa: hedef verilmişse yalnızca o bilgisayar çalıştırır
    if (typeof target === "string" && target && name && target.toLowerCase() !== name.toLowerCase()) return;
    invoke<string>("pc_command", { command })
      .then((label) => report("success", `${label} · Home Assistant komutu`))
      .catch((e) => report("error", `Bilgisayar komutu çalıştırılamadı: ${e}`));
  }, PC_EVENT);
  return () => {
    unsub.then((u) => u()).catch(() => {});
  };
}
