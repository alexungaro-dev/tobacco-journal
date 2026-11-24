import type {
  Catalogue,
  CatalogueItem,
  ProductKind,
  Session,
} from "./smokingJournal";

export const productKinds = ["pipe", "tobacco", "cigar"] as const;
export const catalogueRoute = {
  pipe: "#pipes",
  tobacco: "#tobaccos",
  cigar: "#cigars",
} as const;
export function catalogueItemRoute(kind: ProductKind, id: string) {
  return `${catalogueRoute[kind]}/item/${encodeURIComponent(id)}`;
}

export const chartPeriods = ["days", "year", "all"] as const;
export type ChartPeriod = (typeof chartPeriods)[number];
export type SummarySession = Pick<
  Session,
  "id" | "kind" | "startedAt" | "rating" | "product" | "pipe"
>;
export type ChartBucket = {
  start: Date;
  end: Date;
  pipe: number;
  cigar: number;
};

export function collectionSummary(catalogue: Catalogue) {
  const counts = {
    pipe: catalogue.pipe.length,
    tobacco: catalogue.tobacco.length,
    cigar: catalogue.cigar.length,
  };
  let latest:
    | { kind: ProductKind; item: CatalogueItem; timestamp: number }
    | undefined;
  for (const kind of productKinds) {
    for (const item of catalogue[kind]) {
      const timestamp = item.createdAt ? Date.parse(item.createdAt) : NaN;
      if (
        Number.isFinite(timestamp) &&
        (!latest || timestamp > latest.timestamp)
      )
        latest = { kind, item, timestamp };
    }
  }
  return { counts, latest };
}

function uniqueDated(sessions: readonly SummarySession[]) {
  const seen = new Set<string>();
  return sessions.flatMap((session) => {
    const timestamp = Date.parse(session.startedAt);
    if (!Number.isFinite(timestamp) || seen.has(session.id)) return [];
    seen.add(session.id);
    return [{ session, timestamp }];
  });
}

export function recentSessions(sessions: readonly SummarySession[]) {
  return uniqueDated(sessions)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3)
    .map(({ session }) => session);
}

const DAY_MS = 86400000;
const PAGE_MONTHS = 12;
const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();
function monthDate(index: number) {
  const date = new Date(0);
  date.setFullYear(Math.floor(index / 12), index % 12, 1);
  date.setHours(0, 0, 0, 0);
  return date;
}
function dayIndex(date: Date) {
  const day = new Date(0);
  day.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return day.getTime() / DAY_MS;
}

export function chartPage(
  sessions: readonly SummarySession[],
  period: ChartPeriod,
  now: Date,
  offset = 0,
) {
  const dated = uniqueDated(sessions).filter(
    ({ timestamp }) => period === "all" || timestamp <= now.getTime(),
  );
  const counts = new Map<number, { pipe: number; cigar: number }>();
  const buckets: ChartBucket[] = [];
  const month = monthIndex(now);
  let oldest = Infinity;
  // Track the actual history span separately from today's date.
  let newest = -Infinity;
  for (const { session, timestamp } of dated) {
    const index =
      period === "days"
        ? dayIndex(new Date(timestamp))
        : monthIndex(new Date(timestamp));
    const count = counts.get(index) ?? { pipe: 0, cigar: 0 };
    count[session.kind]++;
    counts.set(index, count);
    if (period === "all") {
      oldest = Math.min(oldest, index);
      newest = Math.max(newest, index);
    }
  }
  if (!Number.isFinite(oldest)) oldest = newest = month;
  const pages =
    period === "all" ? Math.ceil((newest - oldest + 1) / PAGE_MONTHS) : 1;
  const page = Math.max(0, Math.min(offset, pages - 1));
  if (period === "days") {
    const today = dayIndex(now);
    for (let step = -29; step <= 0; step += 7) {
      const last = Math.min(0, step + 6);
      const start = new Date(now);
      start.setDate(start.getDate() + step);
      const end = new Date(now);
      end.setDate(end.getDate() + last);
      const bucket = { start, end, pipe: 0, cigar: 0 };
      for (let day = step; day <= last; day++) {
        bucket.pipe += counts.get(today + day)?.pipe ?? 0;
        bucket.cigar += counts.get(today + day)?.cigar ?? 0;
      }
      buckets.push(bucket);
    }
  } else {
    const last = (period === "all" ? newest : month) - page * PAGE_MONTHS;
    const first =
      period === "all"
        ? Math.max(oldest, last - PAGE_MONTHS + 1)
        : last - PAGE_MONTHS + 1;
    for (let index = first; index <= last; index++) {
      const start = monthDate(index);
      buckets.push({
        start,
        end: start,
        ...(counts.get(index) ?? { pipe: 0, cigar: 0 }),
      });
    }
  }
  return { buckets, pages, page };
}
