import { useTranslation } from "react-i18next";
import type { ProductKind, Snapshot } from "../data/smokingJournal";

export function JournalProvenance({
  kind,
  snapshot,
}: {
  kind: ProductKind;
  snapshot: Snapshot;
}) {
  const { t } = useTranslation();
  if (
    snapshot.source === "owned" ||
    (!snapshot.brand &&
      !snapshot.name &&
      !snapshot.detail &&
      !snapshot.catalogueId)
  )
    return null;
  const key = snapshot.source === "gift" ? `${kind}.gift` : "other";
  return (
    <span className="journal-provenance">{t("diary.provenance." + key)}</span>
  );
}

export const snapshotLabel = (item: Snapshot) =>
  [item.brand, item.name].filter(Boolean).join(" ");
