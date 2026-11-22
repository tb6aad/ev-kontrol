//! Bilgisayar kontrolü: Home Assistant'tan (Siri → HomeKit → HA betiği → "ev_kontrol_command" olayı)
//! gelen komutları çalıştırır. Yalnızca aşağıdaki sabit liste kabul edilir; kabuk komutu, dosya yolu
//! ya da serbest metin alınmaz.

#[cfg(windows)]
mod win {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Power::SetSuspendState;
    use windows_sys::Win32::System::Shutdown::LockWorkStation;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP};
    use windows_sys::Win32::UI::WindowsAndMessaging::{PostMessageW, HWND_BROADCAST, SC_MONITORPOWER, WM_SYSCOMMAND};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    pub fn key(vk: u8, times: u32) {
        for _ in 0..times {
            unsafe {
                keybd_event(vk, 0, 0, 0);
                keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
            }
        }
    }

    pub fn lock() -> Result<(), String> {
        if unsafe { LockWorkStation() } != 0 { Ok(()) } else { Err("Kilitlenemedi".into()) }
    }

    pub fn monitor_off() {
        unsafe {
            PostMessageW(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER as usize, 2);
        }
    }

    pub fn sleep() {
        // HA'ya yanıtın gitmesi için kısa bir süre sonra uyut
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_secs(2));
            unsafe {
                SetSuspendState(0, 0, 0);
            }
        });
    }

    pub fn shutdown(cancel: bool) -> Result<(), String> {
        let args: &[&str] = if cancel {
            &["/a"]
        } else {
            &["/s", "/t", "60", "/c", "Ev Kontrol: Home Assistant / Siri ile kapatma istendi. İptal için 'kapatmayı iptal et' de."]
        };
        let st = Command::new("shutdown")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| e.to_string())?;
        if st.success() { Ok(()) } else if cancel { Err("İptal edilecek bir kapatma yok".into()) } else { Err("Kapatma başlatılamadı".into()) }
    }
}

// Sanal tuş kodları
const VK_VOLUME_MUTE: u8 = 0xAD;
const VK_VOLUME_DOWN: u8 = 0xAE;
const VK_VOLUME_UP: u8 = 0xAF;
const VK_MEDIA_NEXT: u8 = 0xB0;
const VK_MEDIA_PREV: u8 = 0xB1;
const VK_MEDIA_PLAY_PAUSE: u8 = 0xB3;

/// Kabul edilen komutlar ve kullanıcıya gösterilecek açıklamaları
pub const COMMANDS: &[(&str, &str)] = &[
    ("lock", "Bilgisayarı kilitle"),
    ("sleep", "Bilgisayarı uyut"),
    ("monitor_off", "Ekranı kapat"),
    ("mute", "Sesi kapat / aç"),
    ("volume_up", "Sesi aç (+10%)"),
    ("volume_down", "Sesi kıs (−10%)"),
    ("play_pause", "Müziği oynat / duraklat"),
    ("next", "Sonraki parça"),
    ("previous", "Önceki parça"),
    ("shutdown", "Bilgisayarı kapat (60 sn sonra)"),
    ("shutdown_cancel", "Kapatmayı iptal et"),
];

#[tauri::command]
pub fn pc_command(command: String) -> Result<String, String> {
    let label = COMMANDS
        .iter()
        .find(|(c, _)| *c == command)
        .map(|(_, l)| *l)
        .ok_or_else(|| format!("Bilinmeyen komut: {command}"))?;
    #[cfg(windows)]
    {
        use win::*;
        match command.as_str() {
            "lock" => lock()?,
            "sleep" => sleep(),
            "monitor_off" => monitor_off(),
            "mute" => key(VK_VOLUME_MUTE, 1),
            "volume_up" => key(VK_VOLUME_UP, 5), // her basış %2
            "volume_down" => key(VK_VOLUME_DOWN, 5),
            "play_pause" => key(VK_MEDIA_PLAY_PAUSE, 1),
            "next" => key(VK_MEDIA_NEXT, 1),
            "previous" => key(VK_MEDIA_PREV, 1),
            "shutdown" => shutdown(false)?,
            // HomeKit'teki "Bilgisayar" anahtarını açmak da bunu gönderir; bekleyen kapatma yoksa hata sayma
            "shutdown_cancel" => {
                if shutdown(true).is_err() {
                    return Ok("Bilgisayar açık (bekleyen kapatma yok)".to_string());
                }
            }
            _ => unreachable!(),
        }
        Ok(label.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (VK_VOLUME_MUTE, VK_VOLUME_DOWN, VK_VOLUME_UP, VK_MEDIA_NEXT, VK_MEDIA_PREV, VK_MEDIA_PLAY_PAUSE);
        Err(format!("{label}: yalnızca Windows'ta destekleniyor"))
    }
}

/// Bilgisayar adı (birden çok bilgisayar varsa komut hedefini seçmek için)
#[tauri::command]
pub fn pc_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_default()
}
