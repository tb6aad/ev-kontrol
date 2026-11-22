// Basit çeviri katmanı. Kaynak dil Türkçe: t("Odalar") Türkçede metni olduğu gibi,
// İngilizcede en.ts'teki karşılığını döndürür (yoksa Türkçeye düşer).
// Değişkenler: t("{n} cihaz açık", { n: 3 }).
import en from "./en";

export type Lang = "tr" | "en";
export const LANGS: { id: Lang; label: string }[] = [
  { id: "tr", label: "Türkçe" },
  { id: "en", label: "English" },
];

/** Kayıtlı tercih yoksa sistem diline göre seç */
export function defaultLang(): Lang {
  try {
    return navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en";
  } catch {
    return "tr";
  }
}

let current: Lang = "tr";

export function setLang(l: Lang) {
  current = l;
  try {
    document.documentElement.lang = l;
  } catch {
    /* test ortamı */
  }
}

export const getLang = () => current;

/** Tarih/sayı biçimlendirme için yerel ayar */
export const locale = () => (current === "en" ? "en-GB" : "tr-TR");

/** Aynı Türkçe kelime farklı yerlerde farklı çevrilecekse anahtara bağlam eklenir: t("Kapat|pencere").
 *  Türkçede "|" sonrası gösterilmez. */
export function t(s: string, vars?: Record<string, string | number>): string {
  const base = s.includes("|") ? s.slice(0, s.indexOf("|")) : s;
  let out = current === "en" ? (en[s] ?? base) : base;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** Sabit listelerdeki metinleri işaretler (çeviri gösterimde t() ile yapılır); çeviri testi bunları da tarar. */
export const tk = (s: string) => s;
