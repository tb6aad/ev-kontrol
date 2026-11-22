import { useEffect, useState } from "react";
import { accelFromEvent, DEFAULT_HOTKEY, getAutostart, prettyAccel, setAutostart } from "../state/desktop";
import { useToast } from "../state/toast";
import { PC_COMMANDS } from "../state/pcControl";
import { useHa } from "../state/ha";
import { usePrefs } from "../state/prefs";
import { STATUS_TEXT } from "../layout/Sidebar";
import { LANGS, t } from "../i18n";
import Toggle from "../components/Toggle";
import Icon from "../ui/Icon";

interface Props {
  onLogout: () => void;
}

export default function SettingsPage({ onLogout }: Props) {
  const { settings, status, devices, entities } = useHa();
  const { prefs, update, moveFavorite, toggleFavorite } = usePrefs();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const byKey = new Map(devices.map((d) => [d.key, d]));
  const version = (entities["update.home_assistant_core_update"]?.attributes.installed_version as string) ?? null;

  return (
    <div className="page narrow">
      <section className="panel-card">
        <div className="panel-head"><h2>Dil · Language</h2></div>
        <div className="setting-row">
          <span>
            <b>{t("Arayüz dili")}</b>
            <span className="muted small">{t("Cihaz ve oda adları Home Assistant'taki gibi kalır.")}</span>
          </span>
          <div className="seg small" role="radiogroup" aria-label="Dil · Language">
            {LANGS.map((l) => (
              <button
                key={l.id}
                role="radio"
                aria-checked={prefs.lang === l.id}
                className={prefs.lang === l.id ? "active" : ""}
                onClick={() => update((p) => ({ ...p, lang: l.id }))}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head"><h2>{t("Home Assistant bağlantısı")}</h2></div>
        <dl className="kv">
          <dt>{t("Adres")}</dt><dd>{settings.url}</dd>
          <dt>{t("Durum")}</dt><dd><span className={`dot ${status}`} /> {t(STATUS_TEXT[status])}</dd>
          {version && (<><dt>{t("HA sürümü")}</dt><dd>{version}</dd></>)}
          <dt>{t("Kimlik")}</dt><dd>{t("Uzun ömürlü erişim jetonu · Windows Kimlik Bilgisi Yöneticisi'nde saklanıyor (burada gösterilmez)")}</dd>
          <dt>{t("Cihaz")}</dt><dd>{t("{d} cihaz · {e} varlık", { d: devices.length, e: Object.keys(entities).length })}</dd>
        </dl>
        <div className="row-actions">
          {!confirmLogout ? (
            <button className="btn-small danger" onClick={() => setConfirmLogout(true)}>{t("Çıkış yap ve token'ı sil")}</button>
          ) : (
            <div className="confirm">
              <span>{t("Kayıtlı token bu bilgisayardan silinecek; bir dahaki açılışta tekrar girmen gerekecek.")}</span>
              <button className="btn-small danger" onClick={onLogout}>{t("Evet, çıkış yap")}</button>
              <button className="btn-small" onClick={() => setConfirmLogout(false)}>{t("Vazgeç")}</button>
            </div>
          )}
        </div>
      </section>

      <DesktopSettings />

      <PcControlSettings />

      <section className="panel-card">
        <div className="panel-head"><h2>{t("Görünüm")}</h2></div>
        <label className="setting-row">
          <span>
            <b>{t("Kenar çubuğunu daralt")}</b>
            <span className="muted small">{t("Yalnızca ikonlar gösterilir; enerji ve namaz kutuları gizlenir.")}</span>
          </span>
          <Toggle on={prefs.sidebarCollapsed} onChange={() => update((p) => ({ ...p, sidebarCollapsed: !p.sidebarCollapsed }))} />
        </label>
        <p className="muted small">
          {t("Animasyonlar Windows'un \"Animasyon efektleri\" ayarını izler; kapalıysa uygulamada da kapanır.")}
        </p>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <h2>{t("Favoriler")}</h2>
          <span className="section-meta">{t("Kontrol Paneli'ndeki sıra")}</span>
        </div>
        {prefs.favorites.length === 0 ? (
          <div className="empty-mini">{t("Henüz favori yok. Cihaz kartlarındaki yıldızla ekleyebilirsin.")}</div>
        ) : (
          <ol className="fav-list">
            {prefs.favorites.map((k, i) => {
              const d = byKey.get(k);
              return (
                <li key={k}>
                  <span className="fav-name">{d ? d.name : <span className="muted">{t("Artık bulunmayan cihaz")}</span>}</span>
                  <span className="muted small">{d?.area}</span>
                  <button className="icon-btn small" disabled={i === 0} onClick={() => moveFavorite(i, i - 1)} aria-label={t("Yukarı taşı")}><Icon name="arrowUp" size={14} /></button>
                  <button className="icon-btn small" disabled={i === prefs.favorites.length - 1} onClick={() => moveFavorite(i, i + 1)} aria-label={t("Aşağı taşı")}><Icon name="arrowDown" size={14} /></button>
                  <button className="icon-btn small" onClick={() => toggleFavorite(k)} aria-label={t("Favorilerden çıkar")}><Icon name="close" size={14} /></button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

/* ---------- Masaüstü: tepsi, kısayol, Windows ile başlat ---------- */

function DesktopSettings() {
  const { prefs, update } = usePrefs();
  const { notify } = useToast();
  const [autostart, setAuto] = useState<boolean | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    getAutostart().then(setAuto).catch(() => setAuto(null));
  }, []);

  const toggleAutostart = async () => {
    if (autostart === null) return;
    setAutoBusy(true);
    try {
      await setAutostart(!autostart);
      setAuto(await getAutostart());
    } catch (e) {
      notify("error", t("Windows ile başlatma ayarlanamadı: {e}", { e: String(e) }));
    } finally {
      setAutoBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return setRecording(false);
    const a = accelFromEvent(e);
    if (!a) return; // değiştirici tuşa ya da geçersiz tuşa basılıyor; beklemeye devam
    setRecording(false);
    update((p) => ({ ...p, hotkey: a }));
  };

  return (
    <section className="panel-card">
      <div className="panel-head"><h2>{t("Masaüstü")}</h2></div>
      <label className="setting-row">
        <span>
          <b>{t("Kapatınca tepsiye gizle")}</b>
          <span className="muted small">
            {t("Pencereyi kapatınca uygulama saatin yanındaki simgeye küçülür, bağlantı açık kalır. Gizliyken kamera akışı, grafik sorguları ve ekran güncellemeleri durur; tamamen kapatmak için tepsi simgesine sağ tıklayıp Çıkış'ı seç.")}
          </span>
        </span>
        <Toggle on={prefs.closeToTray} onChange={() => update((p) => ({ ...p, closeToTray: !p.closeToTray }))} />
      </label>
      <label className="setting-row">
        <span>
          <b>{t("Windows açılınca başlat")}</b>
          <span className="muted small">
            {autostart === null ? t("Bu ortamda kullanılamıyor.") : t("Oturum açınca pencere göstermeden tepside başlar.")}
          </span>
        </span>
        <Toggle on={!!autostart} busy={autoBusy} disabled={autostart === null} onChange={toggleAutostart} />
      </label>
      <div className="setting-row">
        <span>
          <b>{t("Aç / gizle kısayolu")}</b>
          <span className="muted small">{t("Hangi uygulamadayken basarsan bas pencereyi öne getirir; öndeyse gizler.")}</span>
        </span>
        <span className="hotkey-tools">
          {recording ? (
            <button className="btn-small active-soft hotkey-rec" autoFocus onKeyDown={onKey} onBlur={() => setRecording(false)}>
              {t("Tuşlara bas… (Esc: vazgeç)")}
            </button>
          ) : (
            <button className="btn-small" onClick={() => setRecording(true)} title={t("Değiştirmek için tıkla")}>
              {prefs.hotkey ? <kbd>{prettyAccel(prefs.hotkey)}</kbd> : t("Kapalı")}
            </button>
          )}
          {prefs.hotkey !== DEFAULT_HOTKEY && (
            <button className="link" onClick={() => update((p) => ({ ...p, hotkey: DEFAULT_HOTKEY }))}>{t("Varsayılan")}</button>
          )}
          {prefs.hotkey && (
            <button className="link" onClick={() => update((p) => ({ ...p, hotkey: "" }))}>{t("Kapat|kısayol")}</button>
          )}
        </span>
      </div>
    </section>
  );
}

/* ---------- Bilgisayar kontrolü (Siri / Home Assistant) ---------- */

function PcControlSettings() {
  const { prefs, update } = usePrefs();
  const { entities } = useHa();
  const ready = PC_COMMANDS.filter((c) => entities[`script.${c.script}`]).length;
  return (
    <section className="panel-card">
      <div className="panel-head">
        <h2>{t("Bilgisayar kontrolü")}</h2>
        <span className="section-meta">{t("{n} / {total} komut HA'da hazır", { n: ready, total: PC_COMMANDS.length })}</span>
      </div>
      <label className="setting-row">
        <span>
          <b>{t("Home Assistant komutlarını çalıştır")}</b>
          <span className="muted small">
            {t("HA'daki \"Bilgisayar…\" betikleri bu bilgisayara komut gönderir. Uygulama açık ya da tepsideyken çalışır; yalnızca aşağıdaki komutlar kabul edilir.")}
          </span>
        </span>
        <Toggle on={prefs.pcControl} onChange={() => update((p) => ({ ...p, pcControl: !p.pcControl }))} />
      </label>
      <div className="setting-row">
        <span>
          <b>{t("Siri (Apple Ev)")}</b>
          <span className="muted small">
            {t("Ev uygulamasında iki aksesuar var.")} <b>Bilgisayar</b>:{" "}
            {t("\"Hey Siri, bilgisayarı kapat\" (60 sn sonra kapanır), \"bilgisayarı aç\" (kapatmayı iptal eder).")} <b>Bilgisayar ekranı</b>:{" "}
            {t("\"Hey Siri, bilgisayar ekranını kilitle\".")}
            {(!entities["switch.bilgisayar"] || !entities["lock.bilgisayar_ekrani"]) && " " + t("(HA'da bu aksesuarlardan biri bulunamadı.)")}
          </span>
        </span>
      </div>
      <ul className="pc-cmds">
        {PC_COMMANDS.map((c) => {
          const ok = !!entities[`script.${c.script}`];
          return (
            <li key={c.command} className={ok ? "" : "missing"}>
              <span>{t(c.label)}</span>
              <code className="muted small">{ok ? `script.${c.script}` : t("HA'da betik yok")}</code>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
