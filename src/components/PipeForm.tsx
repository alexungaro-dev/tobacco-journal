import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Pipe } from "../types";
export function PipeForm({
  pipe,
  onSave,
  onDelete,
  onClose,
}: {
  pipe: Pipe | null;
  onSave: (p: Pipe) => boolean;
  onDelete: (p: Pipe) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [photo, setPhoto] = useState(pipe?.photo || null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const dialog = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select,textarea",
          ) || [],
        ).filter((el) => !el.hidden && el.offsetParent !== null);
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
        if (e.target === e.currentTarget) onClose();
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
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const value = (k: string) => String(data.get(k) || "").trim();
            if (!value("brand") || !value("model")) {
              setError(t("required"));
              return;
            }
            const now = new Date().toISOString();
            const next: Pipe = {
              ...pipe,
              id: pipe?.id || crypto.randomUUID(),
              brand: value("brand"),
              model: value("model"),
              shape: value("shape"),
              material: value("material"),
              filter: value("filter"),
              status: value("status"),
              date: value("date"),
              price: value("price") === "" ? null : Number(value("price")),
              notes: value("notes"),
              photo,
              createdAt: pipe?.createdAt || now,
              updatedAt: now,
            };
            if (!onSave(next)) setError(t("storageWrite"));
          }}
        >
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
              <label htmlFor="pic">{t("fields.photo")}</label>
              <button
                type="button"
                className="filebutton"
                onClick={() => file.current?.click()}
              >
                {t("choosePhoto")}
              </button>
              <input
                className="fileinput"
                ref={file}
                id="pic"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (
                    !["image/jpeg", "image/png", "image/webp"].includes(
                      f.type,
                    ) ||
                    f.size > 3 * 1024 * 1024
                  ) {
                    setError(t("photoInvalid"));
                    e.target.value = "";
                    return;
                  }
                  setLoading(true);
                  setError("");
                  try {
                    const result = await new Promise<string>(
                      (resolve, reject) => {
                        const r = new FileReader();
                        r.onload = () => resolve(String(r.result));
                        r.onerror = reject;
                        r.readAsDataURL(f);
                      },
                    );
                    setPhoto(result);
                  } catch {
                    setError(t("photoRead"));
                  } finally {
                    setLoading(false);
                  }
                }}
              />
              {photo && (
                <>
                  <img className="preview" src={photo} alt={t("preview")} />
                  <button
                    type="button"
                    className="smallbtn"
                    onClick={() => {
                      setPhoto(null);
                      if (file.current) file.current.value = "";
                    }}
                  >
                    {t("removePhoto")}
                  </button>
                </>
              )}
              {loading && <p role="status">{t("photoLoading")}</p>}
            </div>
          </div>
          {error && (
            <p className="formerror" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            {pipe && (
              <button
                type="button"
                className="btn danger"
                onClick={() => onDelete(pipe)}
              >
                {t("delete")}
              </button>
            )}
            <div className="right">
              <button type="button" className="btn secondary" onClick={onClose}>
                {t("cancel")}
              </button>
              <button type="submit" className="btn" disabled={loading}>
                {t("save")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
