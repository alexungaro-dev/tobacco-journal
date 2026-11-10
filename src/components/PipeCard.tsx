import { useTranslation } from "react-i18next";
import type { Pipe } from "../types";
export function PipeCard({
  pipe: p,
  onEdit,
}: {
  pipe: Pipe;
  onEdit: () => void;
}) {
  const { t, i18n } = useTranslation();
  const date =
    p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
      ? new Date(p.date + "T00:00:00")
      : null;
  const validDate = date && !Number.isNaN(date.getTime());
  return (
    <article className="card">
      <div className="photo">
        {p.photo ? (
          <img
            src={p.photo}
            alt={t("photoAlt", { name: `${p.brand} ${p.model}` })}
          />
        ) : (
          <span className="silhouette" aria-hidden="true">
            ♧
          </span>
        )}
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
            {t(`statuses.${p.status || "in_use"}`, {
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
