import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";

export interface YamlEditorHandle {
  /** İmlecin bulunduğu yere metin ekler (girintiyi imlecin satırına uydurur). */
  insert: (text: string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  /** Hata satırı (1 tabanlı) — vurgulanır */
  errorLine?: number | null;
}

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "#0c0e11" },
  ".cm-scroller": { fontFamily: 'Consolas, "Cascadia Mono", monospace', lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "#0c0e11", borderRight: "1px solid #2e3540" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.04)" },
});

const YamlEditor = forwardRef<YamlEditorHandle, Props>(function YamlEditor({ value, onChange, onSave, errorLine }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          yaml(),
          oneDark,
          theme,
          EditorState.tabSize.of(2),
          keymap.of([
            indentWithTab,
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // Belge yalnızca ilk açılışta yüklenir; dışarıdan değişim aşağıdaki effect ile
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dışarıdan gelen değer (ör. önceki sürümü yükle) editördekinden farklıysa değiştir
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  // Hata satırına kaydır
  useEffect(() => {
    const v = view.current;
    if (!v || !errorLine || errorLine > v.state.doc.lines) return;
    const line = v.state.doc.line(errorLine);
    v.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
  }, [errorLine]);

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const v = view.current;
      if (!v) return;
      const pos = v.state.selection.main.head;
      const line = v.state.doc.lineAt(pos);
      const indent = line.text.match(/^\s*/)![0];
      const lines = text.split("\n");
      // Boş satırdaysak ilk satır imlecin girintisiyle, diğerleri aynı girintiyle
      const atBlankLine = line.text.trim() === "";
      const body = lines.map((l, i) => (i === 0 ? l : indent + l)).join("\n");
      const insertText = atBlankLine ? body : body;
      v.dispatch({
        changes: { from: pos, insert: insertText },
        selection: { anchor: pos + insertText.length },
        scrollIntoView: true,
      });
      v.focus();
    },
    focus() {
      view.current?.focus();
    },
  }));

  return <div ref={host} className="yaml-editor" />;
});

export default YamlEditor;
