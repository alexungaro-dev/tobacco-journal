import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../auth/client";
import {
  catalogueRoute,
  catalogueItemRoute,
  collectionSummary,
  productKinds,
  recentSessions,
  type SummarySession,
} from "../data/dashboard";
import { cloudErrorKey } from "../data/pipeMapping";
import { SmokingJournal, type Catalogue } from "../data/smokingJournal";
import { cigarStockAlert, tobaccoStockAlert } from "../data/stockAlerts";
import { JournalProvenance, snapshotLabel } from "./JournalProvenance";
import { PipePhoto } from "./PipePhoto";
import { SmokingFrequency } from "./SmokingFrequency";
import { StockAlertBadge, useStockAlertPreferences } from "./StockAlerts";

type LatestPhoto = Awaited<ReturnType<SmokingJournal["cataloguePhoto"]>>;

export function DashboardView({
  owner,
  onSessionLost,
  rememberCatalogue,
}: {
  owner: string;
  onSessionLost: () => void;
  rememberCatalogue: (owner: string, data: Catalogue) => void;
}) {
  const { t, i18n } = useTranslation();
  const preferences = useStockAlertPreferences();
  const invalidate = useRef(onSessionLost);
  invalidate.current = onSessionLost;
  const [snapshot, setSnapshot] = useState<{
    catalogue: Catalogue;
    sessions: SummarySession[];
  }>();
  const [photo, setPhoto] = useState<LatestPhoto>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const service = new SmokingJournal(supabase!, owner, signal);
    void (async () => {
      try {
        const [catalogue, sessions] = await Promise.all([
          service.catalogue(),
          service.summaries(),
        ]);
        if (signal.aborted) return;
        setSnapshot({ catalogue, sessions });
        rememberCatalogue(owner, catalogue);
        const { latest } = collectionSummary(catalogue);
        if (latest) {
          try {
            const result = await service.cataloguePhoto(
              latest.kind,
              latest.item.id,
            );
            if (!signal.aborted) setPhoto(result);
          } catch (failure) {
            // The collection overview remains usable if its single photo is unavailable.
            if (
              !signal.aborted &&
              cloudErrorKey(failure) === "cloud.errors.session"
            )
              invalidate.current();
          }
        }
      } catch (failure) {
        if (signal.aborted) return;
        const key = cloudErrorKey(failure);
        if (key === "cloud.errors.session") invalidate.current();
        else setError(key === "cloud.errors.network" ? "cloud.readError" : key);
      }
    })();
    return () => controller.abort();
  }, [owner, attempt, rememberCatalogue]);

  const summary = snapshot && collectionSummary(snapshot.catalogue);
  const latest = summary?.latest;
  const recent = snapshot ? recentSessions(snapshot.sessions) : [];
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const sessionDate = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const tobaccoAlerts =
    preferences?.enabled && snapshot
      ? snapshot.catalogue.tobacco.filter((item) =>
          tobaccoStockAlert(item.remainingLevel),
        )
      : [];
  const cigarAlerts =
    preferences?.enabled && snapshot
      ? snapshot.catalogue.cigar.filter((item) =>
          cigarStockAlert(item.remaining, preferences.threshold),
        )
      : [];

  return (
    <div className="dashboard">
      <section className="intro">
        <h1>{t("dashboard.title")}</h1>
        <div className="dashboard-actions">
          <a className="btn" href="#diary/new">
            {t("dashboard.newSession")}
          </a>
          <a className="btn secondary" href="#diary">
            {t("dashboard.openDiary")}
          </a>
        </div>
      </section>
      {error && (
        <div className="notice" role="alert">
          <p>{t(error)}</p>
          <button
            className="btn secondary"
            onClick={() => {
              setError("");
              setAttempt((value) => value + 1);
            }}
          >
            {t("cloud.retry")}
          </button>
        </div>
      )}
      {!error && !snapshot && <p role="status">{t("dashboard.loading")}</p>}
      {snapshot && summary && (
        <>
          <section aria-labelledby="dashboard-collection">
            <h2 id="dashboard-collection">{t("dashboard.collection")}</h2>
            <div className="dashboard-counts">
              {productKinds.map((kind) => (
                <a
                  className="dashboard-tile"
                  href={catalogueRoute[kind]}
                  key={kind}
                >
                  <strong>{summary.counts[kind]}</strong>
                  <span>{t("dashboard.counts." + kind)}</span>
                </a>
              ))}
            </div>
          </section>
          <div className="dashboard-grid">
            <section
              className="dashboard-panel"
              aria-labelledby="dashboard-recent"
            >
              <h2 id="dashboard-recent">{t("dashboard.recent")}</h2>
              {recent.length ? (
                <ul className="dashboard-list">
                  {recent.map((item) => (
                    <li key={item.id}>
                      <a
                        className="dashboard-item"
                        href={`#diary/session/${encodeURIComponent(item.id)}`}
                      >
                        <span className="dashboard-item-line">
                          <strong>
                            {snapshotLabel(item.product) ||
                              t("diary.historical")}
                          </strong>
                          <JournalProvenance
                            kind={item.kind === "pipe" ? "tobacco" : "cigar"}
                            snapshot={item.product}
                          />
                        </span>
                        {item.pipe && (
                          <span className="dashboard-item-line">
                            <span>
                              {t("diary.entity.pipe")}:{" "}
                              {snapshotLabel(item.pipe) ||
                                t("diary.historical")}
                            </span>
                            <JournalProvenance
                              kind="pipe"
                              snapshot={item.pipe}
                            />
                          </span>
                        )}
                        <span className="dashboard-item-line meta">
                          <time dateTime={item.startedAt}>
                            {sessionDate.format(new Date(item.startedAt))}
                          </time>
                          {item.rating !== null && (
                            <span className="dashboard-stars">
                              <span aria-hidden="true">
                                {"★".repeat(item.rating)}
                              </span>
                              <span>{item.rating}/5</span>
                            </span>
                          )}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <div>
                  <p className="meta">{t("diary.empty")}</p>
                  <a className="link" href="#diary/new">
                    {t("dashboard.firstSession")}
                  </a>
                </div>
              )}
            </section>
            <SmokingFrequency sessions={snapshot.sessions} />
            {(cigarAlerts.length > 0 || tobaccoAlerts.length > 0) && (
              <section
                className="dashboard-panel"
                aria-labelledby="dashboard-stock"
              >
                <h2 id="dashboard-stock">{t("stockAlerts.settings")}</h2>
                <ul className="dashboard-list">
                  {tobaccoAlerts.map((item) => (
                    <li key={"tobacco/" + item.id}>
                      <a className="dashboard-item" href={catalogueItemRoute("tobacco", item.id)}>
                        <span className="dashboard-item-line">
                          <strong>
                            {item.brand} {item.name}
                          </strong>
                          <StockAlertBadge
                            kind="tobacco"
                            remainingLevel={item.remainingLevel}
                          />
                        </span>
                        <span className="meta">
                          {t("diary.entity.tobacco")}
                        </span>
                      </a>
                    </li>
                  ))}
                  {cigarAlerts.map((item) => (
                    <li key={"cigar/" + item.id}>
                      <a className="dashboard-item" href={catalogueItemRoute("cigar", item.id)}>
                        <span className="dashboard-item-line">
                          <strong>
                            {item.brand} {item.name}
                          </strong>
                          <StockAlertBadge
                            kind="cigar"
                            remaining={item.remaining}
                          />
                        </span>
                        <span className="meta">{t("diary.entity.cigar")}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {latest && (
              <section
                className="dashboard-panel"
                aria-labelledby="dashboard-latest"
              >
                <h2 id="dashboard-latest">{t("dashboard.latest")}</h2>
                <a
                  className="dashboard-item dashboard-latest"
                  href={catalogueItemRoute(latest.kind, latest.item.id)}
                >
                  {photo &&
                    (photo.ref || photo.legacy) &&
                    photo.ref !== null && (
                      <div className="photo">
                        <PipePhoto
                          id={latest.item.id}
                          alt={t("photoAlt", { name: latest.item.name })}
                          legacy={photo.legacy}
                          photo={{
                            ref: photo.ref,
                            read: photo.read,
                            damaged: false,
                          }}
                        />
                      </div>
                    )}
                  <span className="dashboard-item-line">
                    <span className="meta">
                      {t("diary.entity." + latest.kind)}
                    </span>
                    <strong>
                      {[latest.item.brand, latest.item.name]
                        .filter(Boolean)
                        .join(" ")}
                    </strong>
                  </span>
                  <time
                    className="meta"
                    dateTime={new Date(latest.timestamp).toISOString()}
                  >
                    {date.format(latest.timestamp)}
                  </time>
                </a>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
