import { useEffect, useMemo, useRef, useState } from "react";
import type { Connection, HassEntities } from "home-assistant-js-websocket";
import { parse, parseDocument, stringify, YAMLSeq, isSeq } from "yaml";
import { AutomationConfig, asArray, saveAutomation } from "../ha/automations";
import YamlEditor, { YamlEditorHandle } from "./YamlEditor";

interface Props {
  conn: Connection;
  entities: HassEntities;
  baseUrl: string;
  token: string;
  /** Düzenlenecek yapılandırma; yoksa yeni otomasyon */
  initial?: AutomationConfig;
  /** Kopya oluşturuluyorsa true (id atılır) */
  copy?: boolean;
  onClose: (savedName?: string) => void;
}

const NEW_TEMPLATE = `alias: Yeni otomasyon
description: ""
mode: single
triggers:
  - trigger: time
    at: "07:00:00"
conditions: []
actions:
  - action: light.turn_on
    target:
      entity_id: light.ornek
`;

/* ---------- Hazır parçalar ---------- */

type Section = "triggers" | "conditions" | "actions";
const SNIPPETS: { section: Section; label: string; item: Record<string, unknown> }[] = [
  { section: "triggers", label: "Saatte", item: { trigger: "time", at: "07:00:00" } },
  { section: "triggers", label: "Durum değişince", item: { trigger: "state", entity_id: "", to: "on" } },
  { section: "triggers", label: "Değer eşiği geçince", item: { trigger: "numeric_state", entity_id: "", above: 25 } },
  { section: "triggers", label: "Gün batımı / doğumu", item: { trigger: "sun", event: "sunset", offset: "-00:15:00" } },
  { section: "triggers", label: "Periyodik", item: { trigger: "time_pattern", minutes: "/15" } },
  { section: "triggers", label: "HA açılınca", item: { trigger: "homeassistant", event: "start" } },
  { section: "conditions", label: "Durum şu ise", item: { condition: "state", entity_id: "", state: "on" } },
  { section: "conditions", label: "Saat aralığı", item: { condition: "time", after: "22:00:00", before: "07:00:00" } },
  { section: "conditions", label: "Hafta içi", item: { condition: "time", weekday: ["mon", "tue", "wed", "thu", "fri"] } },
  { section: "conditions", label: "Güneş battıysa", item: { condition: "sun", after: "sunset" } },
  { section: "conditions", label: "Değer aralığı", item: { condition: "numeric_state", entity_id: "", below: 20 } },
  { section: "actions", label: "Aç", item: { action: "homeassistant.turn_on", target: { entity_id: "" } } },
  { section: "actions", label: "Kapat", item: { action: "homeassistant.turn_off", target: { entity_id: "" } } },
  { section: "actions", label: "Aç / kapat", item: { action: "homeassistant.toggle", target: { entity_id: "" } } },
  { section: "actions", label: "Işık parlaklığı", item: { action: "light.turn_on", target: { entity_id: "" }, data: { brightness_pct: 50 } } },
  { section: "actions", label: "Bekle", item: { delay: "00:05:00" } },
  { section: "actions", label: "Sahne çalıştır", item: { action: "scene.turn_on", target: { entity_id: "" } } },
  { section: "actions", label: "Bildirim gönder", item: { action: "notify.notify", data: { message: "Mesaj" } } },
  { section: "actions", label: "Eğer / değilse", item: { if: [{ condition: "state", entity_id: "", state: "on" }], then: [], else: [] } },
];

const SECTION_TR: Record<Section, string> = { triggers: "Tetikleyiciler", conditions: "Koşullar", actions: "Eylemler" };

/* ---------- Sürüm geçmişi (yerel) ---------- */

interface Version {
  savedAt: string;
  config: AutomationConfig;
}
const histKey = (id: string) => `ha-desktop.history.${id}`;
function loadHistory(id: string | undefined): Version[] {
  if (!id) return [];
  try {
    return JSON.parse(localStorage.getItem(histKey(id)) || "[]");
  } catch {
    return [];
  }
}
function pushHistory(id: string, config: AutomationConfig) {
  const list = [{ savedAt: new Date().toISOString(), config }, ...loadHistory(id)].slice(0, 15);
  try {
    localStorage.setItem(histKey(id), JSON.stringify(list));
  } catch {
    /* depolama dolu olabilir; kaydı engellemesin */
  }
}

/* ---------- Doğrulama ---------- */

interface Validation {
  yamlError: string | null;
  yamlLine: number | null;
  problems: string[];
  unknownEntities: string[];
  config: AutomationConfig | null;
}

function collectEntityIds(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) node.forEach((n) => collectEntityIds(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "entity_id") asArray(v).forEach((x) => typeof x === "string" && x.includes(".") && !x.includes("{") && out.add(x));
      else collectEntityIds(v, out);
    }
  }
}

function validate(text: string, entities: HassEntities): Validation {
  let config: AutomationConfig | null = null;
  try {
    config = parse(text) as AutomationConfig;
  } catch (e) {
    const err = e as { message: string; linePos?: { line: number }[] };
    return {
      yamlError: err.message.split("\n")[0],
      yamlLine: err.linePos?.[0]?.line ?? null,
      problems: [],
      unknownEntities: [],
      config: null,
    };
  }
  const problems: string[] = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { yamlError: "Belge bir otomasyon nesnesi olmalı (alias:, triggers:, actions: …)", yamlLine: 1, problems, unknownEntities: [], config: null };
  }
  if (!config.alias) problems.push("alias (isim) boş");
  if (asArray(config.triggers ?? config.trigger).length === 0) problems.push("En az bir tetikleyici gerekli");
  if (asArray(config.actions ?? config.action).length === 0) problems.push("En az bir eylem gerekli");

  const ids = new Set<string>();
  collectEntityIds(config, ids);
  const unknownEntities = [...ids].filter((id) => !entities[id]);
  if ([...ids].some((id) => id.endsWith("."))) problems.push("Boş bırakılmış entity_id var");
  return { yamlError: null, yamlLine: null, problems, unknownEntities, config };
}

type ServerCheck = Partial<Record<Section, { valid: boolean; error: string | null }>>;

/* ================= Bileşen ================= */

export default function AutomationEditor({ conn, entities, baseUrl, token, initial, copy, onClose }: Props) {
  const startText = useMemo(() => {
    if (!initial) return NEW_TEMPLATE;
    const c = { ...initial };
    if (copy) {
      delete c.id;
      c.alias = `${c.alias ?? "Otomasyon"} (kopya)`;
    }
    // id'yi kullanıcıya göstermeye gerek yok; kaydederken eklenir
    const { id: _omit, ...rest } = c; // eslint-disable-line @typescript-eslint/no-unused-vars
    return stringify(rest, { lineWidth: 0 });
  }, [initial, copy]);

  const configId = copy ? undefined : initial?.id;
  const [text, setText] = useState(startText);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [server, setServer] = useState<ServerCheck | null>(null);
  const [entityQuery, setEntityQuery] = useState("");
  const [history] = useState(() => loadHistory(configId));
  const editor = useRef<YamlEditorHandle>(null);

  const dirty = text !== startText;
  const v = useMemo(() => validate(text, entities), [text, entities]);

  // HA'nın kendi doğrulaması (yazmayı bıraktıktan 700 ms sonra)
  useEffect(() => {
    if (!v.config) {
      setServer(null);
      return;
    }
    const c = v.config;
    const t = setTimeout(() => {
      conn
        .sendMessagePromise<ServerCheck>({
          type: "validate_config",
          triggers: asArray(c.triggers ?? c.trigger),
          conditions: asArray(c.conditions ?? c.condition),
          actions: asArray(c.actions ?? c.action),
        })
        .then(setServer)
        .catch(() => setServer(null));
    }, 700);
    return () => clearTimeout(t);
  }, [v.config, conn]);

  const serverErrors = server
    ? (Object.entries(server) as [Section, { valid: boolean; error: string | null }][])
        .filter(([, r]) => r && !r.valid)
        .map(([k, r]) => `${SECTION_TR[k]}: ${r.error}`)
    : [];
  const blocking = !!v.yamlError || v.problems.length > 0 || serverErrors.length > 0;

  // Kaydedilmemiş değişiklik varken pencereyi kapatma uyarısı
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function close() {
    if (dirty && !window.confirm("Kaydedilmemiş değişiklikler var. Çıkılsın mı?")) return;
    onClose();
  }

  async function save() {
    if (blocking || saving || !v.config) return;
    setSaving(true);
    setSaveError(null);
    try {
      const cfg: AutomationConfig = { ...v.config, id: configId ?? String(Date.now()) };
      if (configId && initial) pushHistory(configId, initial);
      await saveAutomation(baseUrl, token, cfg);
      onClose(cfg.alias);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Parçayı doğru bölümün sonuna ekler (yorumlar korunur); YAML bozuksa imlece yazar. */
  function addSnippet(section: Section, item: Record<string, unknown>) {
    try {
      const doc = parseDocument(text);
      if (doc.errors.length) throw new Error("bozuk");
      const legacy = section.slice(0, -1); // trigger / condition / action
      const key = doc.has(section) ? section : doc.has(legacy) ? legacy : section;
      let seq = doc.get(key);
      if (!isSeq(seq)) {
        const existing = seq ? doc.toJS()[key] : undefined;
        seq = new YAMLSeq();
        if (existing) (seq as YAMLSeq).add(doc.createNode(existing));
        doc.set(key, seq);
      }
      (seq as YAMLSeq).add(doc.createNode(item));
      setText(doc.toString({ lineWidth: 0 }));
    } catch {
      editor.current?.insert(stringify([item]).trimEnd());
    }
  }

  const entityMatches = useMemo(() => {
    const q = entityQuery.trim().toLocaleLowerCase("tr");
    if (!q) return [];
    return Object.values(entities)
      .filter((e) => e.entity_id.includes(q) || String(e.attributes.friendly_name ?? "").toLocaleLowerCase("tr").includes(q))
      .slice(0, 30);
  }, [entityQuery, entities]);

  return (
    <div className="editor-page">
      <header className="editor-head">
        <button className="btn-small" onClick={close}>
          ← Geri
        </button>
        <h2>{initial && !copy ? `Düzenle: ${initial.alias ?? ""}` : copy ? "Kopyadan yeni otomasyon" : "Yeni otomasyon"}</h2>
        <span style={{ flex: 1 }} />
        {history.length > 0 && (
          <select
            className="history-select"
            value=""
            onChange={(e) => {
              const h = history[Number(e.target.value)];
              if (!h) return;
              if (dirty && !window.confirm("Editördeki değişiklikler bu sürümle değiştirilecek. Devam?")) return;
              const { id: _omit, ...rest } = h.config; // eslint-disable-line @typescript-eslint/no-unused-vars
              setText(stringify(rest, { lineWidth: 0 }));
            }}
          >
            <option value="">Önceki sürümler ({history.length})</option>
            {history.map((h, i) => (
              <option key={h.savedAt} value={i}>
                {new Date(h.savedAt).toLocaleString("tr-TR")}
              </option>
            ))}
          </select>
        )}
        {dirty && (
          <button className="btn-small" onClick={() => setText(startText)}>
            Geri al
          </button>
        )}
        <button className="btn-primary" disabled={blocking || saving || (!dirty && !!configId)} onClick={save} title="Ctrl+S">
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </header>

      <div className="editor-body">
        <div className="editor-main">
          <YamlEditor ref={editor} value={text} onChange={setText} onSave={save} errorLine={v.yamlLine} />
        </div>

        <aside className="editor-side">
          <section className={`check-box ${blocking ? "bad" : v.unknownEntities.length ? "warn" : "ok"}`}>
            {v.yamlError ? (
              <>
                <b>YAML hatası{v.yamlLine ? ` (satır ${v.yamlLine})` : ""}</b>
                <span>{v.yamlError}</span>
              </>
            ) : v.problems.length || serverErrors.length ? (
              <>
                <b>Düzeltilmesi gerekenler</b>
                {[...v.problems, ...serverErrors].map((p) => (
                  <span key={p}>• {p}</span>
                ))}
              </>
            ) : (
              <b>✓ Geçerli{server ? " (HA doğruladı)" : ""}</b>
            )}
            {v.unknownEntities.length > 0 && (
              <span className="warn-text">Bilinmeyen varlık: {v.unknownEntities.join(", ")}</span>
            )}
            {saveError && <span className="error-text">Kaydedilemedi: {saveError}</span>}
          </section>

          <section>
            <h4>Varlık ekle</h4>
            <input
              className="side-search"
              placeholder="Cihaz ara, tıkla → imlece yazılır"
              value={entityQuery}
              onChange={(e) => setEntityQuery(e.target.value)}
            />
            <div className="entity-results">
              {entityMatches.map((e) => (
                <button key={e.entity_id} onClick={() => editor.current?.insert(e.entity_id)} title={e.entity_id}>
                  <span>{(e.attributes.friendly_name as string) || e.entity_id}</span>
                  <span className="muted small">{e.entity_id}</span>
                </button>
              ))}
            </div>
          </section>

          {(["triggers", "conditions", "actions"] as Section[]).map((sec) => (
            <section key={sec}>
              <h4>{SECTION_TR[sec]} ekle</h4>
              <div className="snippet-grid">
                {SNIPPETS.filter((s) => s.section === sec).map((s) => (
                  <button key={s.label} onClick={() => addSnippet(sec, s.item)}>
                    + {s.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
          <p className="muted small">
            Parçalar ilgili bölümün sonuna eklenir; boş <code>entity_id</code> alanlarını yukarıdaki aramayla doldur.
          </p>
        </aside>
      </div>
    </div>
  );
}
