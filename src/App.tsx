import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { APP_NAME, APP_MONOGRAM, MODULES, type Module } from "./config";
import { LANGUAGE_KEY } from "./i18n";
import { useAuthContext } from "./auth/AuthContext";
import { CloudCatalogue } from "./components/CloudCatalogue";
const Account = lazy(() =>
  import("./components/Account").then((m) => ({ default: m.Account })),
);
function currentModule(): Module {
  const value = location.hash.slice(1);
  return MODULES.includes(value as Module) ? (value as Module) : "pipes";
}
export default function App() {
  const { t, i18n } = useTranslation();
  const auth = useAuthContext();
  const [module, setModule] = useState<Module>(currentModule);
  useEffect(() => {
    const listener = () => setModule(currentModule());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.title = `${APP_NAME} — ${t(`nav.${module}`)}`;
  }, [i18n.language, module, t]);
  function navigate(next: Module) {
    location.hash = next;
    setModule(next);
  }
  return (
    <>
      <header className="top">
        <div className="topinner">
          <div>
            <div className="brand">{APP_NAME}</div>
            <div className="tagline">{t("tagline")}</div>
          </div>
          <div className="toptools">
            <select
              className="language"
              aria-label={t("language")}
              value={i18n.resolvedLanguage}
              onChange={(e) => {
                const language = e.target.value;
                void i18n.changeLanguage(language);
                try {
                  localStorage.setItem(LANGUAGE_KEY, language);
                } catch {
                  /* App remains usable when preferences cannot be saved. */
                }
              }}
            >
              <option value="it">IT</option>
              <option value="en">EN</option>
            </select>
            <div className="monogram">{APP_MONOGRAM}</div>
          </div>
        </div>
      </header>
      <main className="shell">
        <Suspense fallback={<p role="status">{t("auth.loading")}</p>}>
          <Account />
        </Suspense>
        <nav className="nav" aria-label={t("sections")}>
          {MODULES.map((m) => (
            <button
              key={m}
              className={module === m ? "active" : ""}
              aria-current={module === m ? "page" : undefined}
              onClick={() => navigate(m)}
            >
              {t(`nav.${m}`)}
            </button>
          ))}
        </nav>
        {module !== "pipes" ? (
          <section className="placeholder">
            <div className="eyebrow">{APP_NAME}</div>
            <h1>{t("soonTitle", { module: t(`nav.${module}`) })}</h1>
            <p>{t("soonText")}</p>
            <button className="btn secondary" onClick={() => navigate("pipes")}>
              {t("back")}
            </button>
          </section>
        ) : auth.session &&
          !auth.loading &&
          !auth.sessionError &&
          !auth.recovery ? (
          auth.profileReady ? (
            <CloudCatalogue
              key={auth.session.user.id}
              userId={auth.session.user.id}
              email={auth.session.user.email || ""}
              onSessionLost={auth.invalidateSession}
            />
          ) : (
            <p role="status">
              {t(
                auth.profileError ? "cloud.profileRequired" : "cloud.preparing",
              )}
            </p>
          )
        ) : (
          <section className="placeholder">
            <h1>{t("title")}</h1>
            <p>{t(auth.loading ? "auth.loading" : "cloud.signInRequired")}</p>
          </section>
        )}
      </main>
    </>
  );
}
