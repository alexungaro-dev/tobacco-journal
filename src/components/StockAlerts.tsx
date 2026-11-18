import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../auth/client";
import {
  cigarStockAlert,
  cigarThresholds,
  readStockPreferences,
  tobaccoStockAlert,
  type StockPreferences,
} from "../data/stockAlerts";

const Preferences = createContext<StockPreferences | undefined>(undefined);
const fields = "stock_alerts_enabled,cigar_low_stock_threshold";

export function StockAlertBadge(
  props:
    | { kind: "cigar"; remaining: number | null }
    | { kind: "tobacco"; remainingLevel: string | null },
) {
  const { t } = useTranslation();
  const preferences = useContext(Preferences);
  if (!preferences?.enabled) return null;
  const alert =
    props.kind === "cigar"
      ? cigarStockAlert(props.remaining, preferences.threshold)
      : tobaccoStockAlert(props.remainingLevel);
  return alert ? (
    <span className={`stock-alert stock-alert-${alert}`}>
      {t("stockAlerts." + alert)}
    </span>
  ) : null;
}

export function StockAlertPreferences({
  owner,
  children,
}: {
  owner: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState<StockPreferences>();
  const [draft, setDraft] = useState<StockPreferences>();
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const scope = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const dirty = useRef(false);
  const readVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    async function load() {
      if (writing.current) return;
      const version = ++readVersion.current;
      try {
        const { data, error } = await supabase!
          .from("profiles")
          .select(fields)
          .eq("id", owner)
          .abortSignal(controller.signal)
          .single();
        if (scope.current !== controller || version !== readVersion.current)
          return;
        if (error) throw error;
        const next = readStockPreferences(data);
        setPreferences(next);
        if (!dirty.current) setDraft(next);
        setStatus((current) => (current === "loadError" ? "" : current));
      } catch {
        if (scope.current === controller && version === readVersion.current)
          setStatus("loadError");
      }
    }
    void load();
    window.addEventListener("focus", load);
    return () => {
      scope.current = null;
      controller.abort();
      window.removeEventListener("focus", load);
    };
  }, [owner]);

  function change(next: StockPreferences) {
    dirty.current = true;
    setDraft(next);
    setStatus("");
  }
  async function save() {
    const controller = scope.current;
    if (!controller || !draft || writing.current) return;
    writing.current = true;
    readVersion.current++;
    setSaving(true);
    setStatus("");
    try {
      const { data, error } = await supabase!
        .from("profiles")
        .update({
          stock_alerts_enabled: draft.enabled,
          cigar_low_stock_threshold: draft.threshold,
        })
        .eq("id", owner)
        .select(fields)
        .abortSignal(controller.signal)
        .single();
      if (scope.current !== controller) return;
      if (error) throw error;
      const next = readStockPreferences(data);
      dirty.current = false;
      setPreferences(next);
      setDraft(next);
      setStatus("saved");
    } catch {
      if (scope.current === controller) setStatus("saveError");
    } finally {
      writing.current = false;
      if (scope.current === controller) setSaving(false);
    }
  }

  return (
    <Preferences.Provider value={preferences}>
      <details className="stock-alert-settings">
        <summary>{t("stockAlerts.settings")}</summary>
        {draft && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset
              className="pipefields stock-alert-controls"
              disabled={saving}
            >
              <label className="journal-check">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) =>
                    change({ ...draft, enabled: event.target.checked })
                  }
                />
                {t("stockAlerts.enable")}
              </label>
              <label>
                {t("stockAlerts.threshold")}
                <select
                  aria-label={t("stockAlerts.threshold")}
                  value={draft.threshold}
                  onChange={(event) =>
                    change({ ...draft, threshold: Number(event.target.value) })
                  }
                >
                  {cigarThresholds.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn secondary"
                type="submit"
                disabled={!dirty.current}
              >
                {t("stockAlerts.save")}
              </button>
            </fieldset>
          </form>
        )}
        {status && (
          <p role={status.endsWith("Error") ? "alert" : "status"}>
            {t("stockAlerts." + status)}
          </p>
        )}
        {!draft && !status && <p role="status">{t("stockAlerts.loading")}</p>}
      </details>
      {children}
    </Preferences.Provider>
  );
}
