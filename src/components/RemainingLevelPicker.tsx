import { useTranslation } from "react-i18next";
import { remainingLevels, type RemainingLevel } from "../data/tobaccos";

export function FillIndicator({ level }: { level: RemainingLevel }) {
  return (
    <span
      className="tobacco-fill-indicator"
      data-level={level}
      aria-hidden="true"
    />
  );
}

export function RemainingLevelPicker({
  initial,
}: {
  initial: RemainingLevel | null;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="field full tobacco-level-picker">
      <legend>{t("tobaccos.fields.remainingLevel")}</legend>
      <div className="tobacco-level-options">
        {[null, ...remainingLevels].map((level) => (
          <label key={level ?? "unspecified"}>
            <input
              type="radio"
              name="remainingLevel"
              value={level ?? ""}
              defaultChecked={initial === level}
            />
            <span className="tobacco-level-choice">
              {level && <FillIndicator level={level} />}
              {t("tobaccos.levels." + (level ?? "unspecified"))}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
