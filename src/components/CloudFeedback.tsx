import { useTranslation } from "react-i18next";

export type ReadState =
  | { kind: "loading" | "ready" }
  | { kind: "error"; message: string };

export function ListFeedback({
  state,
  loading = "cloud.reading",
  onRetry,
  busy,
}: {
  state: ReadState;
  loading?: string;
  onRetry: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  if (state.kind === "loading") return <p role="status">{t(loading)}</p>;
  if (state.kind !== "error") return null;
  return (
    <div className="notice">
      <p role="alert">{t(state.message)}</p>
      <button type="button" className="btn secondary" onClick={onRetry} disabled={busy}>
        {t("cloud.retry")}
      </button>
    </div>
  );
}

export function EditorFeedback({
  error,
  status,
  busy,
}: {
  error: string;
  status?: string;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {busy && <p role="status">{t("cloud.saving")}</p>}
      {status && <p role="status">{t(status)}</p>}
      {error && <p className="formerror" role="alert">{t(error)}</p>}
    </>
  );
}
