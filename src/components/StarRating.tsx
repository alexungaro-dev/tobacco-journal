import { useId } from "react";
import { useTranslation } from "react-i18next";

type Stars = 1 | 2 | 3 | 4 | 5;
const scores = [1, 2, 3, 4, 5] as const;

export function StarRating({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: Stars | null) => void;
}) {
  const { t } = useTranslation();
  const summaryId = useId();
  return (
    <fieldset className="field full star-rating" aria-describedby={summaryId}>
      <legend>{label}</legend>
      <div className="star-rating-buttons">
        {scores.map((score) => (
          <button
            key={score}
            type="button"
            aria-label={t("starRating.option", { score })}
            aria-pressed={value === score}
            data-filled={value !== null && score <= value}
            onClick={() => onChange(value === score ? null : score)}
          >
            <span aria-hidden="true">
              {value !== null && score <= value ? "★" : "☆"}
            </span>
          </button>
        ))}
      </div>
      <p id={summaryId} className="star-rating-summary" role="status">
        {value ?? 0}/5 · {t(`starRating.description.${value ?? 0}`)}
      </p>
    </fieldset>
  );
}
