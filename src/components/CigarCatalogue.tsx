import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackToCatalogue, useRecordTarget } from "./RecordTarget";
import { ListFeedback, type ReadState } from "./CloudFeedback";
import { useInlineEditorFocus } from "./useInlineEditorFocus";
import { supabase } from "../auth/client";
import {
  CloudCigars,
  fromCigarRow,
  inspectCigarBackup,
  type CigarImportItem,
  type CigarRow,
} from "../data/cigars";
import { cloudErrorKey } from "../data/pipeMapping";
import type { PhotoRef } from "../data/pipePhotos";
import { downloadJson, MAX_BACKUP_BYTES } from "../data/storage";
import { CigarForm } from "./CigarForm";
import { StockAlertBadge } from "./StockAlerts";
import { PipePhoto } from "./PipePhoto";

function pendingPhoto(row?: CigarRow) {
  const value = row?.extra.pendingCataloguePhoto;
  return typeof value === "string" ? value : undefined;
}

export function CigarCatalogue({
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
  const scope = useRef<CloudCigars | null>(null);
  const invalidate = useRef(onSessionLost);
  invalidate.current = onSessionLost;
  const lock = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CigarRow[]>([]);
  const [readState, setReadState] = useState<ReadState>({ kind: "loading" });
  const [editing, setEditing] = useState<CigarRow | null>();
  const [partiallyCreated, setPartiallyCreated] = useState<CigarRow>();
  const [busy, setBusy] = useState(true);
  const focus = useInlineEditorFocus(editing !== undefined, busy, targetId);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ message: string; itemId?: string }>();
  const [search, setSearch] = useState("");
  const [vitola, setVitola] = useState("");
  const [country, setCountry] = useState("");
  const [sort, setSort] = useState("name");
  const [plan, setPlan] = useState<CigarImportItem[]>();
  const [result, setResult] = useState<{
    imported: number;
    errors: CigarImportItem[];
    unattempted: number;
  }>();

  const [editorRoute, setEditorRoute] = useState(targetId);
  if (editorRoute !== targetId) {
    setEditorRoute(targetId);
    open(undefined);
  }

  async function run(action: (service: CloudCigars) => Promise<void>) {
    const service = scope.current;
    if (!service || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice(undefined);
    try {
      await action(service);
    } catch (failure) {
      if (scope.current !== service) return;
      const key = cloudErrorKey(failure);
      if (key === "cloud.errors.session") invalidate.current();
      else setError(key);
    } finally {
      if (scope.current === service) {
        lock.current = false;
        setBusy(false);
      }
    }
  }

  async function reload(service: CloudCigars) {
    setReadState({ kind: "loading" });
    try {
      const next = await service.list();
      if (scope.current !== service) return;
      setRows(next);
      setReadState({ kind: "ready" });
    } catch (failure) {
      if (scope.current !== service) return;
      const key = cloudErrorKey(failure);
      if (key === "cloud.errors.session") invalidate.current();
      else setReadState({ kind: "error", message: "cloud.readError" });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    scope.current = new CloudCigars(supabase!, userId, controller.signal);
    lock.current = false;
    void run(reload);
    return () => {
      scope.current = null;
      controller.abort();
    };
  }, [userId]);

  const read = useCallback(async (id: string, ref: PhotoRef) => {
    const service = scope.current;
    if (!service) throw Error();
    try {
      return await service.photos.read(id, ref);
    } catch (failure) {
      if (
        scope.current === service &&
        cloudErrorKey(failure) === "cloud.errors.session"
      )
        invalidate.current();
      throw failure;
    }
  }, []);
  function photo(row?: CigarRow) {
    try {
      return {
        ref: row ? scope.current?.photo(row) : undefined,
        damaged: false,
        read,
      };
    } catch {
      return { ref: undefined, damaged: true, read };
    }
  }
  function open(row: CigarRow | null | undefined) {
    setEditing(row);
    setPartiallyCreated(undefined);
    setError("");
  }
  function keep(row: CigarRow) {
    setRows((current) => [
      ...current.filter((record) => record.id !== row.id),
      row,
    ]);
  }

  function transfer() {
    const items =
      plan?.flatMap((entry) => (entry.item ? [entry.item] : [])) ?? [];
    if (!items.length || !window.confirm(t("cigars.confirmImport", { email })))
      return;
    setResult(undefined);
    void run(async (service) => {
      let imported = 0;
      let unattempted = 0;
      const errors: CigarImportItem[] = [];
      for (const [index, item] of items.entries()) {
        try {
          await service.importOne(item);
          imported++;
        } catch (failure) {
          if (scope.current !== service) return;
          const key = cloudErrorKey(failure);
          if (key === "cloud.errors.session") {
            invalidate.current();
            return;
          }
          errors.push({ label: item.id, error: key });
          if (key === "cloud.errors.network" || key === "photos.upload") {
            unattempted = items.length - index - 1;
            break;
          }
        }
      }
      if (scope.current === service) {
        setResult({ imported, errors, unattempted });
        await reload(service);
      }
    });
  }

  const collator = new Intl.Collator(i18n.language, { sensitivity: "base" });
  const number = new Intl.NumberFormat(i18n.language);
  const entries = rows.map((row) => ({ row, cigar: fromCigarRow(row) }));
  const options = (key: "vitola" | "country") =>
    [...new Set(entries.map(({ cigar }) => cigar[key]).filter(Boolean))].sort(
      collator.compare,
    );
  const query = search.trim().toLocaleLowerCase(i18n.language);
  const visible = entries
    .filter(
      ({ cigar }) =>
        (!vitola || cigar.vitola === vitola) &&
        (!country || cigar.country === country) &&
        [
          cigar.brand,
          cigar.name,
          cigar.series,
          cigar.vitola,
          cigar.country,
          cigar.wrapper,
          cigar.binder,
          cigar.filler,
          cigar.strength,
          cigar.notes,
        ]
          .join(" ")
          .toLocaleLowerCase(i18n.language)
          .includes(query),
    )
    .sort((a, b) => {
      if (sort === "recent")
        return b.row.updated_at.localeCompare(a.row.updated_at);
      if (sort === "remaining")
        return (b.cigar.remaining ?? -1) - (a.cigar.remaining ?? -1);
      if (sort === "rating")
        return (b.cigar.rating ?? -1) - (a.cigar.rating ?? -1);
      return (
        collator.compare(a.cigar.name, b.cigar.name) ||
        collator.compare(a.cigar.brand, b.cigar.brand)
      );
    });
  const displayed = targetId === undefined
    ? visible
    : entries.filter(({ row }) => row.id === targetId);
  const targetCard = useRecordTarget(
    targetId,
    readState.kind === "ready",
    !!displayed.length,
    focus.heading,
  );
  const blocked = busy || editing !== undefined || readState.kind !== "ready";

  function reloadFromCloud() {
    if (editing !== undefined && !window.confirm(t("cloud.discardDraft")))
      return;
    open(undefined);
    void run(reload);
  }

  return (
    <>
      <section className="intro">
        <div>
          <h1 ref={focus.heading} tabIndex={-1}>
            {t("cigars.title")}
          </h1>
          <p>{t("cigars.intro")}</p>
        </div>
        <button className="btn" disabled={blocked} onClick={(event) => {
          focus.trigger.current = event.currentTarget;
          open(null);
        }}>
          {t("cigars.add")}
        </button>
      </section>
      <ListFeedback state={readState} onRetry={reloadFromCloud} busy={busy} />
      {busy && editing === undefined && readState.kind !== "loading" && (
        <p role="status">{t("cigars.working")}</p>
      )}
      {error && editing === undefined && (
        <p className="notice" role="alert">
          {t(error)}
        </p>
      )}
      {notice && !displayed.some(({ row }) => row.id === notice.itemId) && (
        <p role="status">{t(notice.message)}</p>
      )}
      {editing !== undefined && (
        <CigarForm
          initial={editing ? fromCigarRow(editing) : undefined}
          photo={photo(editing ?? undefined)}
          pending={pendingPhoto(editing ?? undefined)}
          busy={busy}
          headingRef={focus.editorHeading}
          saveError={error}
          saveStatus={partiallyCreated ? "cigars.partial" : undefined}
          onCancel={() => open(undefined)}
          onSave={(item, edit) =>
            run(async (service) => {
              const outcome = await service.save(
                item,
                editing ?? partiallyCreated,
                edit,
                (row) => {
                  if (scope.current === service) {
                    keep(row);
                    setPartiallyCreated(row);
                  }
                },
              );
              if (scope.current !== service) return;
              keep(outcome.row);
              open(undefined);
              setNotice({
                message: outcome.cleanup ? "photos.cleanup" : "cigars.saved",
                itemId: editing?.id,
              });
            })
          }
          onDelete={() => {
            if (
              !editing ||
              !window.confirm(t("cigars.confirmDelete", { name: editing.name }))
            )
              return;
            void run(async (service) => {
              const cleanup = await service.remove(editing);
              if (scope.current !== service) return;
              setRows((current) =>
                current.filter((entry) => entry.id !== editing.id),
              );
              open(undefined);
              setNotice({ message: cleanup ? "photos.cleanup" : "cigars.deleted" });
            });
          }}
        />
      )}
      {targetId !== undefined ? (
        <BackToCatalogue href="#cigars" />
      ) : (
        <>
          <div className="controls">
            <input
              className="search"
              type="search"
              aria-label={t("cigars.search")}
              placeholder={t("cigars.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {(["vitola", "country"] as const).map((key) => (
              <select
                className="filter"
                key={key}
                aria-label={t("cigars.fields." + key)}
                value={key === "vitola" ? vitola : country}
                onChange={(event) =>
                  (key === "vitola" ? setVitola : setCountry)(event.target.value)
                }
              >
                <option value="">{t("cigars.all." + key)}</option>
                {options(key).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            ))}
            <select
              className="filter"
              aria-label={t("cigars.sort")}
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              {["name", "recent", "remaining", "rating"].map((value) => (
                <option key={value} value={value}>
                  {t("cigars.order." + value)}
                </option>
              ))}
            </select>
          </div>
          {readState.kind === "ready" && (
            <p className="count">
              {t("count", { visible: visible.length, total: rows.length })}
            </p>
          )}
        </>
      )}
      <section className="grid" aria-busy={busy}>
        {!busy && readState.kind === "ready" && !displayed.length && (
          <p className="empty">
            {t(
              targetId !== undefined
                ? "cloud.targetMissing"
                : rows.length
                  ? "noResults"
                  : "cigars.empty",
            )}
          </p>
        )}
        {displayed.map(({ row, cigar }) => (
          <article
            className="card"
            key={row.id}
            ref={targetId !== undefined ? targetCard : undefined}
            tabIndex={targetId !== undefined ? -1 : undefined}
            aria-label={targetId !== undefined ? `${cigar.brand} ${cigar.name}` : undefined}
          >
            <div className="photo">
              <PipePhoto
                defer
                id={row.id}
                photo={photo(row)}
                legacy={pendingPhoto(row)}
                alt={t("photoAlt", { name: `${cigar.brand} ${cigar.name}` })}
              />
            </div>
            <div className="info">
              <h3 className="name">
                {cigar.brand} {cigar.name}
              </h3>
              <p className="meta">
                {[cigar.series, cigar.vitola, cigar.country]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {pendingPhoto(row) && <p>{t("cigars.pendingPhoto")}</p>}
              <StockAlertBadge kind="cigar" remaining={cigar.remaining} />
              <dl className="tobacco-details">
                {cigar.remaining !== null && (
                  <div>
                    <dt>{t("cigars.fields.remaining")}</dt>
                    <dd>{number.format(cigar.remaining)}</dd>
                  </div>
                )}
                {cigar.rating !== null && (
                  <div>
                    <dt>{t("cigars.fields.rating")}</dt>
                    <dd>
                      {cigar.rating}/5 ·{" "}
                      {t("starRating.description." + cigar.rating)}
                    </dd>
                  </div>
                )}
                {cigar.humidity !== null && (
                  <div>
                    <dt>{t("cigars.humidityReminder")}</dt>
                    <dd>
                      {number.format(cigar.humidity)} {t("cigars.rhUnit")}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="cardbottom">
                <button
                  className="link"
                  disabled={blocked}
                  onClick={(event) => {
                    focus.trigger.current = event.currentTarget;
                    open(row);
                  }}
                >
                  {t("edit")}
                </button>
              </div>
              {notice?.itemId === row.id && (
                <p role="status">{t(notice.message)}</p>
              )}
            </div>
          </article>
        ))}
      </section>
      <div className="cloudtools">
        <button
          className="btn secondary"
          disabled={busy}
          onClick={reloadFromCloud}
        >
          {t("cloud.reload")}
        </button>
        <button
          className="btn secondary"
          disabled={blocked}
          onClick={() =>
            void run(async (service) => {
              const backup = await service.backup(await service.list());
              if (scope.current === service)
                downloadJson(backup, "tobacco-journal-cigars.json");
            })
          }
        >
          {t("export")}
        </button>
        <button
          className="btn secondary"
          disabled={blocked}
          onClick={() => file.current?.click()}
        >
          {t("import")}
        </button>
        <input
          ref={file}
          type="file"
          hidden
          accept=".json,application/json"
          aria-label={t("import")}
          onChange={(event) => {
            const input = event.currentTarget;
            const selected = input.files?.[0];
            input.value = "";
            if (!selected) return;
            setPlan(undefined);
            setResult(undefined);
            void run(async (service) => {
              try {
                if (selected.size > MAX_BACKUP_BYTES) throw Error();
                const next = inspectCigarBackup(await selected.text());
                if (scope.current === service) setPlan(next);
              } catch {
                if (scope.current === service) setError("cigars.invalidBackup");
              }
            });
          }}
        />
      </div>
      {plan && (
        <section className="migration" aria-label={t("cigars.importTitle")}>
          <h2>{t("cigars.importTitle")}</h2>
          <p>
            {t("cigars.importPlan", {
              valid: plan.filter((item) => item.item).length,
              rejected: plan.filter((item) => item.error).length,
            })}
          </p>
          <button
            className="btn"
            disabled={blocked || !plan.some((entry) => entry.item)}
            onClick={transfer}
          >
            {t("cigars.transfer")}
          </button>
          {result && (
            <p role="status">
              {t("cigars.importResult", {
                imported: result.imported,
                failed: result.errors.length,
                unattempted: result.unattempted,
              })}
            </p>
          )}
          <ul>
            {[
              ...plan.filter((entry) => entry.error),
              ...(result?.errors ?? []),
            ].map((entry, index) => (
              <li key={index}>
                {entry.label} · {t(entry.error!)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
