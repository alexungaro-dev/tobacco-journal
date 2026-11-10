import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { APP_NAME, APP_MONOGRAM, MODULES, type Module } from "./config";
import { LANGUAGE_KEY } from "./i18n";
import { usePipes } from "./data/usePipes";
import {
  createBackup,
  downloadJson,
  MAX_BACKUP_BYTES,
  parseBackup,
  PIPES_KEY,
} from "./data/storage";
import type { Pipe } from "./types";
import { PipeCard } from "./components/PipeCard";
import { PipeForm } from "./components/PipeForm";
function currentModule(): Module {
  const value = location.hash.slice(1);
  return MODULES.includes(value as Module) ? (value as Module) : "pipes";
}
export default function App() {
  const { t, i18n } = useTranslation();
  const { pipes, error, blocked, commit } = usePipes();
  const [module, setModule] = useState<Module>(currentModule);
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Pipe | null | undefined>(undefined);
  const [message, setMessage] = useState(""),
    [notice, setNotice] = useState("");
  const importFile = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setEditing(undefined), []);
  useEffect(() => {
    const listener = () => setModule(currentModule());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.title = `${APP_NAME} — ${t(`nav.${module}`)}`;
  }, [i18n.language, module, t]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 3200);
    return () => clearTimeout(timer);
  }, [message]);
  const query = search.toLocaleLowerCase(i18n.language);
  const filtered = pipes.filter(
    (p) =>
      (!status || p.status === status) &&
      [p.brand, p.model, p.shape, p.material, p.notes]
        .join(" ")
        .toLocaleLowerCase(i18n.language)
        .includes(query),
  );
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
        ) : (
          <>
            <section className="intro">
              <div>
                <div className="eyebrow">{t("eyebrow")}</div>
                <h1>{t("title")}</h1>
                <p>{t("intro")}</p>
              </div>
              <button
                className="btn"
                disabled={blocked}
                onClick={() => setEditing(null)}
              >
                {t("add")}
              </button>
            </section>
            {(error || notice) && (
              <div className="notice" role="alert">
                {error && <p>{t(error)}</p>}
                {notice && <p>{t(notice)}</p>}
                {blocked && (
                  <button
                    className="btn secondary"
                    onClick={() => {
                      try {
                        downloadJson(
                          localStorage.getItem(PIPES_KEY) || "",
                          "tobacco-journal-original.json",
                        );
                      } catch {
                        setNotice("rawError");
                      }
                    }}
                  >
                    {t("rawExport")}
                  </button>
                )}
              </div>
            )}
            <div className="controls">
              <input
                className="search"
                type="search"
                aria-label={t("search")}
                placeholder={t("search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="filter"
                aria-label={t("fields.status")}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">{t("allStatuses")}</option>
                {["in_use", "stored", "archived"].map((s) => (
                  <option key={s} value={s}>
                    {t(`statuses.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="count">
              {t("count", {
                visible: new Intl.NumberFormat(i18n.language).format(
                  filtered.length,
                ),
                total: new Intl.NumberFormat(i18n.language).format(
                  pipes.length,
                ),
              })}
            </div>
            <section className="grid" aria-live="polite">
              {filtered.map((p) => (
                <PipeCard key={p.id} pipe={p} onEdit={() => setEditing(p)} />
              ))}
              {!filtered.length && (
                <div className="empty">
                  <strong>
                    {t(pipes.length ? "noResults" : "emptyTitle")}
                  </strong>
                  {t(pipes.length ? "tryFilters" : "emptyText")}
                </div>
              )}
            </section>
            <div className="footnote">{t("footnote")}</div>
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 15,
              }}
            >
              <button
                className="btn secondary"
                disabled={blocked}
                onClick={() =>
                  downloadJson(
                    createBackup(pipes),
                    `tobacco-journal-pipe-${new Date().toISOString().slice(0, 10)}.json`,
                  )
                }
              >
                {t("export")}
              </button>
              <button
                className="btn secondary"
                onClick={() => importFile.current?.click()}
              >
                {t("import")}
              </button>
              <input
                type="file"
                ref={importFile}
                aria-label={t("import")}
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const input = e.currentTarget,
                    f = input.files?.[0];
                  if (!f) return;
                  try {
                    if (f.size > MAX_BACKUP_BYTES) throw Error();
                    const next = parseBackup(await f.text());
                    if (
                      window.confirm(
                        t(blocked ? "recoveryConfirm" : "importConfirm", {
                          count: next.length,
                        }),
                      ) &&
                      commit(next, true)
                    ) {
                      setNotice("");
                      setMessage("imported");
                    }
                  } catch {
                    setNotice("importError");
                  } finally {
                    input.value = "";
                  }
                }}
              />
            </div>
          </>
        )}
      </main>
      {editing !== undefined && (
        <PipeForm
          pipe={editing}
          onClose={close}
          onSave={(p) => {
            const exists = pipes.some((x) => x.id === p.id);
            if (
              commit(
                exists
                  ? pipes.map((x) => (x.id === p.id ? p : x))
                  : [p, ...pipes],
              )
            ) {
              close();
              setMessage(exists ? "updated" : "added");
              return true;
            }
            return false;
          }}
          onDelete={(p) => {
            if (
              confirm(t("deleteConfirm", { name: `${p.brand} ${p.model}` })) &&
              commit(pipes.filter((x) => x.id !== p.id))
            ) {
              close();
              setMessage("deleted");
            }
          }}
        />
      )}{" "}
      {message && (
        <div className="toast" role="status" style={{ display: "block" }}>
          {t(message)}
        </div>
      )}
    </>
  );
}
