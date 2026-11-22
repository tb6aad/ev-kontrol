import { describe, expect, it } from "vitest";
import en from "./en";
import { setLang, t } from ".";

// Kaynak dosyaları ham metin olarak al (testler ve çeviri klasörü hariç)
const files = import.meta.glob(["../**/*.{ts,tsx}", "!../**/__tests__/**", "!./**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const KEY_RE = /\bt[k]?\(\s*("(?:[^"\\]|\\.)*")/g;
const keys = new Map<string, string>();
for (const [file, src] of Object.entries(files)) {
  for (const m of src.matchAll(KEY_RE)) {
    const k = JSON.parse(m[1]) as string;
    if (!keys.has(k)) keys.set(k, file);
  }
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("çeviriler", () => {
  it("kaynak dosyalar bulundu", () => {
    expect(keys.size).toBeGreaterThan(100);
  });

  it("arayüzdeki her metnin İngilizcesi var", () => {
    expect([...keys].filter(([k]) => !(k in en)).map(([k, f]) => `${f}: ${k}`)).toEqual([]);
  });

  it("değişkenler ({n} vb.) iki dilde aynı", () => {
    expect(Object.entries(en).filter(([tr, e]) => placeholders(tr) !== placeholders(e)).map(([tr]) => tr)).toEqual([]);
  });

  it("kullanılmayan çeviri yok", () => {
    expect(Object.keys(en).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("t() dili, bağlamı ve değişkenleri uygular", () => {
    setLang("en");
    expect(t("{n} cihaz açık", { n: 3 })).toBe("3 devices on");
    expect(t("Kapat|pencere")).toBe("Close");
    setLang("tr");
    expect(t("{n} cihaz açık", { n: 3 })).toBe("3 cihaz açık");
    expect(t("Kapat|pencere")).toBe("Kapat");
    expect(t("çevirisi olmayan metin")).toBe("çevirisi olmayan metin");
  });
});
