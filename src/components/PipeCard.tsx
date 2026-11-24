import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { PipePhoto, type PrivatePhoto } from "./PipePhoto";
import type { Pipe } from "../types";
import { displayPipeStatus } from "../data/pipeMapping";
export function PipeCard({
  pipe: p,
  onEdit,
  photo,
  targetRef,
}: {
  pipe: Pipe;
  photo: PrivatePhoto;
  targetRef?: Ref<HTMLElement>;
  onEdit: () => void;
}) {
  const { t, i18n } = useTranslation();
  const date =
    p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
      ? new Date(p.date + "T00:00:00")
      : null;
  const validDate = date && !Number.isNaN(date.getTime());
  return (
    <article
      className="card"
      ref={targetRef}
      tabIndex={targetRef ? -1 : undefined}
      aria-label={targetRef ? `${p.brand} ${p.model}` : undefined}
    >
      <div className="photo">
        <PipePhoto
          id={p.id}
          legacy={p.photo}
          photo={photo}
          alt={t("photoAlt", { name: `${p.brand} ${p.model}` })}
        />
      </div>
      <div className="info">
        <h3 className="name">
          {p.brand} {p.model}
        </h3>
        <div className="meta">
          {p.shape || t("shapeMissing")} ·{" "}
          {p.filter
            ? t(`filters.${p.filter}`, { defaultValue: p.filter })
            : t("filterMissing")}
        </div>
        {(validDate || p.price != null) && (
          <div className="details">
            {validDate && (
              <span>
                {t("fields.date")}:{" "}
                {new Intl.DateTimeFormat(i18n.language).format(date)}
              </span>
            )}
            {validDate && p.price != null ? " · " : ""}
            {p.price != null && (
              <span>
                {new Intl.NumberFormat(i18n.language, {
                  style: "currency",
                  currency: "EUR",
                }).format(p.price)}
              </span>
            )}
          </div>
        )}
        <div className="cardbottom">
          <span className="pill">
            {t(`statuses.${displayPipeStatus(p.status)}`, {
              defaultValue: t("unknownStatus", { value: p.status }),
            })}
          </span>
          <button className="link" onClick={onEdit}>
            {t("edit")}
          </button>
        </div>
      </div>
    </article>
  );
}
