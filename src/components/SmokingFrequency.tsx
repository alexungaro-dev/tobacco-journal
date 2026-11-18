import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  chartPage,
  chartPeriods,
  type ChartPeriod,
  type SummarySession,
} from "../data/dashboard";

export function SmokingFrequency({ sessions }: { sessions: SummarySession[] }) {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<ChartPeriod>("days");
  const [offset, setOffset] = useState(0);
  const { buckets, pages, page } = chartPage(
    sessions,
    period,
    new Date(),
    offset,
  );
  const maximum = Math.max(
    1,
    ...buckets.flatMap(({ pipe, cigar }) => [pipe, cigar]),
  );
  const hasData = buckets.some(({ pipe, cigar }) => pipe || cigar);
  const format = new Intl.DateTimeFormat(
    i18n.language,
    period === "days"
      ? { day: "numeric", month: "short" }
      : { month: "short", year: "numeric" },
  );

  return (
    <section className="dashboard-panel" aria-labelledby="dashboard-frequency">
      <div className="dashboard-section-header">
        <h2 id="dashboard-frequency">{t("dashboard.frequency")}</h2>
        <select
          aria-label={t("dashboard.period")}
          value={period}
          onChange={(event) => {
            setPeriod(event.target.value as ChartPeriod);
            setOffset(0);
          }}
        >
          {chartPeriods.map((value) => (
            <option key={value} value={value}>
              {t("dashboard.periods." + value)}
            </option>
          ))}
        </select>
      </div>
      {pages > 1 && (
        <div className="dashboard-chart-pages">
          <button
            type="button"
            className="btn secondary"
            disabled={page === pages - 1}
            onClick={() => setOffset(page + 1)}
          >
            {t("dashboard.older")}
          </button>
          <span>{t("dashboard.page", { page: page + 1, pages })}</span>
          <button
            type="button"
            className="btn secondary"
            disabled={page === 0}
            onClick={() => setOffset(page - 1)}
          >
            {t("dashboard.newer")}
          </button>
        </div>
      )}
      {hasData ? (
        <table className="dashboard-chart">
          <thead>
            <tr>
              <th scope="col">{t("dashboard.period")}</th>
              <th scope="col">{t("diary.entity.pipe")}</th>
              <th scope="col">{t("diary.entity.cigar")}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map(({ start, end, pipe, cigar }) => (
              <tr key={start.toISOString()}>
                <th scope="row">
                  {format.format(start)}
                  {start.getTime() !== end.getTime()
                    ? ` – ${format.format(end)}`
                    : ""}
                </th>
                {(
                  [
                    ["pipe", pipe],
                    ["cigar", cigar],
                  ] as const
                ).map(([kind, count]) => (
                  <td key={kind}>
                    <span className="dashboard-chart-value">
                      <span
                        className="dashboard-chart-track"
                        aria-hidden="true"
                      >
                        <span
                          className={`dashboard-bar dashboard-bar-${kind}`}
                          style={{ width: `${(count / maximum) * 100}%` }}
                        />
                      </span>
                      <span>{count}</span>
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="meta">{t("dashboard.emptyPeriod")}</p>
      )}
    </section>
  );
}
