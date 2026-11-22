import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Connection, HassEntities } from "home-assistant-js-websocket";
import { ERR_INVALID_AUTH } from "home-assistant-js-websocket";
import { connect, fetchRegistries, watchEntities, watchRegistries, Registries } from "./ha/client";
import { HaSettings, loadSettings, saveSettings, clearSettings, lastUrl } from "./ha/settings";
import { activeStats, buildDevices } from "./ha/devices";
import { fmtWatts, livePower } from "./ha/energy";
import { ConnStatus, ControlsCtx, HaCtx, HaState, useCommandTracker } from "./state/ha";
import { ToastProvider, useToast } from "./state/toast";
import { usePrefs } from "./state/prefs";
import { isAppVisible, useDesktopSync } from "./state/desktop";
import { watchPcCommands } from "./state/pcControl";
import { setLang, t } from "./i18n";
import Login from "./components/Login";
import Automations from "./components/Automations";
import SmartButtons from "./components/SmartButtons";
import Motion from "./components/Motion";
import Vacuum from "./components/Vacuum";
import Sidebar, { NAV, Page } from "./layout/Sidebar";
import Header from "./layout/Header";
import Home from "./pages/Home";
import Rooms from "./pages/Rooms";
import AllDevices from "./pages/AllDevices";
import EnergyPage from "./pages/EnergyPage";
import Cameras from "./pages/Cameras";
import SettingsPage from "./pages/SettingsPage";
import DeviceDrawer from "./ui/DeviceDrawer";
import Icon from "./ui/Icon";
import "./App.css";
import "./styles/shell.css";

function useNarrow(px: number) {
  const [narrow, setNarrow] = useState(() => window.matchMedia(`(max-width: ${px}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const h = () => setNarrow(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [px]);
  return narrow;
}

function AppInner() {
  const { notify } = useToast();
  const [settings, setSettings] = useState<HaSettings | null>(null);
  const [booting, setBooting] = useState(true);
  const [conn, setConn] = useState<Connection | null>(null);
  const [entities, setEntities] = useState<HassEntities>({});
  const [registries, setRegistries] = useState<Registries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [page, setPage] = useState<Page>("dashboard");
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Kimlik Bilgisi Yöneticisi'nde kayıtlı giriş (varsa) */
  const [saved, setSaved] = useState<HaSettings | null>(null);
  /** Kayıtlı girişle bağlanmaya çalışırken kullanıcı giriş ekranını istedi mi */
  const [showLogin, setShowLogin] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const unsubRef = useRef<(() => void) | null>(null);
  const cancelRef = useRef(false);
  const { prefs, update } = usePrefs();
  setLang(prefs.lang); // çocuklar çizilmeden önce dil ayarlı olsun
  const narrow = useNarrow(1000);
  const pcControlRef = useRef(prefs.pcControl);
  pcControlRef.current = prefs.pcControl;
  useDesktopSync(prefs.closeToTray, prefs.hotkey, prefs.lang, (msg) => notify("error", msg, { key: "hotkey" }));

  /* Pencere tepsideyken durum değişiklikleri arayüzü yeniden çizdirmesin:
     son hali sakla, pencere görünür olunca tek seferde uygula. */
  const pendingEntities = useRef<HassEntities | null>(null);
  const onEntities = useCallback((e: HassEntities) => {
    if (!isAppVisible()) {
      pendingEntities.current = e;
      return;
    }
    pendingEntities.current = null;
    setEntities(e);
  }, []);
  useEffect(() => {
    const h = () => {
      if (isAppVisible() && pendingEntities.current) {
        setEntities(pendingEntities.current);
        pendingEntities.current = null;
      }
    };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  /**
   * Bağlan. auto=true (kayıtlı girişle açılış): HA'ya ulaşılamazsa vazgeçmez,
   * birkaç saniyede bir yeniden dener; yalnızca token geçersizse giriş ekranına düşer.
   */
  const start = useCallback(
    async (s: HaSettings, persist: boolean, auto = false) => {
      setBusy(true);
      setError(null);
      setStatus("connecting");
      cancelRef.current = false;
      for (let n = 1; ; n++) {
        try {
          const c = await connect(s.url, s.token);
          if (persist) await saveSettings(s);
          setSaved(s);
          setSettings(s);
          setRegistries(await fetchRegistries(c));
          const unsubEntities = watchEntities(c, onEntities);
          const unsubRegistry = watchRegistries(c, setRegistries);
          const unsubPc = watchPcCommands(c, () => pcControlRef.current, (kind, text) => notify(kind, text, { key: `pc:${text}`, cooldownMs: 1500 }));
          unsubRef.current = () => {
            unsubEntities();
            unsubPc();
            unsubRegistry();
          };

          // Bağlantı yaşam döngüsü: kütüphane kopunca kendisi yeniden bağlanır
          c.addEventListener("disconnected", () => {
            setStatus("reconnecting");
            notify("warning", t("Home Assistant bağlantısı kesildi. Yeniden bağlanılıyor…"), { key: "conn", cooldownMs: 20_000 });
          });
          c.addEventListener("ready", () => {
            setStatus("connected");
            notify("success", t("Bağlantı yeniden sağlandı."), { key: "conn-ok", cooldownMs: 10_000 });
            // Kopukken eklenen/silinen cihazlar için kayıtları tazele (durumlar abonelikle zaten gelir)
            fetchRegistries(c).then(setRegistries).catch(() => {});
          });
          c.addEventListener("reconnect-error", (_conn, err) => {
            if (err === ERR_INVALID_AUTH) {
              setStatus("disconnected");
              notify("error", t("Token geçersiz hale geldi; yeniden giriş gerekli."), { key: "auth" });
              setError(t("Token geçersiz."));
              setShowLogin(true);
              setConn(null);
            }
          });
          setConn(c);
          setStatus("connected");
          (window as unknown as { __ev?: unknown }).__ev = { conn: c }; // hata ayıklama için
          break;
        } catch (e) {
          const msg = (e as Error).message;
          const authError = (e as Error).name === "AuthError";
          if (!auto || authError || cancelRef.current) {
            setError(msg);
            setStatus("disconnected");
            if (authError) setShowLogin(true);
            break;
          }
          setAttempt(n);
          await new Promise((r) => setTimeout(r, Math.min(15_000, 2_000 * n)));
          if (cancelRef.current) break;
        }
      }
      setBusy(false);
    },
    [notify, onEntities],
  );

  // Kayıtlı giriş varsa otomatik bağlan
  useEffect(() => {
    loadSettings()
      .then((s) => {
        setSaved(s);
        setBooting(false);
        if (s) return start(s, false, true);
      })
      .catch((e) => {
        setError(t("Kayıtlı token okunamadı: {e}", { e: String(e) }));
        setBooting(false);
      });
  }, [start]);

  // Uygulama kapanırken abonelik ve bağlantıyı temizle
  useEffect(
    () => () => {
      unsubRef.current?.();
    },
    [],
  );

  async function logout() {
    unsubRef.current?.();
    conn?.close();
    await clearSettings();
    setSaved(null);
    setSettings(null);
    setConn(null);
    setEntities({});
    setRegistries(null);
    setShowLogin(true);
  }

  const connected = status === "connected";
  const commands = useCommandTracker(entities, conn, connected);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dil değişince etiketler yeniden üretilsin
  const devices = useMemo(() => (registries ? buildDevices(entities, registries) : []), [entities, registries, prefs.lang]);
  const controls = useMemo(() => ({ status, commands }), [status, commands]);

  /* ---------------- Giriş / bağlanma ekranları ---------------- */

  if (booting) return <div className="login muted">{t("Bağlanıyor…")}</div>;

  if (saved && !conn && !showLogin && (busy || !error)) {
    return (
      <div className="login">
        <div className="login-card connecting">
          <h1>Ev Kontrol</h1>
          <div className="spinner" />
          <p>{t("Home Assistant'a bağlanılıyor…")}</p>
          {attempt > 0 && (
            <p className="muted small">
              {t("{url} şu an yanıt vermiyor, tekrar deneniyor ({n}. deneme). Ağ ya da HA açılınca kendiliğinden bağlanır.", { url: saved.url, n: attempt })}
            </p>
          )}
          <button
            className="link"
            onClick={() => {
              cancelRef.current = true;
              setShowLogin(true);
            }}
          >
            {t("Farklı adres / token ile giriş yap")}
          </button>
        </div>
      </div>
    );
  }

  if (!conn || !registries || !settings) {
    return (
      <Login
        initial={{ url: settings?.url ?? saved?.url ?? lastUrl() ?? "http://homeassistant.local:8123", token: "" }}
        hasSavedToken={!!saved}
        error={error}
        busy={busy}
        onSubmit={(s) => {
          // Token alanı boş bırakıldıysa kayıtlı token kullanılır
          const token = s.token || saved?.token || "";
          setShowLogin(false);
          start({ url: s.url, token }, true);
        }}
      />
    );
  }

  /* ---------------- Ana kabuk ---------------- */

  const ha: HaState = { conn, entities, registries, devices, settings, status, commands };
  const openDevice = devices.find((d) => d.key === openKey);
  const navLabel = NAV.find((n) => n.page === page)?.label;
  const title = navLabel ? t(navLabel) : "";
  const onCount = activeStats(devices).on;
  const live = livePower(entities);
  const roomCount = new Set(devices.map((d) => d.area)).size;
  const summary = [
    t("{n} cihaz açık", { n: onCount }),
    live.items.length ? fmtWatts(live.total) : t("güç verisi yok"),
    t("{n} oda", { n: roomCount }),
  ].join(" · ");
  const collapsed = prefs.sidebarCollapsed || narrow;

  return (
    <HaCtx.Provider value={ha}>
      <ControlsCtx.Provider value={controls}>
        <div className="app" key={prefs.lang}>
          <Sidebar
            page={page}
            onNavigate={setPage}
            collapsed={collapsed}
            onToggleCollapsed={() => update((p) => ({ ...p, sidebarCollapsed: !collapsed }))}
            conn={conn}
            entities={entities}
            status={status}
            url={settings.url}
          />
          <div className="main">
            <Header title={title} summary={summary} status={status} onSettings={() => setPage("settings")} />
            {!connected && (
              <div className="offline-banner" role="alert">
                <Icon name="alert" size={16} />
                {status === "reconnecting"
                  ? t("Home Assistant bağlantısı kesildi; yeniden bağlanılıyor. Gösterilen değerler güncel olmayabilir.")
                  : t("Home Assistant'a bağlı değil. Gösterilen değerler güncel değil.")}
              </div>
            )}
            <main className={`content ${connected ? "" : "stale"}`} key={page}>
              {page === "dashboard" && <Home onOpen={setOpenKey} onNavigate={setPage} />}
              {page === "rooms" && <Rooms onOpen={setOpenKey} />}
              {page === "devices" && <AllDevices onOpen={setOpenKey} />}
              {page === "buttons" && (
                <SmartButtons conn={conn} entities={entities} registries={registries} baseUrl={settings.url} token={settings.token} />
              )}
              {page === "motion" && (
                <Motion conn={conn} entities={entities} registries={registries} baseUrl={settings.url} token={settings.token} />
              )}
              {page === "cameras" && <Cameras />}
              {page === "vacuum" &&<Vacuum conn={conn} entities={entities} registries={registries} baseUrl={settings.url} />}
              {page === "automations" && <Automations conn={conn} entities={entities} baseUrl={settings.url} token={settings.token} />}
              {page === "energy" && <EnergyPage />}
              {page === "settings" && <SettingsPage onLogout={logout} />}
            </main>
          </div>
          {openDevice && <DeviceDrawer device={openDevice} onClose={() => setOpenKey(null)} />}
        </div>
      </ControlsCtx.Provider>
    </HaCtx.Provider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
