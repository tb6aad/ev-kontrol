mod pc;

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WebviewWindow, WindowEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

// Token, Windows Credential Manager'da saklanır (Denetim Masası → Kimlik Bilgisi Yöneticisi).
const SERVICE: &str = "ha-desktop";
const ACCOUNT: &str = "home-assistant-token";
/// Windows açılışında başlatılırken pencereyi göstermeden tepside başla
const HIDDEN_ARG: &str = "--hidden";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command]
fn token_save(token: String) -> Result<(), String> {
    entry()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn token_load() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn token_delete() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/* ---------------- Tepsi / pencere davranışı ---------------- */

struct Behavior {
    close_to_tray: Mutex<bool>,
    hotkey: Mutex<Option<Shortcut>>,
}

/// Tepsi menüsü öğeleri (arayüz dili değişince metinleri güncellenir)
struct TrayItems {
    show: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

#[tauri::command]
fn set_tray_labels(items: State<TrayItems>, show: String, quit: String) -> Result<(), String> {
    items.show.set_text(show).map_err(|e| e.to_string())?;
    items.quit.set_text(quit).map_err(|e| e.to_string())
}

/// Gizliyken WebView2'yi "görünmez" işaretle (çizim ve zamanlayıcılar durur, sayfa
/// visibilitychange alır) ve bellek hedefini düşür; gösterilince eski haline döndür.
fn set_webview_active(w: &WebviewWindow, active: bool) {
    #[cfg(windows)]
    let _ = w.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;
        let controller = wv.controller();
        let _ = controller.SetIsVisible(active);
        if let Ok(core) = controller.CoreWebView2() {
            if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
                let level = if active {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                };
                let _ = c19.SetMemoryUsageTargetLevel(level);
            }
        }
    });
    #[cfg(not(windows))]
    let _ = (w, active);
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        set_webview_active(&w, true);
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn hide_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
        set_webview_active(&w, false);
    }
}

fn is_shown(w: &WebviewWindow) -> bool {
    w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false)
}

/// Kısayol: pencere öndeyse gizle, değilse öne getir
fn hotkey_toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if is_shown(&w) && w.is_focused().unwrap_or(false) {
            hide_main(app);
        } else {
            show_main(app);
        }
    }
}

/// Tepsi tıklaması: tıklama odağı aldığı için yalnızca görünürlüğe bakılır
fn tray_toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if is_shown(&w) {
            hide_main(app);
        } else {
            show_main(app);
        }
    }
}

#[tauri::command]
fn set_close_to_tray(state: State<Behavior>, enabled: bool) {
    *state.close_to_tray.lock().unwrap() = enabled;
}

/// Genel kısayolu değiştir (boş = kapalı). Yeni kısayol alınamazsa eskisi geri yüklenir.
#[tauri::command]
fn set_hotkey(app: AppHandle, state: State<Behavior>, accel: Option<String>) -> Result<(), String> {
    let new = match accel.as_deref().map(str::trim) {
        Some(a) if !a.is_empty() => Some(a.parse::<Shortcut>().map_err(|e| format!("Geçersiz kısayol: {e}"))?),
        _ => None,
    };
    let gs = app.global_shortcut();
    let mut cur = state.hotkey.lock().unwrap();
    if *cur == new {
        return Ok(());
    }
    let old = cur.take();
    if let Some(o) = old {
        let _ = gs.unregister(o);
    }
    if let Some(s) = new {
        if let Err(e) = gs.register(s) {
            if let Some(o) = old {
                if gs.register(o).is_ok() {
                    *cur = Some(o);
                }
            }
            return Err(format!("Kısayol alınamadı; başka bir uygulama kullanıyor olabilir ({e})"));
        }
        *cur = Some(s);
    }
    Ok(())
}

#[tauri::command]
fn autostart_get(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn autostart_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // İkinci kez açılırsa yeni kopya başlatma; var olan pencereyi öne getir
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _sc, ev| {
                    if ev.state() == ShortcutState::Pressed {
                        hotkey_toggle(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Behavior { close_to_tray: Mutex::new(true), hotkey: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            token_save,
            token_load,
            token_delete,
            set_close_to_tray,
            set_hotkey,
            autostart_get,
            autostart_set,
            set_tray_labels,
            pc::pc_command,
            pc::pc_name
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Ev Kontrol'ü aç", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Ev Kontrol")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        tray_toggle(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            app.manage(TrayItems { show, quit });

            if std::env::args().any(|a| a == HIDDEN_ARG) {
                hide_main(app.handle());
            } else {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|w, e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                if w.label() == "main" && *w.state::<Behavior>().close_to_tray.lock().unwrap() {
                    api.prevent_close();
                    hide_main(w.app_handle());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
