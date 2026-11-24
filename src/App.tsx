import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { APP_NAME, APP_MONOGRAM, MODULES, type Module } from "./config";
import { LANGUAGE_KEY } from "./i18n";
import { useAuthContext } from "./auth/AuthContext";
import { TobaccoCatalogue } from "./components/TobaccoCatalogue";
import { StockAlertPreferences } from "./components/StockAlerts";
import type { Catalogue } from "./data/smokingJournal";
import { CloudCatalogue } from "./components/CloudCatalogue";
const DashboardView = lazy(() =>
  import("./components/DashboardView").then((m) => ({
    default: m.DashboardView,
  })),
);
const SmokingJournalView = lazy(() =>
  import("./components/SmokingJournalView").then((m) => ({
    default: m.SmokingJournalView,
  })),
);
const CigarCatalogue = lazy(() =>
  import("./components/CigarCatalogue").then((m) => ({
    default: m.CigarCatalogue,
  })),
);
const Account = lazy(() =>
  import("./components/Account").then((m) => ({ default: m.Account })),
);
function currentModule(hash: string): Module {
  const value = hash.slice(1).split("/")[0];
  return MODULES.includes(value as Module) ? (value as Module) : "dashboard";
}

function recordId(hash: string, prefix: string) {
  if (!hash.startsWith(prefix)) return undefined;
  try {
    return decodeURIComponent(hash.slice(prefix.length));
  } catch {
    return "";
  }
}

function diaryShortcut(hash: string) {
  if (hash === "#diary/new") return { create: true } as const;
  const sessionId = recordId(hash, "#diary/session/");
  if (sessionId !== undefined) return { sessionId };
}
export default function App() {
  const { t, i18n } = useTranslation();
  const auth = useAuthContext();
  const [hash, setHash] = useState(() => location.hash);
  const module = currentModule(hash);
  const targetId = recordId(hash, `#${module}/item/`);
  const stockSettings = useRef<HTMLDetailsElement>(null);
  const signedIn =
    !auth.loading && !auth.sessionError && !auth.recovery && auth.session;
  function openStockSettings() {
    const settings = stockSettings.current;
    if (settings) {
      settings.open = true;
      settings.querySelector("summary")?.focus();
    }
  }
  const shortcut = useMemo(() => diaryShortcut(hash), [hash]);
  const cached = useRef<{ owner: string; catalogue: Catalogue } | undefined>(
    undefined,
  );
  const rememberCatalogue = useCallback(
    (owner: string, catalogue: Catalogue) => {
      cached.current = { owner, catalogue };
    },
    [],
  );
  const clearShortcut = useCallback(() => {
    history.replaceState(history.state, "", "#diary");
    setHash("#diary");
  }, []);
  useEffect(() => {
    if (!auth.session || module !== "diary") cached.current = undefined;
  }, [auth.session?.user.id, module]);
  useEffect(() => {
    const listener = () => setHash(location.hash);
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.title = `${APP_NAME} — ${t(`nav.${module}`)}`;
  }, [i18n.language, module, t]);
  function navigate(next: Module) {
    location.hash = next;
    setHash(location.hash);
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
          <Account
            onStockSettings={
              signedIn && auth.profileReady ? openStockSettings : undefined
            }
          />
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
        {signedIn ? (
          auth.profileReady ? (
            <StockAlertPreferences
              key={signedIn.user.id}
              owner={signedIn.user.id}
              settingsRef={stockSettings}
            >
              {module === "pipes" ? (
                <CloudCatalogue
                  userId={signedIn.user.id}
                  email={signedIn.user.email || ""}
                  onSessionLost={auth.invalidateSession}
                  targetId={targetId}
                />
              ) : module === "dashboard" ? (
                <Suspense
                  fallback={<p role="status">{t("dashboard.loading")}</p>}
                >
                  <DashboardView
                    owner={signedIn.user.id}
                    onSessionLost={auth.invalidateSession}
                    rememberCatalogue={rememberCatalogue}
                  />
                </Suspense>
              ) : module === "diary" ? (
                <Suspense
                  fallback={<p role="status">{t("diary.working")}</p>}
                >
                  <SmokingJournalView
                    userId={signedIn.user.id}
                    email={signedIn.user.email || ""}
                    onSessionLost={auth.invalidateSession}
                    shortcut={shortcut}
                    onShortcutOpened={clearShortcut}
                    initialCatalogue={
                      cached.current?.owner === signedIn.user.id
                        ? cached.current.catalogue
                        : undefined
                    }
                  />
                </Suspense>
              ) : module === "cigars" ? (
                <Suspense
                  fallback={<p role="status">{t("cigars.working")}</p>}
                >
                  <CigarCatalogue
                    targetId={targetId}
                    userId={signedIn.user.id}
                    email={signedIn.user.email || ""}
                    onSessionLost={auth.invalidateSession}
                  />
                </Suspense>
              ) : (
                <TobaccoCatalogue
                  targetId={targetId}
                  userId={signedIn.user.id}
                  email={signedIn.user.email || ""}
                  onSessionLost={auth.invalidateSession}
                />
              )}
            </StockAlertPreferences>
          ) : (
            <p role="status">
              {t(
                auth.profileError ? "cloud.profileRequired" : "cloud.preparing",
              )}
            </p>
          )
        ) : (
          <section className="placeholder">
            <h1>{t(module === "pipes" ? "title" : `${module}.title`)}</h1>
            <p>
              {t(
                auth.loading
                  ? "auth.loading"
                  : module === "dashboard"
                    ? "dashboard.signInRequired"
                    : module === "diary"
                      ? "diary.signInRequired"
                      : "cloud.signInRequired",
              )}
            </p>
          </section>
        )}
      </main>
    </>
  );
}
