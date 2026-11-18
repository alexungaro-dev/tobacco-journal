import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../auth/client";
import {
  aromaTags,
  fromSessionRow,
  inspectDiaryBackup,
  localDateTime,
  sessionPhoto,
  SmokingJournal,
  type Catalogue,
  type ImportEntry,
  type ProductKind,
  type Session,
  type SessionRow,
  type Snapshot,
} from "../data/smokingJournal";
import { cloudErrorKey } from "../data/pipeMapping";
import type { PhotoRef } from "../data/pipePhotos";
import { downloadJson, MAX_BACKUP_BYTES } from "../data/storage";
import { confirmedStock, type StockOutcome } from "../data/stockAlerts";
import { StockAlertBadge } from "./StockAlerts";
import { JournalProvenance, snapshotLabel as label } from "./JournalProvenance";
import { JournalForm } from "./JournalForm";
import { PipePhoto } from "./PipePhoto";

const blankCatalogue: Catalogue = { pipe: [], tobacco: [], cigar: [] };
const pendingPhoto = (row?: SessionRow) =>
  typeof row?.extra.pendingJournalPhoto === "string"
    ? row.extra.pendingJournalPhoto
    : undefined;
const productKey = (item: Snapshot) =>
  item.catalogueId
    ? JSON.stringify([item.catalogueId])
    : JSON.stringify([item.brand, item.name, item.detail]);

export function SmokingJournalView({
  userId,
  email,
  onSessionLost,
  shortcut,
  onShortcutOpened,
  initialCatalogue,
}: {
  userId: string;
  email: string;
  onSessionLost: () => void;
  shortcut?: { create: true } | { sessionId: string };
  onShortcutOpened?: () => void;
  initialCatalogue?: Catalogue;
}) {
  const { t, i18n } = useTranslation();
  const scope = useRef<SmokingJournal | null>(null);
  const invalidate = useRef(onSessionLost);
  invalidate.current = onSessionLost;
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const targetCard = useRef<HTMLElement>(null);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [catalogue, setCatalogue] = useState(blankCatalogue);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stockFeedback, setStockFeedback] = useState<{
    requested: boolean;
    outcome?: StockOutcome;
  }>();
  const [editing, setEditing] = useState<SessionRow | null>();
  const [created, setCreated] = useState<SessionRow>();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    kind: "",
    product: "",
    rating: "",
    from: "",
    to: "",
    order: "desc",
  });
  const [plan, setPlan] = useState<ImportEntry[]>();
  const [result, setResult] = useState<{
    done: number;
    errors: ImportEntry[];
    pending: number;
  }>();
  const setFilter = (key: keyof typeof filters, value: string) =>
    setFilters((state) => ({ ...state, [key]: value }));

  async function run(action: (service: SmokingJournal) => Promise<void>) {
    const service = scope.current;
    if (!service || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
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

  async function load(service: SmokingJournal, cachedCatalogue?: Catalogue) {
    let sessions: SessionRow[];
    let items: Catalogue;
    try {
      [sessions, items] = await Promise.all([
        service.list(),
        cachedCatalogue ?? service.catalogue(),
      ]);
    } catch (failure) {
      if (
        ["PGRST204", "42703", "42P01"].includes(
          (failure as { code?: string })?.code ?? "",
        )
      ) {
        if (scope.current === service) setError("diary.migration");
        return;
      }
      throw failure;
    }
    if (scope.current === service) {
      setRows(sessions);
      setCatalogue(items);
      setReady(true);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    scope.current = new SmokingJournal(supabase!, userId, controller.signal);
    lock.current = false;
    void run((service) => load(service, initialCatalogue));
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

  function photo(row?: SessionRow) {
    try {
      return { ref: row ? sessionPhoto(row) : undefined, damaged: false, read };
    } catch {
      return { ref: undefined, damaged: true, read };
    }
  }

  function open(row: SessionRow | null | undefined) {
    setStockFeedback(undefined);
    setEditing(row);
    setCreated(undefined);
    setError("");
  }
  function keep(row: SessionRow) {
    setRows((current) => [
      ...current.filter((entry) => entry.id !== row.id),
      row,
    ]);
  }

  function importSessions() {
    const items =
      plan?.flatMap((entry) => (entry.item ? [entry.item] : [])) ?? [];
    if (!items.length || !window.confirm(t("diary.confirmImport", { email })))
      return;
    setResult(undefined);
    void run(async (service) => {
      let done = 0;
      let pending = 0;
      const errors: ImportEntry[] = [];
      for (const [index, item] of items.entries()) {
        try {
          await service.importOne(item, catalogue);
          done++;
        } catch (failure) {
          if (scope.current !== service) return;
          const key = cloudErrorKey(failure);
          if (key === "cloud.errors.session") {
            invalidate.current();
            return;
          }
          errors.push({ label: item.id, error: key });
          if (key === "cloud.errors.network" || key === "photos.upload") {
            pending = items.length - index - 1;
            break;
          }
        }
      }
      if (scope.current === service) {
        setResult({ done, errors, pending });
        await load(service);
      }
    });
  }

  function addProduct(kind: ProductKind, product: Snapshot) {
    if (!window.confirm(t("diary.confirmCatalogue", { name: label(product) })))
      return;
    void run(async (service) => {
      await service.addProduct(kind, product);
      if (scope.current === service) setNotice("diary.catalogueSaved");
    });
  }
  const searchValue = search.trim().toLocaleLowerCase(i18n.language);
  const entries = rows.map((row) => ({ row, item: fromSessionRow(row) }));
  const formatDate = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const tagLabel = (tag: string) =>
    aromaTags.some((known) => known === tag) ? t("diary.tags." + tag) : tag;
  const products = new Map(
    entries.map(({ item }) => [
      JSON.stringify([item.kind, productKey(item.product)]),
      label(item.product) || t("diary.historical"),
    ]),
  );
  const visible = entries
    .filter(({ item }) => {
      const day = localDateTime(new Date(item.startedAt)).slice(0, 10);
      const text = [
        label(item.product),
        label(item.pipe ?? item.product),
        item.product.detail,
        item.pipe?.detail,
        item.product.offeredBy,
        item.pipe?.offeredBy,
        ...item.tags.map(tagLabel),
        ...Object.values(item.details),
        item.notes,
      ]
        .join(" ")
        .toLocaleLowerCase(i18n.language);
      return (
        (!filters.kind || item.kind === filters.kind) &&
        (!filters.product ||
          filters.product ===
            JSON.stringify([item.kind, productKey(item.product)])) &&
        (!filters.rating ||
          (item.rating?.toString() ?? "none") === filters.rating) &&
        (!filters.from || day >= filters.from) &&
        (!filters.to || day <= filters.to) &&
        text.includes(searchValue)
      );
    })
    .sort(
      (a, b) =>
        (Date.parse(b.item.startedAt) - Date.parse(a.item.startedAt)) *
        (filters.order === "asc" ? -1 : 1),
    );

  useEffect(() => {
    if (ready && shortcut && "create" in shortcut) {
      setEditing(null);
      onShortcutOpened?.();
    }
  }, [ready, shortcut, onShortcutOpened]);

  const targetId =
    shortcut && "sessionId" in shortcut ? shortcut.sessionId : undefined;
  useEffect(() => {
    if (ready && targetId !== undefined) targetCard.current?.focus();
  }, [ready, targetId]);
  const displayed =
    targetId !== undefined
      ? entries.filter(({ row }) => row.id === targetId)
      : visible;
  const blocked = !ready || busy || editing !== undefined;
  function describe(kind: ProductKind, product: Snapshot) {
    return (
      <div className="journal-snapshot">
        <strong>{t("diary.entity." + kind)}</strong>
        <span>
          {[label(product), product.detail].filter(Boolean).join(" · ") ||
            t("diary.historical")}
        </span>
        <JournalProvenance kind={kind} snapshot={product} />
        {product.offeredBy && (
          <span>
            {t("diary.offeredBy")}: {product.offeredBy}
          </span>
        )}
        {product.source !== "owned" && product.brand && product.name && (
          <button
            className="link"
            disabled={blocked}
            onClick={() => addProduct(kind, product)}
          >
            {t("diary.addCatalogue")}
          </button>
        )}
      </div>
    );
  }

  function details(item: Session, expanded: boolean) {
    return (
      <details className="cigar-advanced" open={expanded || undefined}>
        <summary>{t("diary.view")}</summary>
        {describe(item.kind === "pipe" ? "tobacco" : "cigar", item.product)}
        {item.pipe && describe("pipe", item.pipe)}
        <dl className="tobacco-details">
          {item.duration !== null && (
            <div>
              <dt>{t("diary.duration")}</dt>
              <dd>{t("diary.minutes", { count: item.duration })}</dd>
            </div>
          )}
          {item.tags.length > 0 && (
            <div>
              <dt>{t("diary.aromas")}</dt>
              <dd>{item.tags.map(tagLabel).join(", ")}</dd>
            </div>
          )}
          {Object.entries(item.details).map(([key, value]) => (
            <div key={key}>
              <dt>{t("diary.details." + key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          {item.again !== null && (
            <div>
              <dt>{t("diary.again")}</dt>
              <dd>{t(item.again ? "diary.yes" : "diary.no")}</dd>
            </div>
          )}
          {item.notes && (
            <div>
              <dt>{t("diary.finalNotes")}</dt>
              <dd>{item.notes}</dd>
            </div>
          )}
        </dl>
      </details>
    );
  }
  return (
    <>
      <section className="intro">
        <div>
          <h1>{t("diary.title")}</h1>
          <p>{t("diary.intro")}</p>
        </div>
        <button className="btn" disabled={blocked} onClick={() => open(null)}>
          {t("diary.add")}
        </button>
      </section>
      {busy && <p role="status">{t("diary.working")}</p>}
      {error && (
        <p className="notice" role="alert">
          {t(error)}
        </p>
      )}
      {notice && <p role="status">{t(notice)}</p>}
      {created && <p role="status">{t("diary.partial")}</p>}
      {stockFeedback && (
        <p role="status" className="stock-confirmation">
          {t(
            stockFeedback.outcome
              ? "diary.stockUpdated"
              : stockFeedback.requested
                ? "diary.stockUnverified"
                : "diary.stockUnchanged",
          )}
          {stockFeedback.outcome && (
            <StockAlertBadge {...stockFeedback.outcome} />
          )}
        </p>
      )}
      {editing !== undefined && (
        <JournalForm
          initial={editing ? fromSessionRow(editing) : undefined}
          catalogue={catalogue}
          stockAllowed={!editing && !created}
          busy={busy}
          photo={photo(editing ?? undefined)}
          pending={pendingPhoto(editing ?? undefined)}
          onCancel={() => {
            open(undefined);
            if (created) void run(load);
          }}
          onSave={(item, stock, edit) =>
            run(async (service) => {
              const previous = editing ?? created;
              const saved = await service.save(
                item,
                catalogue,
                previous,
                previous ? null : stock,
                edit,
                (row) => {
                  if (scope.current === service) {
                    keep(row);
                    setCreated(row);
                    setStockFeedback({
                      requested: !!stock,
                      outcome: stock ? confirmedStock(row.extra) : undefined,
                    });
                  }
                },
              );
              if (scope.current !== service) return;
              keep(saved.row);
              open(undefined);
              setNotice(saved.cleanup ? "photos.cleanup" : "diary.saved");
              if (!editing) {
                const requested =
                  !!stock || !!(created && stockFeedback?.requested);
                setStockFeedback({
                  requested,
                  outcome: requested
                    ? confirmedStock(saved.row.extra)
                    : undefined,
                });
              }
              if (stock || created) {
                try {
                  const next = await service.catalogue();
                  if (scope.current === service) setCatalogue(next);
                } catch (failure) {
                  if (cloudErrorKey(failure) === "cloud.errors.session")
                    throw failure;
                  if (scope.current === service) {
                    setReady(false);
                    setError("diary.stockReload");
                  }
                }
              }
            })
          }
          onDelete={() => {
            if (!editing || !window.confirm(t("diary.confirmDelete"))) return;
            void run(async (service) => {
              const cleanup = await service.remove(editing);
              if (scope.current !== service) return;
              setRows((current) =>
                current.filter((row) => row.id !== editing.id),
              );
              open(undefined);
              setNotice(cleanup ? "photos.cleanup" : "diary.deleted");
            });
          }}
        />
      )}
      {targetId !== undefined ? (
        <p>
          <a className="link" href="#diary">
            {t("dashboard.openDiary")}
          </a>
        </p>
      ) : (
        <>
          <div className="controls journal-controls">
            <input
              type="search"
              className="search"
              aria-label={t("diary.search")}
              placeholder={t("diary.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="filter"
              aria-label={t("diary.kind")}
              value={filters.kind}
              onChange={(e) => setFilter("kind", e.target.value)}
            >
              <option value="">{t("diary.allKinds")}</option>
              <option value="pipe">{t("diary.kinds.pipe")}</option>
              <option value="cigar">{t("diary.kinds.cigar")}</option>
            </select>
            <select
              className="filter"
              aria-label={t("diary.product")}
              value={filters.product}
              onChange={(e) => setFilter("product", e.target.value)}
            >
              <option value="">{t("diary.allProducts")}</option>
              {[...products].map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
            <select
              className="filter"
              aria-label={t("diary.rating")}
              value={filters.rating}
              onChange={(e) => setFilter("rating", e.target.value)}
            >
              <option value="">{t("diary.allRatings")}</option>
              <option value="none">{t("starRating.description.0")}</option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}/5
                </option>
              ))}
            </select>
            <label className="field">
              {t("diary.from")}
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilter("from", e.target.value)}
              />
            </label>
            <label className="field">
              {t("diary.to")}
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilter("to", e.target.value)}
              />
            </label>
            <label className="field">
              {t("diary.order")}
              <select
                aria-label={t("diary.order")}
                value={filters.order}
                onChange={(e) => setFilter("order", e.target.value)}
              >
                <option value="desc">{t("diary.newest")}</option>
                <option value="asc">{t("diary.oldest")}</option>
              </select>
            </label>
          </div>
          <p className="count">
            {t("count", { visible: visible.length, total: rows.length })}
          </p>
        </>
      )}
      <section className="grid" aria-busy={busy}>
        {ready && !busy && !displayed.length && (
          <p className="empty">
            {t(
              targetId !== undefined
                ? "dashboard.sessionMissing"
                : rows.length
                  ? "noResults"
                  : "diary.empty",
            )}
          </p>
        )}
        {displayed.map(({ row, item }) => (
          <article
            className="card"
            key={row.id}
            ref={row.id === targetId ? targetCard : undefined}
            tabIndex={row.id === targetId ? -1 : undefined}
          >
            {row.extra.journalPhoto || pendingPhoto(row) ? (
              <div className="photo">
                <PipePhoto
                  id={row.id}
                  photo={photo(row)}
                  legacy={pendingPhoto(row)}
                  alt={t("photoAlt", {
                    name: label(item.product) || t("diary.historical"),
                  })}
                />
              </div>
            ) : null}
            <div className="info">
              <p className="meta">
                {t("diary.kinds." + item.kind)} ·{" "}
                <time dateTime={item.startedAt}>
                  {formatDate.format(new Date(item.startedAt))}
                </time>
              </p>
              <div className="journal-origin-row">
                <h3 className="name">
                  {label(item.product) || t("diary.historical")}
                </h3>
                <JournalProvenance
                  kind={item.kind === "pipe" ? "tobacco" : "cigar"}
                  snapshot={item.product}
                />
              </div>
              {item.pipe && (
                <div className="journal-origin-row journal-pipe-origin">
                  <span>
                    {t("diary.entity.pipe")}:{" "}
                    {label(item.pipe) || t("diary.historical")}
                  </span>
                  <JournalProvenance kind="pipe" snapshot={item.pipe} />
                </div>
              )}
              {item.rating !== null && (
                <p>
                  {item.rating}/5 · {t("starRating.description." + item.rating)}
                </p>
              )}
              {pendingPhoto(row) && <p>{t("diary.pendingPhoto")}</p>}
              {details(item, row.id === targetId)}
              <button
                className="link"
                disabled={blocked}
                onClick={() => open(row)}
              >
                {t("diary.edit")}
              </button>
            </div>
          </article>
        ))}
      </section>
      <div className="cloudtools">
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => {
            open(undefined);
            void run(load);
          }}
        >
          {t("cloud.reload")}
        </button>
        <button
          className="btn secondary"
          disabled={blocked}
          onClick={() =>
            void run(async (service) => {
              const backup = await service.backup();
              if (scope.current === service)
                downloadJson(backup, "tobacco-journal-smoking-journal.json");
            })
          }
        >
          {t("export")}
        </button>
        <button
          className="btn secondary"
          disabled={blocked}
          onClick={() => input.current?.click()}
        >
          {t("import")}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".json,application/json"
          aria-label={t("import")}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setPlan(undefined);
            setResult(undefined);
            void run(async (service) => {
              try {
                if (file.size > MAX_BACKUP_BYTES) throw Error();
                const next = inspectDiaryBackup(await file.text());
                if (scope.current === service) setPlan(next);
              } catch {
                if (scope.current === service) setError("diary.invalidBackup");
              }
            });
          }}
        />
      </div>
      {plan && (
        <section className="migration" aria-label={t("diary.importTitle")}>
          <h2>{t("diary.importTitle")}</h2>
          <p>
            {t("diary.importPlan", {
              valid: plan.filter((entry) => entry.item).length,
              rejected: plan.filter((entry) => entry.error).length,
            })}
          </p>
          <button
            className="btn"
            disabled={blocked || !plan.some((entry) => entry.item)}
            onClick={importSessions}
          >
            {t("diary.import")}
          </button>
          {result && (
            <p role="status">
              {t("diary.importResult", {
                done: result.done,
                failed: result.errors.length,
                pending: result.pending,
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
