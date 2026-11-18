import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PHOTO_TYPES, validatePhoto, type PhotoEdit } from "../data/pipePhotos";
import { cloudErrorKey } from "../data/pipeMapping";
import {
  commonComponents,
  componentsOf,
  normalizeTobacco,
  numberFields,
  textFields,
  tobaccoStates,
  type Tobacco,
} from "../data/tobaccos";
import { PipePhoto, usePhotoPreview, type PrivatePhoto } from "./PipePhoto";

import { RemainingLevelPicker } from "./RemainingLevelPicker";
import { StarRating } from "./StarRating";

const inventoryNumbers = numberFields.filter((field) => field !== "rating");
const mainNumbers = inventoryNumbers.filter((field) => field !== "remaining");

export function TobaccoForm({
  initial,
  photo,
  pending,
  busy,
  save,
  cancel,
  remove,
}: {
  initial?: Tobacco;
  photo: PrivatePhoto;
  pending?: string;
  busy: boolean;
  save: (tobacco: Tobacco, edit: PhotoEdit) => Promise<void>;
  cancel: () => void;
  remove: () => void;
}) {
  const { t } = useTranslation();
  const id = useRef(initial?.id || crypto.randomUUID());
  const mounted = useRef(false);
  const brand = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState<PhotoEdit>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(initial?.components ?? []);
  const [rating, setRating] = useState(initial?.rating ?? null);
  const [custom, setCustom] = useState("");
  const preview = usePhotoPreview(edit || undefined);
  useEffect(() => {
    mounted.current = true;
    brand.current?.focus();
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <form
      className="dialog tobacco-editor"
      aria-labelledby="tobacco-form-title"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || checking || error.startsWith("photos.")) return;
        const data = new FormData(event.currentTarget);
        const fields = Object.fromEntries(data);
        for (const key of inventoryNumbers)
          Object.assign(fields, {
            [key]: fields[key] === "" ? null : Number(fields[key]),
          });
        try {
          const tobacco = normalizeTobacco({
            ...fields,
            id: id.current,
            rating,
            remainingLevel: fields.remainingLevel || null,
            components: componentsOf([...selected, ...custom.split(",")]),
          });
          setError("");
          await save(tobacco, edit);
        } catch (failure) {
          if (mounted.current) setError(cloudErrorKey(failure));
        }
      }}
    >
      <h2 id="tobacco-form-title">
        {t(initial ? "tobaccos.edit" : "tobaccos.add")}
      </h2>
      <fieldset className="pipefields" disabled={busy}>
        <div className="formgrid">
          {(["brand", "name", "blend", ...textFields] as const).map((key) => (
            <label className="field" key={key}>
              {t("tobaccos.fields." + key)}
              <input
                ref={key === "brand" ? brand : undefined}
                name={key}
                required={key === "brand" || key === "name"}
                maxLength={200}
                type={key === "date" ? "date" : "text"}
                defaultValue={initial?.[key]}
              />
            </label>
          ))}
          {mainNumbers.map((key) => (
            <label className="field" key={key}>
              {t("tobaccos.fields." + key)}
              <input
                type="number"
                min={0}
                step="any"
                name={key}
                defaultValue={initial?.[key] ?? ""}
              />
            </label>
          ))}
          <label className="field">
            {t("tobaccos.fields.status")}
            <select
              name="status"
              aria-label={t("tobaccos.fields.status")}
              defaultValue={initial?.status ?? ""}
            >
              <option value="">{t("unspecified")}</option>
              {tobaccoStates.map((state) => (
                <option key={state} value={state}>
                  {t("tobaccos.states." + state)}
                </option>
              ))}
            </select>
          </label>
          <RemainingLevelPicker initial={initial?.remainingLevel ?? null} />
          <details className="field full tobacco-remaining-exact">
            <summary>{t("tobaccos.exactDetails")}</summary>
            <label className="field">
              {t("tobaccos.fields.remaining")}
              <input
                type="number"
                min={0}
                step="any"
                name="remaining"
                defaultValue={initial?.remaining ?? ""}
                onInvalid={(event) => {
                  const details = event.currentTarget.closest("details");
                  if (details) details.open = true;
                }}
              />
            </label>
          </details>
          <StarRating
            label={t("tobaccos.fields.rating")}
            value={rating}
            onChange={setRating}
          />
          <fieldset className="field full tobacco-components">
            <legend>{t("tobaccos.fields.components")}</legend>
            {componentsOf([...commonComponents, ...selected]).map((name) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={selected.some(
                    (value) => value.toLowerCase() === name.toLowerCase(),
                  )}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, name]
                        : selected.filter(
                            (value) =>
                              value.toLowerCase() !== name.toLowerCase(),
                          ),
                    )
                  }
                />{" "}
                {name === "Oriental" ? t("tobaccos.oriental") : name}
              </label>
            ))}
            <label className="field">
              {t("tobaccos.custom")}
              <input
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                maxLength={500}
              />
            </label>
          </fieldset>
          <label className="field full">
            {t("tobaccos.fields.notes")}
            <textarea
              name="notes"
              rows={4}
              maxLength={4000}
              defaultValue={initial?.notes}
            />
          </label>
          <div className="field full">
            <label>
              {t(photo.ref || pending ? "photos.replace" : "photos.choose")}
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
            {preview && (
              <img className="preview" src={preview} alt={t("preview")} />
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
              {(photo.ref || photo.damaged || pending || edit) &&
                edit !== null && (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={checking}
                    onClick={() => {
                      setError("");
                      setEdit(
                        photo.ref || photo.damaged || pending
                          ? null
                          : undefined,
                      );
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
        {error && <p role="alert">{t(error)}</p>}
        <div className="actions">
          {initial && (
            <button className="btn danger" type="button" onClick={remove}>
              {t("delete")}
            </button>
          )}
          <div className="right">
            <button className="btn secondary" type="button" onClick={cancel}>
              {t("cancel")}
            </button>
            <button
              className="btn"
              type="submit"
              disabled={checking || error.startsWith("photos.")}
            >
              {t("save")}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
