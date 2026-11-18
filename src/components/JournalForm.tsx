import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  aromaTags,
  detailGroups,
  localDateTime,
  normalizeSession,
  sources,
  type Catalogue,
  type CatalogueItem,
  type Session,
  type Snapshot,
  type Source,
  type StockChange,
} from "../data/smokingJournal";
import { remainingLevels, type RemainingLevel } from "../data/tobaccos";
import { cloudErrorKey } from "../data/pipeMapping";
import { PHOTO_TYPES, validatePhoto, type PhotoEdit } from "../data/pipePhotos";
import { PipePhoto, usePhotoPreview, type PrivatePhoto } from "./PipePhoto";
import { canDebitCigar } from "../data/stockAlerts";
import { StockAlertBadge } from "./StockAlerts";
import { StarRating } from "./StarRating";

type Choice = { source: Source; id: string };
const initialChoice = (item?: Snapshot | null): Choice => ({
  source: item?.source ?? "owned",
  id: item?.catalogueId ?? "",
});

function ProductFields({
  part,
  choice,
  onChoice,
  items,
  initial,
}: {
  part: "product" | "pipe";
  choice: Choice;
  onChoice: (choice: Choice) => void;
  items: CatalogueItem[];
  initial?: Snapshot | null;
}) {
  const { t } = useTranslation();
  const label = t("diary." + part);
  const historical =
    initial?.source === "owned" &&
    initial.catalogueId &&
    !items.some(({ id }) => id === initial.catalogueId);
  return (
    <fieldset className="field full journal-product">
      <legend>{label}</legend>
      <div className="formgrid">
        <label className="field">
          {t("diary.source")}
          <select
            aria-label={t("diary.sourceFor", { label })}
            value={choice.source}
            onChange={(e) =>
              onChoice({ source: e.target.value as Source, id: "" })
            }
          >
            {sources.map((source) => (
              <option key={source} value={source}>
                {t("diary.sources." + source)}
              </option>
            ))}
          </select>
        </label>
        {choice.source === "owned" ? (
          <label className="field">
            {t("diary.chooseRecord")}
            <select
              aria-label={t("diary.chooseFor", { label })}
              value={choice.id}
              required
              onChange={(e) => onChoice({ ...choice, id: e.target.value })}
            >
              <option value="">{t("diary.chooseRecord")}</option>
              {historical && (
                <option value={initial.catalogueId!}>
                  {initial.brand} {initial.name} · {t("diary.historical")}
                </option>
              )}
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {[item.brand, item.name, item.detail]
                    .filter(Boolean)
                    .join(" · ")}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            {(["brand", "name", "detail", "offeredBy"] as const).map((key) => (
              <label className="field" key={key}>
                {t("diary." + key)}
                <input
                  name={part + "." + key}
                  maxLength={200}
                  required={key === "name"}
                  defaultValue={
                    initial?.source !== "owned" ? initial?.[key] : undefined
                  }
                />
              </label>
            ))}
          </>
        )}
      </div>
    </fieldset>
  );
}

function StockFields({
  kind,
  item,
}: {
  kind: Session["kind"];
  item: CatalogueItem;
}) {
  const { t, i18n } = useTranslation();
  const [enabled, setEnabled] = useState(
    kind === "cigar" && canDebitCigar(item.remaining),
  );
  const [changeLevel, setChangeLevel] = useState(false);
  const [changeGrams, setChangeGrams] = useState(false);
  const number = new Intl.NumberFormat(i18n.language);
  const available = kind === "pipe" || canDebitCigar(item.remaining);
  return (
    <fieldset className="field full journal-product">
      <legend>{t("diary.stock")}</legend>
      {kind === "cigar" ? (
        <p>
          {item.remaining === null
            ? t("diary.unknownStock")
            : t("diary.cigarStock", {
                before: item.remaining,
                after: enabled
                  ? Math.max(0, item.remaining - 1)
                  : item.remaining,
              })}
        </p>
      ) : (
        <p>
          {t("diary.tobaccoStock", {
            level: t(
              "tobaccos.levels." + (item.remainingLevel ?? "unspecified"),
            ),
            grams:
              item.remaining === null
                ? t("unspecified")
                : number.format(item.remaining),
          })}
        </p>
      )}
      <label className="journal-check">
        <input
          name="stock"
          type="checkbox"
          disabled={!available}
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {t(kind === "cigar" ? "diary.subtract" : "diary.updateStock")}
      </label>
      {kind === "pipe" && enabled && (
        <div className="formgrid">
          <div className="field">
            <label className="journal-check">
              <input
                name="changeLevel"
                type="checkbox"
                checked={changeLevel}
                onChange={(e) => setChangeLevel(e.target.checked)}
              />
              {t("diary.changeLevel")}
            </label>
            {changeLevel && (
              <select
                name="stockLevel"
                aria-label={t("tobaccos.fields.remainingLevel")}
                defaultValue={item.remainingLevel ?? ""}
              >
                <option value="">{t("tobaccos.levels.unspecified")}</option>
                {remainingLevels.map((level) => (
                  <option key={level} value={level}>
                    {t("tobaccos.levels." + level)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="field">
            <label className="journal-check">
              <input
                name="changeGrams"
                type="checkbox"
                checked={changeGrams}
                onChange={(e) => setChangeGrams(e.target.checked)}
              />
              {t("diary.changeGrams")}
            </label>
            {changeGrams && (
              <input
                name="stockGrams"
                aria-label={t("tobaccos.fields.remaining")}
                type="number"
                min={0}
                step="any"
                defaultValue={item.remaining ?? ""}
              />
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}

export function JournalForm({
  initial,
  catalogue,
  stockAllowed,
  busy,
  photo,
  pending,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: Session;
  catalogue: Catalogue;
  stockAllowed: boolean;
  busy: boolean;
  photo: PrivatePhoto;
  pending?: string;
  onSave: (
    item: Session,
    stock: StockChange | null,
    edit: PhotoEdit,
  ) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const title = useId();
  const id = useRef(initial?.id ?? crypto.randomUUID());
  const date = useRef(
    localDateTime(initial ? new Date(initial.startedAt) : new Date()),
  );
  const mounted = useRef(false);
  const [kind, setKind] = useState<Session["kind"]>(initial?.kind ?? "pipe");
  const [product, setProduct] = useState(initialChoice(initial?.product));
  const [pipe, setPipe] = useState(initialChoice(initial?.pipe));
  const [rating, setRating] = useState(initial?.rating ?? null);
  const [edit, setEdit] = useState<PhotoEdit>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const preview = usePhotoPreview(edit || undefined);
  const hasPhoto = !!(photo.ref || photo.damaged || pending);
  const products = kind === "cigar" ? catalogue.cigar : catalogue.tobacco;
  const selected =
    product.source === "owned"
      ? products.find(({ id }) => id === product.id)
      : undefined;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <form
      className="dialog tobacco-editor journal-editor"
      aria-labelledby={title}
      onInvalid={(event) => {
        const details = (event.target as HTMLElement).closest("details");
        if (details) details.open = true;
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || checking || error.startsWith("photos.")) return;
        const data = new FormData(event.currentTarget);
        const read = (key: string) => String(data.get(key) ?? "");
        function asSnapshot(
          part: "product" | "pipe",
          choice: Choice,
          items: CatalogueItem[],
          prior?: Snapshot | null,
        ) {
          if (choice.source === "owned") {
            if (prior?.source === "owned" && prior.catalogueId === choice.id)
              return prior;
            const item = items.find((entry) => entry.id === choice.id);
            return (
              item && {
                source: "owned",
                catalogueId: item.id,
                brand: item.brand,
                name: item.name,
                detail: item.detail,
              }
            );
          }
          return {
            source: choice.source,
            brand: read(part + ".brand"),
            name: read(part + ".name"),
            detail: read(part + ".detail"),
            offeredBy: read(part + ".offeredBy"),
          };
        }
        try {
          const item = normalizeSession({
            id: id.current,
            kind,
            startedAt:
              initial && read("startedAt") === date.current
                ? initial.startedAt
                : read("startedAt"),
            duration: read("duration") === "" ? null : Number(read("duration")),
            product: asSnapshot(
              "product",
              product,
              products,
              initial?.kind === kind ? initial.product : null,
            ),
            pipe:
              kind === "pipe"
                ? asSnapshot("pipe", pipe, catalogue.pipe, initial?.pipe)
                : null,
            rating,
            tags: [...data.getAll("aroma"), ...read("customTags").split(",")],
            details: Object.fromEntries(
              Object.values(detailGroups)
                .flat()
                .map((key) => [key, read(key)]),
            ),
            again: read("again") ? read("again") === "yes" : null,
            notes: read("notes"),
          });
          let stock: StockChange | null = null;
          if (stockAllowed && selected && data.has("stock")) {
            if (kind === "cigar" && canDebitCigar(selected.remaining))
              stock = { kind: "cigar", revision: selected.updatedAt };
            if (kind === "pipe") {
              const patch: Extract<StockChange, { kind: "tobacco" }>["patch"] =
                {};
              if (data.has("changeLevel"))
                patch.remainingLevel = (read("stockLevel") ||
                  null) as RemainingLevel | null;
              if (data.has("changeGrams"))
                patch.remaining =
                  read("stockGrams") === "" ? null : Number(read("stockGrams"));
              if (Object.keys(patch).length)
                stock = {
                  kind: "tobacco",
                  revision: selected.updatedAt,
                  patch,
                };
            }
          }
          setError("");
          await onSave(item, stock, edit);
        } catch (failure) {
          if (mounted.current) setError(cloudErrorKey(failure));
        }
      }}
    >
      <h2 id={title}>{t(initial ? "diary.edit" : "diary.add")}</h2>
      <fieldset className="pipefields" disabled={busy}>
        <div className="formgrid">
          <label className="field">
            {t("diary.kind")}
            <select
              value={kind}
              aria-label={t("diary.kind")}
              onChange={(e) => {
                const next = e.target.value === "pipe" ? "pipe" : "cigar";
                setKind(next);
                setProduct(
                  initialChoice(
                    initial?.kind === next ? initial.product : undefined,
                  ),
                );
              }}
            >
              <option value="pipe">{t("diary.kinds.pipe")}</option>
              <option value="cigar">{t("diary.kinds.cigar")}</option>
            </select>
          </label>
          <label className="field">
            {t("diary.startedAt")}
            <input
              type="datetime-local"
              name="startedAt"
              required
              defaultValue={date.current}
            />
          </label>
          <ProductFields
            key={kind}
            part="product"
            choice={product}
            onChoice={setProduct}
            items={products}
            initial={kind === initial?.kind ? initial.product : null}
          />
          {kind === "pipe" && (
            <ProductFields
              part="pipe"
              choice={pipe}
              onChoice={setPipe}
              items={catalogue.pipe}
              initial={initial?.pipe}
            />
          )}
          <StarRating
            label={t("diary.rating")}
            value={rating}
            onChange={setRating}
          />
          {selected && (
            <div className="field full journal-stock-alert">
              {kind === "cigar" ? (
                <StockAlertBadge kind="cigar" remaining={selected.remaining} />
              ) : (
                <StockAlertBadge
                  kind="tobacco"
                  remainingLevel={selected.remainingLevel}
                />
              )}
            </div>
          )}
          {stockAllowed && selected && (
            <StockFields
              key={kind + selected.id + selected.updatedAt}
              kind={kind}
              item={selected}
            />
          )}
          {!stockAllowed && (
            <p className="field full">{t("diary.noEditStock")}</p>
          )}
          {(["session", "experience", "behavior", kind] as const).map(
            (group) => (
              <details className="field full cigar-advanced" key={group}>
                <summary>{t("diary.groups." + group)}</summary>
                <div className="formgrid">
                  {group === "session" && (
                    <label className="field">
                      {t("diary.duration")}
                      <input
                        name="duration"
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={initial?.duration ?? ""}
                      />
                    </label>
                  )}
                  {detailGroups[group].map((key) => (
                    <label className="field" key={key}>
                      {t("diary.details." + key)}
                      <input
                        name={key}
                        maxLength={4000}
                        defaultValue={initial?.details[key] ?? ""}
                      />
                    </label>
                  ))}
                  {group === "experience" && (
                    <>
                      <fieldset className="field full tobacco-components">
                        <legend>{t("diary.aromas")}</legend>
                        {aromaTags.map((tag) => (
                          <label key={tag}>
                            <input
                              type="checkbox"
                              name="aroma"
                              value={tag}
                              defaultChecked={initial?.tags.includes(tag)}
                            />{" "}
                            {t("diary.tags." + tag)}
                          </label>
                        ))}
                      </fieldset>
                      <label className="field full">
                        {t("diary.customTags")}
                        <input
                          name="customTags"
                          maxLength={1000}
                          defaultValue={initial?.tags
                            .filter(
                              (tag) =>
                                !aromaTags.some((known) => known === tag),
                            )
                            .join(", ")}
                        />
                      </label>
                    </>
                  )}
                  {group === "session" && (
                    <div className="field full">
                      <label>
                        {t(hasPhoto ? "photos.replace" : "photos.choose")}
                        <input
                          type="file"
                          accept={PHOTO_TYPES.join(",")}
                          disabled={checking}
                          onChange={async (event) => {
                            const input = event.currentTarget;
                            const chosen = input.files?.[0];
                            input.value = "";
                            if (!chosen) return;
                            setChecking(true);
                            setError("");
                            try {
                              await validatePhoto(chosen);
                              if (mounted.current) setEdit(chosen);
                            } catch (failure) {
                              if (mounted.current)
                                setError(cloudErrorKey(failure));
                            } finally {
                              if (mounted.current) setChecking(false);
                            }
                          }}
                        />
                      </label>
                      {checking && (
                        <p role="status">{t("photos.validating")}</p>
                      )}
                      {preview && (
                        <img
                          className="preview"
                          src={preview}
                          alt={t("preview")}
                        />
                      )}
                      {initial && edit === undefined && (
                        <PipePhoto
                          id={initial.id}
                          photo={photo}
                          legacy={pending}
                          alt={t("preview")}
                          editor
                        />
                      )}
                      {edit === null && <p>{t("photos.removePending")}</p>}
                      <div className="cloudtools">
                        {(hasPhoto || edit) && edit !== null && (
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={checking}
                            onClick={() => {
                              setEdit(hasPhoto ? null : undefined);
                              setError("");
                            }}
                          >
                            {t("photos.remove")}
                          </button>
                        )}
                        {(edit !== undefined ||
                          error.startsWith("photos.")) && (
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={checking}
                            onClick={() => {
                              setEdit(undefined);
                              setError("");
                            }}
                          >
                            {t("photos.undo")}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            ),
          )}
          <details className="field full cigar-advanced">
            <summary>{t("diary.groups.conclusion")}</summary>
            <div className="formgrid">
              <label className="field">
                {t("diary.again")}
                <select
                  name="again"
                  aria-label={t("diary.again")}
                  defaultValue={
                    initial?.again == null ? "" : initial.again ? "yes" : "no"
                  }
                >
                  <option value="">{t("unspecified")}</option>
                  <option value="yes">{t("diary.yes")}</option>
                  <option value="no">{t("diary.no")}</option>
                </select>
              </label>
              <label className="field full">
                {t("diary.finalNotes")}
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={4000}
                  defaultValue={initial?.notes}
                />
              </label>
            </div>
          </details>
        </div>
        {error && <p role="alert">{t(error)}</p>}
        <div className="actions">
          {initial && (
            <button type="button" className="btn danger" onClick={onDelete}>
              {t("delete")}
            </button>
          )}
          <div className="right">
            <button type="button" className="btn secondary" onClick={onCancel}>
              {t("cancel")}
            </button>
            <button
              type="submit"
              className="btn"
              disabled={checking || error.startsWith("photos.")}
            >
              {t("diary.save")}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
