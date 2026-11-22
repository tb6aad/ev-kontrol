import { useCallback, useEffect, useMemo, useState } from "react";
import type { Connection, HassEntities } from "home-assistant-js-websocket";
import { stringify } from "yaml";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AutomationConfig, AutomationItem, DeletedBackup, addBackup, asArray, deleteAutomation, describeAction,
  describeCondition, describeTrigger, getConfig, listAutomations, loadBackups, relTime, removeBackup, runNow,
  saveAutomation, setEnabled,
} from "../ha/automations";
import Toggle from "./Toggle";
import AutomationEditor from "./AutomationEditor";

type Editing = { mode: "new" } | { mode: "edit" | "copy"; config: AutomationConfig };

interface Props {
  conn: Connection;
  entities: HassEntities;
  baseUrl: string;
  token: string;
}

type Filter = "all" | "on" | "off";

const triggersOf = (c: AutomationConfig) => asArray(c.triggers ?? c.trigger);
const conditionsOf = (c: AutomationConfig) => asArray(c.conditions ?? c.condition);
const actionsOf = (c: AutomationConfig) => asArray(c.actions ?? c.action);

export default function Automations({ conn, entities, baseUrl, token }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [configs, setConfigs] = useState<Record<string, AutomationConfig>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [backups, setBackups] = useState<DeletedBackup[]>(loadBackups);

  const items = useMemo(() => listAutomations(entities), [entities]);
  const names = useCallback(
    (id: string) => (entities[id]?.attributes.friendly_name as string) || id,
    [entities],
  );

  // Liste altyazıları için yapılandırmaları bir kez çek (yeni otomasyon gelirse onu da)
  const idsKey = items.map((i) => i.entityId).join(",");
  useEffect(() => {
    let alive = true;
    const missing = items.filter((i) => !configs[i.entityId]);
    if (missing.length === 0) return;
    Promise.all(
      missing.map((i) =>
        getConfig(conn, i.entityId)
          .then((c) => [i.entityId, c] as const)
          .catch(() => null),
      ),
    ).then((res) => {
      if (!alive) return;
      setConfigs((prev) => {
        const n = { ...prev };
        for (const r of res) if (r) n[r[0]] = r[1];
        return n;
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, idsKey]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = query.toLocaleLowerCase("tr");
    return items.filter((i) => {
      if (filter === "on" && !i.enabled) return false;
      if (filter === "off" && i.enabled) return false;
      if (q && !i.name.toLocaleLowerCase("tr").includes(q)) return false;
      return true;
    });
  }, [items, query, filter]);

  async function withBusy(id: string, fn: () => Promise<unknown>, okMsg?: string) {
    setBusy((b) => new Set(b).add(id));
    try {
      await fn();
      if (okMsg) setToast(okMsg);
    } catch (e) {
      setToast(`Hata: ${(e as { message?: string })?.message ?? String(e)}`);
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(id);
        return n;
      });
    }
  }

  const onCount = items.filter((i) => i.enabled).length;
  const open = openId ? items.find((i) => i.entityId === openId) : undefined;
  const [editing, setEditing] = useState<Editing | null>(null);

  if (editing) {
    return (
      <AutomationEditor
        conn={conn}
        entities={entities}
        baseUrl={baseUrl}
        token={token}
        initial={editing.mode === "new" ? undefined : editing.config}
        copy={editing.mode === "copy"}
        onClose={(savedName) => {
          setEditing(null);
          if (savedName) {
            setToast(`"${savedName}" kaydedildi`);
            setConfigs({}); // özetleri yeniden çek
          }
        }}
      />
    );
  }

  return (
    <div className="automations">
      <div className="toolbar">
        <button className="btn-primary" onClick={() => setEditing({ mode: "new" })}>
          + Yeni otomasyon
        </button>
        <input className="search" placeholder="Otomasyon ara…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chips">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            Tümü ({items.length})
          </button>
          <button className={filter === "on" ? "active" : ""} onClick={() => setFilter("on")}>
            Açık ({onCount})
          </button>
          <button className={filter === "off" ? "active" : ""} onClick={() => setFilter("off")}>
            Kapalı ({items.length - onCount})
          </button>
        </div>
      </div>

      {filtered.length === 0 && <div className="placeholder">Otomasyon bulunamadı.</div>}

      <div className="auto-list">
        {filtered.map((a) => {
          const c = configs[a.entityId];
          const trig = c ? triggersOf(c).map((t) => describeTrigger(t, names)) : [];
          return (
            <div
              key={a.entityId}
              className={`auto-row ${a.enabled ? "" : "disabled"}`}
              onClick={() => setOpenId(a.entityId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setOpenId(a.entityId)}
            >
              <Toggle
                on={a.enabled}
                disabled={busy.has(a.entityId)}
                onChange={() => withBusy(a.entityId, () => setEnabled(conn, a.entityId, !a.enabled))}
              />
              <div className="auto-text">
                <span className="auto-name">
                  {a.name}
                  {a.running > 0 && <span className="badge">çalışıyor</span>}
                </span>
                <span className="auto-sub">
                  {trig.length ? trig.join(" · ") : c?.description || "…"}
                </span>
              </div>
              <span className="auto-last" title={a.lastTriggered?.toLocaleString("tr-TR") ?? ""}>
                {relTime(a.lastTriggered)}
              </span>
              <button
                className="btn-small"
                disabled={busy.has(a.entityId)}
                onClick={(e) => {
                  e.stopPropagation();
                  withBusy(a.entityId, () => runNow(conn, a.entityId), `"${a.name}" çalıştırıldı`);
                }}
                title="Koşulları atlayıp şimdi çalıştır"
              >
                ▶ Çalıştır
              </button>
            </div>
          );
        })}
      </div>

      {backups.length > 0 && (
        <section className="backups">
          <h2>Son silinenler</h2>
          {backups.map((b) => (
            <div key={`${b.config.id}-${b.deletedAt}`} className="auto-row static">
              <div className="auto-text">
                <span className="auto-name">{b.config.alias || b.config.id}</span>
                <span className="auto-sub">{new Date(b.deletedAt).toLocaleString("tr-TR")} tarihinde silindi</span>
              </div>
              <button
                className="btn-small"
                onClick={() =>
                  withBusy(`backup-${b.config.id}`, async () => {
                    await saveAutomation(baseUrl, token, b.config);
                    setBackups(removeBackup(b.config.id));
                  }, "Geri yüklendi")
                }
              >
                ↺ Geri yükle
              </button>
              <button className="btn-small ghost" onClick={() => setBackups(removeBackup(b.config.id))} title="Yedeği unut">
                ✕
              </button>
            </div>
          ))}
        </section>
      )}

      {open && (
        <AutomationDetail
          item={open}
          config={configs[open.entityId]}
          names={names}
          busy={busy.has(open.entityId)}
          baseUrl={baseUrl}
          onClose={() => setOpenId(null)}
          onReload={async () => {
            const c = await getConfig(conn, open.entityId);
            setConfigs((p) => ({ ...p, [open.entityId]: c }));
          }}
          onEdit={(mode) => {
            const cfg = configs[open.entityId];
            if (!cfg) return;
            setOpenId(null);
            setEditing({ mode, config: { ...cfg, id: cfg.id ?? open.configId } });
          }}
          onRun={() => withBusy(open.entityId, () => runNow(conn, open.entityId), `"${open.name}" çalıştırıldı`)}
          onToggle={() => withBusy(open.entityId, () => setEnabled(conn, open.entityId, !open.enabled))}
          onDelete={() =>
            withBusy(
              open.entityId,
              async () => {
                if (!open.configId) throw new Error("Bu otomasyon YAML dosyasında elle tanımlı; buradan silinemez.");
                const cfg = configs[open.entityId] ?? (await getConfig(conn, open.entityId));
                setBackups(addBackup({ ...cfg, id: cfg.id ?? open.configId }));
                await deleteAutomation(baseUrl, token, open.configId);
                setOpenId(null);
              },
              `"${open.name}" silindi (yedeği alındı)`,
            )
          }
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ---------------- Detay penceresi ---------------- */

interface DetailProps {
  item: AutomationItem;
  config: AutomationConfig | undefined;
  names: (id: string) => string;
  busy: boolean;
  baseUrl: string;
  onClose: () => void;
  onReload: () => Promise<void>;
  onEdit: (mode: "edit" | "copy") => void;
  onRun: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

const MODE_TR: Record<string, string> = {
  single: "Tek (çalışırken yeniden tetiklenmez)",
  restart: "Yeniden başlat",
  queued: "Sıraya al",
  parallel: "Paralel",
};

function AutomationDetail({ item, config, names, busy, baseUrl, onClose, onReload, onEdit, onRun, onToggle, onDelete }: DetailProps) {
  const [confirm, setConfirm] = useState(false);
  const [showYaml, setShowYaml] = useState(false);

  useEffect(() => {
    onReload().catch(() => {});
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.entityId]);

  const editUrl = item.configId ? `${baseUrl.replace(/\/+$/, "")}/config/automation/edit/${item.configId}` : null;

  const block = (title: string, lines: string[], empty: string) => (
    <section>
      <h4>{title}</h4>
      {lines.length === 0 ? (
        <div className="muted small">{empty}</div>
      ) : (
        <ol className="steps">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      )}
    </section>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <span className="modal-icon">🤖</span>
          <div style={{ minWidth: 0 }}>
            <h3>{item.name}</h3>
            <span className="muted small">
              Son çalışma: {relTime(item.lastTriggered)} · {MODE_TR[item.mode] ?? item.mode}
            </span>
          </div>
          <button className="close" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>

        {config?.description && <p className="auto-desc">{config.description}</p>}

        <div className="detail-actions">
          <label className="inline-toggle">
            <Toggle on={item.enabled} disabled={busy} onChange={onToggle} />
            {item.enabled ? "Etkin" : "Devre dışı"}
          </label>
          <button className="btn-small" disabled={busy} onClick={onRun}>
            ▶ Şimdi çalıştır
          </button>
          {item.configId && (
            <button className="btn-small" disabled={!config} onClick={() => onEdit("edit")}>
              ✎ Düzenle
            </button>
          )}
          <button className="btn-small" disabled={!config} onClick={() => onEdit("copy")}>
            ⧉ Kopyala
          </button>
          {editUrl && (
            <button
              className="btn-small"
              onClick={() => (isTauri() ? openUrl(editUrl) : window.open(editUrl, "_blank"))}
            >
              HA'da düzenle ↗
            </button>
          )}
        </div>

        {!config ? (
          <div className="muted small" style={{ marginTop: 16 }}>Yükleniyor…</div>
        ) : (
          <>
            {block("Ne zaman (tetikleyiciler)", triggersOf(config).map((t) => describeTrigger(t, names)), "Tetikleyici yok")}
            {block("Eğer (koşullar)", conditionsOf(config).map((c) => describeCondition(c, names)), "Koşul yok — her tetiklenişte çalışır")}
            {block("Yap (eylemler)", actionsOf(config).map((a) => describeAction(a, names)), "Eylem yok")}

            <button className="link" style={{ marginTop: 14 }} onClick={() => setShowYaml((s) => !s)}>
              {showYaml ? "YAML'ı gizle" : "YAML'ı göster"}
            </button>
            {showYaml && <pre className="yaml">{stringify(config)}</pre>}
          </>
        )}

        <div className="danger-zone">
          {!confirm ? (
            <button className="btn-small danger" disabled={busy || !item.configId} onClick={() => setConfirm(true)}
              title={item.configId ? "" : "YAML dosyasında elle tanımlı otomasyonlar buradan silinemez"}>
              Sil
            </button>
          ) : (
            <div className="confirm">
              <span>"{item.name}" silinsin mi? Yedeği "Son silinenler"e alınır.</span>
              <button className="btn-small danger" disabled={busy} onClick={onDelete}>
                Evet, sil
              </button>
              <button className="btn-small" onClick={() => setConfirm(false)}>
                Vazgeç
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
