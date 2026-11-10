import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import it from "./locales/it.json";
import en from "./locales/en.json";
export const LANGUAGE_KEY = "tj-language";
export function initialLanguage(): "it" | "en" {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === "it" || saved === "en") return saved;
  } catch {
    /* Language can still change without storage. */
  }
  return (navigator.languages?.[0] || navigator.language || "it")
    .toLowerCase()
    .startsWith("it")
    ? "it"
    : "en";
}
void i18n.use(initReactI18next).init({
  resources: { it: { translation: it }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});
export default i18n;
