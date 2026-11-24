import { useEffect, useId, useRef, useState } from "react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { EditorFeedback } from "./CloudFeedback";
import {
  cigarNumberFields,
  normalizeCigar,
  vitolas,
  type Cigar,
} from "../data/cigars";
import { cloudErrorKey } from "../data/pipeMapping";
import { PHOTO_TYPES, validatePhoto, type PhotoEdit } from "../data/pipePhotos";
import { PipePhoto, usePhotoPreview, type PrivatePhoto } from "./PipePhoto";
import { StarRating } from "./StarRating";

export function CigarForm({
  initial,
  photo,
  pending,
  busy,
  headingRef,
  saveError,
  saveStatus,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: Cigar;
  photo: PrivatePhoto;
  pending?: string;
  busy: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  saveError: string;
  saveStatus?: string;
  onSave: (item: Cigar, edit: PhotoEdit) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const id = useRef(initial?.id || crypto.randomUUID());
  const heading = useId();
  const suggestions = useId();
  const mounted = useRef(false);
  const [rating, setRating] = useState(initial?.rating ?? null);
  const [edit, setEdit] = useState<PhotoEdit>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const chosen = usePhotoPreview(edit || undefined);
  const hasPhoto = !!(photo.ref || photo.damaged || pending);
  const field = (key: keyof Cigar) => t("cigars.fields." + key);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function text(key: Exclude<keyof Cigar, (typeof cigarNumberFields)[number]>) {
    return (
      <label className="field" key={key}>
        {field(key)}
        <input
          name={key}
          required={key === "brand" || key === "name"}
          list={key === "vitola" ? suggestions : undefined}
          type={key === "date" ? "date" : "text"}
          maxLength={200}
          defaultValue={initial?.[key]}
        />
      </label>
    );
  }

  function number(key: (typeof cigarNumberFields)[number]) {
    return (
      <label className="field" key={key}>
        {field(key)}
        <input
          name={key}
          type="number"
          min={0}
          max={key === "humidity" ? 100 : undefined}
          step={key === "initial" || key === "remaining" ? 1 : "any"}
          defaultValue={initial?.[key] ?? ""}
        />
      </label>
    );
  }

  return (
    <form
      className="dialog tobacco-editor cigar-editor"
      aria-labelledby={heading}
      onInvalid={(event) => {
        const details = (event.target as HTMLElement).closest("details");
        if (details) details.open = true;
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || checking || error.startsWith("photos.")) return;
        const data = new FormData(event.currentTarget);
        const numbers = Object.fromEntries(
          cigarNumberFields.map((key) => [
            key,
            data.get(key) ? Number(data.get(key)) : null,
          ]),
        );
        try {
          const item = normalizeCigar({
            ...Object.fromEntries(data),
            ...numbers,
            id: id.current,
            rating,
          });
          setError("");
          await onSave(item, edit);
        } catch (failure) {
          if (mounted.current) setError(cloudErrorKey(failure));
        }
      }}
    >
      <h2 id={heading} ref={headingRef} tabIndex={-1}>{t(initial ? "cigars.edit" : "cigars.add")}</h2>
      <fieldset className="pipefields" disabled={busy}>
        <div className="formgrid">
          {(["brand", "name", "series", "vitola", "country"] as const).map(
            text,
          )}
          <datalist id={suggestions}>
            {vitolas.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          {number("remaining")}
          <StarRating
            label={field("rating")}
            value={rating}
            onChange={setRating}
          />
          <details className="field full cigar-advanced">
            <summary>{t("cigars.advanced")}</summary>
            <div className="formgrid">
              {(["length", "ringGauge"] as const).map(number)}
              {(["wrapper", "binder", "filler", "strength"] as const).map(text)}
              {(["initial", "price"] as const).map(number)}
              {text("date")}
              <div>
                {number("humidity")}
                <small>{t("cigars.humidityHint")}</small>
              </div>
              <label className="field full">
                {field("notes")}
                <textarea
                  name="notes"
                  rows={4}
                  maxLength={4000}
                  defaultValue={initial?.notes}
                />
              </label>
            </div>
          </details>
          <div className="field full">
            <label>
              {t(hasPhoto ? "photos.replace" : "photos.choose")}
              <input
                type="file"
                accept={PHOTO_TYPES.join(",")}
                disabled={checking}
                onChange={async (event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  input.value = "";
                  if (!file) return;
                  setChecking(true);
                  setError("");
                  try {
                    await validatePhoto(file);
                    if (mounted.current) setEdit(file);
                  } catch (failure) {
                    if (mounted.current) setError(cloudErrorKey(failure));
                  } finally {
                    if (mounted.current) setChecking(false);
                  }
                }}
              />
            </label>
            {checking && <p role="status">{t("photos.validating")}</p>}
            {chosen && (
              <img className="preview" src={chosen} alt={t("preview")} />
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
                    setError("");
                    setEdit(hasPhoto ? null : undefined);
                  }}
                >
                  {t("photos.remove")}
                </button>
              )}
              {(edit !== undefined || error.startsWith("photos.")) && (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={checking}
                  onClick={() => {
                    setError("");
                    setEdit(undefined);
                  }}
                >
                  {t("photos.undo")}
                </button>
              )}
            </div>
          </div>
        </div>
        <EditorFeedback
          error={error || saveError}
          status={saveStatus}
          busy={busy}
        />
        <div className="actions">
          {initial && (
            <button className="btn danger" type="button" onClick={onDelete}>
              {t("delete")}
            </button>
          )}
          <div className="right">
            <button className="btn secondary" type="button" onClick={onCancel}>
              {t("cancel")}
            </button>
            <button
              className="btn"
              type="submit"
              disabled={checking || error.startsWith("photos.")}
            >
              {t("cigars.save")}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
