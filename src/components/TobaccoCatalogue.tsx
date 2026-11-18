import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../auth/client";
import { cloudErrorKey } from "../data/pipeMapping";
import type { PhotoRef } from "../data/pipePhotos";
import { downloadJson, MAX_BACKUP_BYTES } from "../data/storage";
import {
  CloudTobaccos,
  fromTobaccoRow,
  inspectTobaccoBackup,
  tobaccoPhoto,
  tobaccoStates,
  type TobaccoImportItem,
  type TobaccoRow,
} from "../data/tobaccos";
import { PipePhoto } from "./PipePhoto";
import { TobaccoForm } from "./TobaccoForm";

const pendingPhoto = (row?: TobaccoRow) =>
  typeof row?.extra.pendingCataloguePhoto === "string"
    ? row.extra.pendingCataloguePhoto
    : undefined;

export function TobaccoCatalogue({
  userId,
  email,
  onSessionLost,
}: {
  userId: string;
  email: string;
  onSessionLost: () => void;
}) {
  const { t, i18n } = useTranslation();
  const scope = useRef<CloudTobaccos | null>(null);
  const invalidate = useRef(onSessionLost);
  invalidate.current = onSessionLost;
  const lock = useRef(false);
  const [rows, setRows] = useState<TobaccoRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<TobaccoRow | null>();
  const [partial, setPartial] = useState<TobaccoRow>();
  const [search, setSearch] = useState("");
  const [blend, setBlend] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("name");
  const [plan, setPlan] = useState<TobaccoImportItem[]>();
  const [backedUp, setBackedUp] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    errors: TobaccoImportItem[];
    unattempted: number;
  }>();
  const file = useRef<HTMLInputElement>(null);

  function report(failure: unknown) {
    const key = cloudErrorKey(failure);
    if (key === "cloud.errors.session") invalidate.current();
    else setError(key);
  }

  async function run(action: (service: CloudTobaccos) => Promise<void>) {
    const service = scope.current;
    if (!service || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action(service);
    } catch (failure) {
      if (scope.current === service) report(failure);
    } finally {
      if (scope.current === service) {
        lock.current = false;
        setBusy(false);
      }
    }
  }

  async function refresh(service: CloudTobaccos) {
    const next = await service.list();
    if (scope.current === service) setRows(next);
  }

  useEffect(() => {
    const controller = new AbortController();
    scope.current = new CloudTobaccos(supabase!, userId, controller.signal);
    lock.current = false;
    void run(refresh);
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
  function photo(row?: TobaccoRow) {
    try {
      return { ref: row ? tobaccoPhoto(row) : undefined, damaged: false, read };
    } catch {
      return { ref: undefined, damaged: true, read };
    }
  }
  function open(row: TobaccoRow | null) {
    setPartial(undefined);
    setEditing(row);
    setError("");
  }
  function keep(row: TobaccoRow) {
    setRows((current) => [
      ...current.filter((entry) => entry.id !== row.id),
      row,
    ]);
    setBackedUp(false);
  }
  function exportJson(forImport: boolean) {
    void run(async (service) => {
      const backup = await service.backup(
        forImport ? await service.list() : rows,
      );
      if (scope.current !== service) return;
      downloadJson(
        backup,
        forImport
          ? "tobacco-journal-tobaccos-before-import.json"
          : "tobacco-journal-tobaccos.json",
      );
      if (forImport) setBackedUp(true);
    });
  }

  function transfer() {
    if (
      !plan ||
      !backedUp ||
      !window.confirm(t("tobaccos.confirmImport", { email }))
    )
      return;
    setBackedUp(false);
    void run(async (service) => {
      let imported = 0;
      const errors: TobaccoImportItem[] = [];
      const valid = plan.filter((entry) => entry.item);
      let unattempted = 0;
      for (const [index, entry] of valid.entries()) {
        try {
          await service.importOne(entry.item!);
          imported++;
        } catch (failure) {
          if (scope.current !== service) return;
          const key = cloudErrorKey(failure);
          if (key === "cloud.errors.session") {
            invalidate.current();
            return;
          }
          errors.push({ label: entry.label, error: key });
          if (key === "cloud.errors.network" || key === "photos.upload") {
            unattempted = valid.length - index - 1;
            break;
          }
        }
      }
      if (scope.current !== service) return;
      setResult({ imported, errors, unattempted });
      await refresh(service);
    });
  }

  const collator = new Intl.Collator(i18n.language, { sensitivity: "base" });
  const values = rows.map((row) => ({ row, tobacco: fromTobaccoRow(row) }));
  const blends = [
    ...new Set(values.map(({ tobacco }) => tobacco.blend).filter(Boolean)),
  ].sort(collator.compare);
  const visible = values
    .filter(
      ({ tobacco }) =>
        (!status || tobacco.status === status) &&
        (!blend || tobacco.blend === blend) &&
        [
          tobacco.brand,
          tobacco.name,
          tobacco.producer,
          tobacco.blend,
          tobacco.notes,
          ...tobacco.components,
        ]
          .join(" ")
          .toLocaleLowerCase(i18n.language)
          .includes(search.trim().toLocaleLowerCase(i18n.language)),
    )
    .sort((a, b) => {
      if (sort === "recent")
        return b.row.updated_at.localeCompare(a.row.updated_at);
      if (sort === "remaining")
        return (b.tobacco.remaining ?? -1) - (a.tobacco.remaining ?? -1);
      return (
        collator.compare(a.tobacco.name, b.tobacco.name) ||
        collator.compare(a.tobacco.brand, b.tobacco.brand)
      );
    });
  const number = new Intl.NumberFormat(i18n.language);
  return (
    <>
      <section className="intro">
        <div>
          <h1>{t("tobaccos.title")}</h1>
          <p>{t("tobaccos.intro")}</p>
        </div>
        <button
          className="btn"
          disabled={busy || editing !== undefined}
          onClick={() => open(null)}
        >
          {t("tobaccos.add")}
        </button>
      </section>
      {busy && <p role="status">{t("tobaccos.working")}</p>}
      {error && (
        <p className="notice" role="alert">
          {t(error)}
        </p>
      )}
      {notice && <p role="status">{t(notice)}</p>}
      {partial && <p role="status">{t("tobaccos.partial")}</p>}
      {editing !== undefined && (
        <TobaccoForm
          initial={editing ? fromTobaccoRow(editing) : undefined}
          photo={photo(editing ?? undefined)}
          pending={pendingPhoto(editing ?? undefined)}
          busy={busy}
          cancel={() => {
            setEditing(undefined);
            setPartial(undefined);
          }}
          save={(item, edit) =>
            run(async (service) => {
              const outcome = await service.save(
                item,
                editing ?? partial,
                edit,
                (row) => {
                  if (scope.current === service) {
                    keep(row);
                    setPartial(row);
                  }
                },
              );
              if (scope.current !== service) return;
              keep(outcome.row);
              setEditing(undefined);
              setPartial(undefined);
              setNotice(outcome.cleanup ? "photos.cleanup" : "tobaccos.saved");
            })
          }
          remove={() => {
            if (
              !editing ||
              !window.confirm(
                t("tobaccos.confirmDelete", { name: editing.name }),
              )
            )
              return;
            void run(async (service) => {
              const cleanup = await service.remove(editing);
              if (scope.current !== service) return;
              setRows((current) =>
                current.filter((entry) => entry.id !== editing.id),
              );
              setBackedUp(false);
              setEditing(undefined);
              setNotice(cleanup ? "photos.cleanup" : "tobaccos.deleted");
            });
          }}
        />
      )}
      <div className="controls">
        <input
          className="search"
          type="search"
          aria-label={t("tobaccos.search")}
          placeholder={t("tobaccos.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="filter"
          aria-label={t("tobaccos.fields.blend")}
          value={blend}
          onChange={(event) => setBlend(event.target.value)}
        >
          <option value="">{t("tobaccos.allBlends")}</option>
          {blends.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          className="filter"
          aria-label={t("tobaccos.fields.status")}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">{t("allStatuses")}</option>
          {tobaccoStates.map((value) => (
            <option key={value} value={value}>
              {t("tobaccos.states." + value)}
            </option>
          ))}
        </select>
        <select
          className="filter"
          aria-label={t("tobaccos.sort")}
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          {["name", "recent", "remaining"].map((value) => (
            <option key={value} value={value}>
              {t("tobaccos.order." + value)}
            </option>
          ))}
        </select>
      </div>
      <p className="count">
        {t("count", { visible: visible.length, total: rows.length })}
      </p>
      <section className="grid" aria-busy={busy}>
        {!busy && !visible.length && (
          <p className="empty">
            {t(rows.length ? "noResults" : "tobaccos.empty")}
          </p>
        )}
        {visible.map(({ row, tobacco }) => (
          <article className="card" key={row.id}>
            <div className="photo">
              <PipePhoto
                id={row.id}
                photo={photo(row)}
                legacy={pendingPhoto(row)}
                alt={t("photoAlt", { name: row.name })}
              />
            </div>
            <div className="info">
              <h3 className="name">
                {tobacco.brand} {tobacco.name}
              </h3>
              {pendingPhoto(row) && <p>{t("tobaccos.pendingPhoto")}</p>}
              <dl className="tobacco-details">
                {(
                  [
                    "producer",
                    "blend",
                    "package",
                    "initial",
                    "remaining",
                    "date",
                    "price",
                    "intensity",
                    "rating",
                    "notes",
                    "components",
                  ] as const
                ).map((key) => {
                  const value = tobacco[key];
                  if (
                    value === null ||
                    value === "" ||
                    (Array.isArray(value) && !value.length)
                  )
                    return null;
                  const formatted =
                    key === "date"
                      ? new Intl.DateTimeFormat(i18n.language, {
                          timeZone: "UTC",
                        }).format(new Date(String(value)))
                      : typeof value === "number"
                        ? number.format(value)
                        : Array.isArray(value)
                          ? value
                              .map((entry) =>
                                entry === "Oriental"
                                  ? t("tobaccos.oriental")
                                  : entry,
                              )
                              .join(", ")
                          : value;
                  return (
                    <div key={key}>
                      <dt>{t("tobaccos.fields." + key)}</dt>
                      <dd>{formatted}</dd>
                    </div>
                  );
                })}
              </dl>
              <div className="cardbottom">
                {tobacco.status && (
                  <span className="pill">
                    {t("tobaccos.states." + tobacco.status)}
                  </span>
                )}
                <button
                  className="link"
                  disabled={busy || editing !== undefined}
                  onClick={() => open(row)}
                >
                  {t("edit")}
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>
      <div className="cloudtools">
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => {
            setEditing(undefined);
            setPartial(undefined);
            setBackedUp(false);
            void run(refresh);
          }}
        >
          {t("cloud.reload")}
        </button>
        <button
          className="btn secondary"
          disabled={busy || editing !== undefined}
          onClick={() => exportJson(false)}
        >
          {t("export")}
        </button>
        <button
          className="btn secondary"
          disabled={busy || editing !== undefined}
          onClick={() => file.current?.click()}
        >
          {t("import")}
        </button>
        <input
          type="file"
          accept=".json,application/json"
          hidden
          ref={file}
          aria-label={t("import")}
          onChange={(event) => {
            const input = event.currentTarget;
            const selected = input.files?.[0];
            input.value = "";
            if (!selected) return;
            setPlan(undefined);
            setBackedUp(false);
            setResult(undefined);
            void run(async (service) => {
              try {
                if (selected.size > MAX_BACKUP_BYTES) throw Error();
                const next = inspectTobaccoBackup(await selected.text());
                if (scope.current === service) setPlan(next);
              } catch {
                if (scope.current === service)
                  setError("tobaccos.invalidBackup");
              }
            });
          }}
        />
      </div>
      {plan && (
        <section className="migration" aria-label={t("tobaccos.importTitle")}>
          <h2>{t("tobaccos.importTitle")}</h2>
          <p>
            {t("tobaccos.importPlan", {
              valid: plan.filter((entry) => entry.item).length,
              rejected: plan.filter((entry) => entry.error).length,
            })}
          </p>
          <div className="cloudtools">
            <button
              className="btn secondary"
              disabled={busy || editing !== undefined}
              onClick={() => exportJson(true)}
            >
              {t("tobaccos.backupFirst")}
            </button>
            <button
              className="btn"
              disabled={
                busy ||
                editing !== undefined ||
                !backedUp ||
                !plan.some((entry) => entry.item)
              }
              onClick={transfer}
            >
              {t("tobaccos.transfer")}
            </button>
          </div>
          {result && (
            <p role="status">
              {t("tobaccos.importResult", {
                imported: result.imported,
                failed: result.errors.length,
                unattempted: result.unattempted,
              })}
            </p>
          )}
          <ul>
            {[
              ...plan.filter((item) => item.error),
              ...(result?.errors ?? []),
            ].map((item, index) => (
              <li key={index}>
                {item.label} · {t(item.error!)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
