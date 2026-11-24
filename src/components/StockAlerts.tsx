import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccountDialog } from "./AccountDialog";
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

export function useStockAlertPreferences() {
  return useContext(Preferences);
}

export function StockAlertBadge(
  props:
    | { kind: "cigar"; remaining: number | null }
    | { kind: "tobacco"; remainingLevel: string | null },
) {
  const { t } = useTranslation();
  const preferences = useStockAlertPreferences();
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
  settingsOpen,
  onSettingsClose,
}: {
  owner: string;
  children: ReactNode;
  settingsOpen: boolean;
  onSettingsClose: () => void;
}) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState<StockPreferences>();
  const [draft, setDraft] = useState<StockPreferences>();
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const scope = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const dirty = useRef(false);
  const readVersion = useRef(0);

  const load = useCallback(async () => {
    const controller = scope.current;
    if (!controller || writing.current) return;
    const version = ++readVersion.current;
    const isCurrent = () =>
      scope.current === controller && version === readVersion.current;
    setLoading(true);
    try {
      const { data, error } = await supabase!
        .from("profiles")
        .select(fields)
        .eq("id", owner)
        .abortSignal(controller.signal)
        .single();
      if (!isCurrent()) return;
      if (error) throw error;
      const next = readStockPreferences(data);
      setPreferences(next);
      if (!dirty.current) setDraft(next);
      setLoadFailed(false);
    } catch {
      if (isCurrent()) setLoadFailed(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [owner]);

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    void load();
    window.addEventListener("focus", load);
    return () => {
      scope.current = null;
      controller.abort();
      window.removeEventListener("focus", load);
    };
  }, [load]);

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
    setLoading(false);
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
      setLoadFailed(false);
      setStatus("saved");
    } catch {
      if (scope.current === controller) setStatus("saveError");
    } finally {
      writing.current = false;
      if (scope.current === controller) setSaving(false);
    }
  }

  const loadError = loadFailed && (
    <div className="notice">
      <p role="alert">{t("stockAlerts.loadError")}</p>
      <button
        type="button"
        className="btn secondary"
        disabled={loading || saving}
        onClick={() => void load()}
      >
        {t("stockAlerts.retry")}
      </button>
    </div>
  );

  return (
    <Preferences.Provider value={preferences}>
      {settingsOpen && (
        <AccountDialog title={t("auth.preferences")} onClose={onSettingsClose}>
          <h3>{t("stockAlerts.settings")}</h3>
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
                      change({
                        ...draft,
                        threshold: Number(event.target.value),
                      })
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
          {!draft && loading && <p role="status">{t("stockAlerts.loading")}</p>}
          {loadError}
        </AccountDialog>
      )}
      {!settingsOpen && loadError}
      {children}
    </Preferences.Provider>
  );
}
