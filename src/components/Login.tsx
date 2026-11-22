import { useState } from "react";
import { HaSettings } from "../ha/settings";
import { t } from "../i18n";

interface Props {
  initial: HaSettings | null;
  /** Kayıtlı bir token var → alan boş bırakılırsa o kullanılır */
  hasSavedToken?: boolean;
  error: string | null;
  busy: boolean;
  onSubmit: (s: HaSettings) => void;
}

export default function Login({ initial, hasSavedToken, error, busy, onSubmit }: Props) {
  const [url, setUrl] = useState(initial?.url ?? "http://homeassistant.local:8123");
  const [token, setToken] = useState(initial?.token ?? "");

  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ url: url.trim(), token: token.trim() });
        }}
      >
        <h1>Ev Kontrol</h1>
        <p className="muted">{t("Home Assistant'a bağlan")}</p>

        <label>
          {t("Adres")}
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123" />
        </label>

        <label>
          {t("Uzun ömürlü erişim jetonu")}
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={hasSavedToken ? t("Kayıtlı token kullanılacak") : "eyJhbGciOi..."}
          />
        </label>
        <p className="hint">
          {hasSavedToken ? (
            <>{t("Token bu bilgisayarda kayıtlı; değiştirmek istemiyorsan boş bırak.")}</>
          ) : (
            <>{t("HA → Profil → Güvenlik → Uzun ömürlü erişim jetonları → Jeton oluştur. Bir kez girmen yeter; Windows'ta güvenle saklanır.")}</>
          )}
        </p>

        {error && <div className="error">{error}</div>}

        <button type="submit" disabled={busy || !url || (!token && !hasSavedToken)}>
          {busy ? t("Bağlanıyor…") : t("Bağlan")}
        </button>
      </form>
    </div>
  );
}
