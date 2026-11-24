import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { validatePhoto, PHOTO_TYPES, type PhotoEdit } from "../data/pipePhotos";
import { cloudErrorKey } from "../data/pipeMapping";
import { PipePhoto, usePhotoPreview, type PrivatePhoto } from "./PipePhoto";
import type { Pipe } from "../types";
export function PipeForm({
  pipe,
  onSave,
  privatePhoto,
  warning,
  onDelete,
  onClose,
  busy,
  error: cloudError,
}: {
  pipe: Pipe | null;
  onSave: (p: Pipe, photo: PhotoEdit) => Promise<boolean>;
  privatePhoto: PrivatePhoto;
  warning: string;
  onDelete: (p: Pipe) => Promise<void>;
  busy: boolean;
  error: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [edit, setEdit] = useState<PhotoEdit>();
  const [validating, setValidating] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const selection = useRef(0);
  useEffect(
    () => () => {
      selection.current++;
    },
    [],
  );
  const preview = usePhotoPreview(edit || undefined);
  const hasPhoto =
    !!privatePhoto.ref || (privatePhoto.ref === undefined && !!pipe?.photo);
  async function choose(file: File) {
    const current = ++selection.current;
    setValidating(true);
    setPhotoError("");
    try {
      await validatePhoto(file);
      if (selection.current === current) setEdit(file);
    } catch (failure) {
      if (selection.current === current) setPhotoError(cloudErrorKey(failure));
    } finally {
      if (selection.current === current) setValidating(false);
    }
  }
  const newId = useRef(crypto.randomUUID());
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) onClose();
      if (e.key === "Tab") {
        const items = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:enabled,input:enabled,select:enabled,textarea:enabled",
          ) || [],
        ).filter((el) => !el.hidden && el.offsetParent !== null);
        if (!items.length) {
          e.preventDefault();
          return;
        }
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal open"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="formtitle"
        ref={dialog}
      >
        <div className="eyebrow">{t("catalogue")}</div>
        <h2 id="formtitle">{t(pipe ? "editTitle" : "addTitle")}</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || validating || photoError) return;
            setError("");
            const data = new FormData(e.currentTarget);
            const value = (k: string) => String(data.get(k) || "").trim();
            if (!value("brand") || !value("model")) {
              setError(t("required"));
              return;
            }
            const now = new Date().toISOString();
            const next: Pipe = {
              ...pipe,
              id: pipe?.id || newId.current,
              brand: value("brand"),
              model: value("model"),
              shape: value("shape"),
              material: value("material"),
              filter: value("filter"),
              status: value("status"),
              date: value("date"),
              price: value("price") === "" ? null : Number(value("price")),
              notes: value("notes"),
              createdAt: pipe?.createdAt || now,
              updatedAt: now,
            };
            await onSave(next, edit);
          }}
        >
          <fieldset className="pipefields" disabled={busy}>
            <div className="formgrid">
              {(["brand", "model", "shape", "material"] as const).map((k) => (
                <div className="field" key={k}>
                  <label htmlFor={k}>
                    {t(`fields.${k}`)}
                    {k === "brand" || k === "model" ? " *" : ""}
                  </label>
                  <input
                    id={k}
                    name={k}
                    required={k === "brand" || k === "model"}
                    maxLength={k === "model" ? 120 : 100}
                    defaultValue={pipe?.[k] || ""}
                  />
                </div>
              ))}
              <div className="field">
                <label htmlFor="filter">{t("fields.filter")}</label>
                <select
                  id="filter"
                  name="filter"
                  defaultValue={pipe?.filter || ""}
                >
                  <option value="">{t("unspecified")}</option>
                  {["none", "6", "9", "other"].map((v) => (
                    <option key={v} value={v}>
                      {t(`filters.${v}`)}
                    </option>
                  ))}
                  {pipe?.filter &&
                    !["none", "6", "9", "other"].includes(pipe.filter) && (
                      <option value={pipe.filter}>{pipe.filter}</option>
                    )}
                </select>
              </div>
              <div className="field">
                <label htmlFor="status">{t("fields.status")}</label>
                <select
                  id="status"
                  name="status"
                  defaultValue={pipe?.status || "in_use"}
                >
                  {["in_use", "stored", "archived"].map((v) => (
                    <option key={v} value={v}>
                      {t(`statuses.${v}`)}
                    </option>
                  ))}
                  {pipe?.status &&
                    !["in_use", "stored", "archived"].includes(pipe.status) && (
                      <option value={pipe.status}>{pipe.status}</option>
                    )}
                </select>
              </div>
              <div className="field">
                <label htmlFor="date">{t("fields.date")}</label>
                <input
                  type="date"
                  id="date"
                  name="date"
                  defaultValue={pipe?.date || ""}
                />
              </div>
              <div className="field">
                <label htmlFor="price">{t("fields.price")}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="999999"
                  id="price"
                  name="price"
                  defaultValue={pipe?.price ?? ""}
                />
              </div>
              <div className="field full">
                <label htmlFor="notes">{t("fields.notes")}</label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  maxLength={4000}
                  defaultValue={pipe?.notes || ""}
                />
              </div>
              <div className="field full">
                <label htmlFor="pipephoto">
                  {t(hasPhoto ? "photos.replace" : "photos.choose")}
                </label>
                <input
                  type="file"
                  id="pipephoto"
                  accept={PHOTO_TYPES.join(",")}
                  onChange={(event) => {
                    const input = event.currentTarget;
                    const file = input.files?.[0];
                    input.value = "";
                    if (file) void choose(file);
                  }}
                />
                {validating && <p role="status">{t("photos.validating")}</p>}
                {photoError && (
                  <p className="formerror" role="alert">
                    {t(photoError)}
                  </p>
                )}
                {preview && (
                  <img className="preview" src={preview} alt={t("preview")} />
                )}
                {edit === undefined && pipe && (
                  <PipePhoto
                    id={pipe.id}
                    photo={privatePhoto}
                    legacy={pipe.photo}
                    alt={t("preview")}
                    editor
                  />
                )}
                {edit === null && (
                  <p role="status">{t("photos.removePending")}</p>
                )}
                <div className="cloudtools">
                  {(hasPhoto || edit) && edit !== null && (
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={validating}
                      onClick={() => {
                        setPhotoError("");
                        setEdit(hasPhoto ? null : undefined);
                      }}
                    >
                      {t("photos.remove")}
                    </button>
                  )}
                  {(edit !== undefined || photoError) && (
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={validating}
                      onClick={() => {
                        setPhotoError("");
                        setEdit(undefined);
                      }}
                    >
                      {t("photos.undo")}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {busy && <p role="status">{t("cloud.saving")}</p>}
            {warning && <p role="status">{t(warning)}</p>}
            {(error || cloudError) && (
              <p className="formerror" role="alert">
                {error || t(cloudError)}
              </p>
            )}
            <div className="actions">
              {pipe && (
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => void onDelete(pipe)}
                >
                  {t("delete")}
                </button>
              )}
              <div className="right">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={onClose}
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  className="btn"
                  disabled={busy || validating || !!photoError}
                >
                  {t("save")}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}
