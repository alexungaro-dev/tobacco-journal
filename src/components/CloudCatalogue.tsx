import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackToCatalogue, useRecordTarget } from "./RecordTarget";
import { ListFeedback } from "./CloudFeedback";
import { supabase } from "../auth/client";
import { useCloudPipes } from "../data/useCloudPipes";
import {
  createBackup,
  downloadJson,
  MAX_BACKUP_BYTES,
  PIPES_KEY,
} from "../data/storage";
import { displayPipeStatus, inspectImport, type ImportPlan } from "../data/pipeMapping";
import type { ImportResult } from "../data/cloudPipes";
import type { Pipe } from "../types";
import { PipeCard } from "./PipeCard";
import { PipeForm } from "./PipeForm";

export function CloudCatalogue({
  userId,
  email,
  onSessionLost,
  targetId,
}: {
  userId: string;
  email: string;
  onSessionLost: () => void;
  targetId?: string;
}) {
  const { t, i18n } = useTranslation();
  const cloud = useCloudPipes(supabase!, userId, onSessionLost);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Pipe | null | undefined>();
  const [notice, setNotice] = useState("");
  const [message, setMessage] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [raw, setRaw] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [exportFailed, setExportFailed] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [photoResult, setPhotoResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [reading, setReading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const close = useCallback(() => setEditing(undefined), []);
  const heading = useRef<HTMLHeadingElement>(null);
  const [editorRoute, setEditorRoute] = useState(targetId);
  if (editorRoute !== targetId) {
    setEditorRoute(targetId);
    setEditing(undefined);
  }
  const privatePhoto = (id: string) => ({
    ...cloud.photo(id),
    read: cloud.readPhoto,
  });
  async function migratePhotos() {
    if (!window.confirm(t("photos.confirm", { count: cloud.pending, email })))
      return;
    setPhotoResult(null);
    setMigrating(true);
    const result = await cloud.migratePhotos();
    if (alive.current) {
      setMigrating(false);
      if (result) setPhotoResult(result);
    }
  }
  const disabled = cloud.loading || cloud.busy || reading;
  const query = search.toLocaleLowerCase(i18n.language);
  const filtered = cloud.pipes.filter(
    (p) =>
      (!status || displayPipeStatus(p.status) === status) &&
      [p.brand, p.model, p.shape, p.material, p.notes]
        .join(" ")
        .toLocaleLowerCase(i18n.language)
        .includes(query),
  );
  const displayed = targetId === undefined
    ? filtered
    : cloud.pipes.filter((pipe) => pipe.id === targetId);
  const ready = !cloud.loading && !cloud.readError;
  const targetCard = useRecordTarget(targetId, ready, !!displayed.length, heading);

  function prepare(text: string, source: "local" | "backup") {
    setPlan(null);
    setResult(null);
    setProgress(0);
    setSourceError("");
    setRaw(text);
    try {
      setPlan(inspectImport(text, source));
    } catch {
      setSourceError("cloud.errors.source");
    }
  }
  async function transfer() {
    if (!plan || disabled || cloud.readError) return;
    const count = plan.items.filter((i) => i.pipe).length;
    if (!window.confirm(t("cloud.confirmImport", { count, email }))) return;
    setResult(null);
    setProgress(0);
    setMessage("");
    const next = await cloud.importRecords(plan, (n) => {
      if (alive.current) setProgress(n);
    });
    if (alive.current && next) setResult(next);
  }
  function download(contents: string, name: string) {
    try {
      downloadJson(contents, name);
    } catch {
      setNotice("rawError");
    }
  }
  return (
    <>
      <section className="intro">
        <div>
          <div className="eyebrow">{t("cloud.catalogue")}</div>
          <h1 ref={heading} tabIndex={-1}>{t("title")}</h1>
          <p>{t("cloud.intro")}</p>
        </div>
        <button
          className="btn"
          disabled={disabled || !!cloud.error || !!cloud.readError}
          onClick={() => setEditing(null)}
        >
          {t("add")}
        </button>
      </section>
      <ListFeedback
        state={
          cloud.loading
            ? { kind: "loading" }
            : cloud.readError
              ? { kind: "error", message: cloud.readError }
              : { kind: "ready" }
        }
        loading="cloud.loading"
        onRetry={cloud.reload}
        busy={disabled}
      />
      {((cloud.error && editing === undefined) || notice) && (
        <div className="notice" role="alert">
          {cloud.error && <p>{t(cloud.error)}</p>}
          {notice && <p>{t(notice)}</p>}
          <button
            className="btn secondary"
            disabled={disabled}
            onClick={() => {
              setNotice("");
              cloud.reload();
            }}
          >
            {t("cloud.reload")}
          </button>
        </div>
      )}
      {cloud.warning && editing === undefined && (
        <p role="status">{t(cloud.warning)}</p>
      )}
      {message && <p role="status">{t(message)}</p>}
      {targetId !== undefined ? (
        <BackToCatalogue href="#pipes" />
      ) : (
        <>
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
          {!cloud.loading && !cloud.readError && (
            <div className="count">
              {t("count", { visible: filtered.length, total: cloud.pipes.length })}
            </div>
          )}
        </>
      )}
      <section className="grid" aria-live="polite" aria-busy={cloud.loading}>
        {displayed.map((p) => (
          <PipeCard
            key={p.id}
            pipe={p}
            targetRef={targetId !== undefined ? targetCard : undefined}
            photo={privatePhoto(p.id)}
            onEdit={() => {
              if (!disabled) setEditing(p);
            }}
          />
        ))}
        {ready && !cloud.error && !displayed.length && (
          targetId !== undefined ? (
            <p className="empty">{t("cloud.targetMissing")}</p>
          ) : (
            <div className="empty">
              <strong>{t(cloud.pipes.length ? "noResults" : "emptyTitle")}</strong>
              {t(cloud.pipes.length ? "tryFilters" : "emptyText")}
            </div>
          )
        )}
      </section>
      <p className="footnote">{t("cloud.footnote")}</p>
      <div className="cloudtools">
        <button
          className="btn secondary"
          disabled={disabled || !!cloud.error || !!cloud.readError}
          onClick={async () => {
            setExportFailed(false);
            const backup = await cloud.exportBackup();
            if (!alive.current) return;
            if (backup) download(backup, "tobacco-journal-cloud.json");
            else setExportFailed(true);
          }}
        >
          {t("export")}
        </button>
        <button
          className="btn secondary"
          disabled={disabled}
          onClick={cloud.reload}
        >
          {t("cloud.reload")}
        </button>
        <button
          className="btn secondary"
          disabled={disabled || !!cloud.error || !!cloud.readError}
          onClick={() => {
            try {
              prepare(localStorage.getItem(PIPES_KEY) || "[]", "local");
            } catch {
              setPlan(null);
              setRaw(null);
              setSourceError("cloud.errors.local");
            }
          }}
        >
          {t("cloud.prepareLocal")}
        </button>
        <button
          className="btn secondary"
          disabled={disabled || !!cloud.error || !!cloud.readError}
          onClick={() => file.current?.click()}
        >
          {t("import")}
        </button>
        <input
          type="file"
          ref={file}
          hidden
          accept="application/json,.json"
          aria-label={t("import")}
          onChange={async (e) => {
            const input = e.currentTarget;
            const chosen = input.files?.[0];
            input.value = "";
            if (!chosen) return;
            setReading(true);
            setPlan(null);
            setResult(null);
            setRaw(null);
            setSourceError("");
            try {
              if (chosen.size > MAX_BACKUP_BYTES) throw Error();
              const text = await chosen.text();
              if (alive.current) prepare(text, "backup");
            } catch {
              if (alive.current) setSourceError("cloud.errors.source");
            } finally {
              if (alive.current) setReading(false);
            }
          }}
        />
      </div>
      {exportFailed && (
        <div className="notice" role="status">
          <p>{t("photos.originalBackupHelp")}</p>
          <button
            className="btn secondary"
            disabled={disabled}
            onClick={() =>
              download(
                createBackup(cloud.pipes),
                "tobacco-journal-originals.json",
              )
            }
          >
            {t("photos.originalBackup")}
          </button>
        </div>
      )}
      {!cloud.loading && (
        <section className="migration" aria-label={t("photos.migration")}>
          <h2>{t("photos.migration")}</h2>
          <p>{t("photos.pending", { count: cloud.pending })}</p>
          <button
            className="btn secondary"
            disabled={disabled || !cloud.pending}
            onClick={() => void migratePhotos()}
          >
            {t("photos.migrate")}
          </button>
          {migrating && <p role="status">{t("photos.migrating")}</p>}
          {photoResult && (
            <div role="status">
              <p>
                {t("photos.result", {
                  verified: photoResult.verified,
                  failed: photoResult.failures.length,
                  unattempted: photoResult.unattempted,
                })}
              </p>
              {!!photoResult.failures.length && (
                <ul>
                  {photoResult.failures.map((failure) => (
                    <li key={failure.label}>
                      {failure.label}: {t(failure.reason)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
      {sourceError && (
        <div className="notice" role="alert">
          {t(sourceError)}
          {raw !== null && (
            <button
              className="btn secondary"
              onClick={() => download(raw, "tobacco-journal-original.json")}
            >
              {t("rawExport")}
            </button>
          )}
        </div>
      )}
      {plan && (
        <section className="migration" aria-label={t("cloud.migrationTitle")}>
          <h2>{t("cloud.migrationTitle")}</h2>
          <p>{t("cloud.destination", { email })}</p>
          <p>
            {t("cloud.plan", {
              valid: plan.items.filter((i) => i.pipe).length,
              rejected: plan.items.filter((i) => i.reason).length,
            })}
          </p>
          <p>{t("cloud.photoPending", { count: plan.photos })}</p>
          <p>{t("cloud.migrationHelp")}</p>
          <div className="cloudtools">
            <button
              className="btn secondary"
              disabled={cloud.busy}
              onClick={() =>
                download(plan.backup, "tobacco-journal-before-cloud.json")
              }
            >
              {t("cloud.backupBefore")}
            </button>
            <button
              className="btn"
              disabled={
                disabled || !!cloud.error || !!cloud.readError || !plan.items.some((i) => i.pipe)
              }
              onClick={() => void transfer()}
            >
              {t("cloud.transfer")}
            </button>
            <button
              className="btn secondary"
              disabled={cloud.busy}
              onClick={() => {
                setPlan(null);
                setRaw(null);
                setResult(null);
              }}
            >
              {t("cancel")}
            </button>
          </div>
          {cloud.busy && (
            <p role="status">
              {t("cloud.progress", {
                count: progress,
                total: plan.items.filter((i) => i.pipe).length,
              })}
            </p>
          )}
          {plan.items.some((i) => i.reason) && (
            <ul className="importissues">
              {plan.items
                .filter((i) => i.reason)
                .map((i) => (
                  <li key={i.index}>
                    {i.label}: {t(i.reason!)}
                  </li>
                ))}
            </ul>
          )}
          {result && (
            <div role="status">
              <p>
                {t("cloud.result", {
                  verified: result.verified,
                  failed: result.failures.length,
                  unattempted: result.unattempted,
                  rejected: plan.items.filter((i) => i.reason).length,
                })}
              </p>
              {result.verified > 0 && plan.photos > 0 && (
                <p>{t("cloud.photosNotUploaded")}</p>
              )}
              {!!result.failures.length && (
                <ul>
                  {result.failures.map((f, i) => (
                    <li key={i}>
                      {f.label}: {t(f.reason)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
      {editing !== undefined && (
        <PipeForm
          pipe={editing}
          privatePhoto={privatePhoto(editing?.id ?? "")}
          warning={cloud.warning}
          onClose={close}
          busy={cloud.busy}
          error={cloud.error}
          onSave={async (p, photo) => {
            const existed = cloud.pipes.some((x) => x.id === p.id);
            if (await cloud.save(p, photo)) {
              if (alive.current) {
                close();
                setMessage(existed ? "updated" : "added");
              }
              return true;
            }
            return false;
          }}
          onDelete={async (p) => {
            if (
              window.confirm(
                t("deleteConfirm", { name: `${p.brand} ${p.model}` }),
              ) &&
              (await cloud.remove(p))
            ) {
              if (alive.current) {
                close();
                setMessage("deleted");
              }
            }
          }}
        />
      )}
    </>
  );
}
