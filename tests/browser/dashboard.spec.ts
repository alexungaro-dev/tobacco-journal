import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  cigarRow,
  cloudMock,
  journalRow,
  OWNER_A,
  OWNER_B,
  PHOTO,
  row,
  signIn,
  tobaccoRow,
} from "./cloudMock";

const dash = (page: Page) => page.locator(".dashboard");
const recent = (page: Page) =>
  dash(page).getByRole("region", { name: "Ultime fumate" });
const latest = (page: Page) =>
  dash(page).getByRole("region", { name: "Ultimo prodotto aggiunto" });

test("dashboard is the default and links correct counts, recent details and the latest product", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const gift = journalRow(OWNER_A, "gift/slash", "Sigaro di Luca");
  gift.extra.product = {
    source: "gift",
    brand: "Amico",
    name: "Sigaro di Luca",
    offeredBy: "Luca",
  };
  gift.started_at = "2026-11-18T12:00:00Z";
  gift.rating = 4;
  const borrowed = journalRow(OWNER_A, "borrowed", "Virginia");
  borrowed.kind = "pipe";
  borrowed.started_at = "2026-11-17T19:00:00Z";
  borrowed.extra.pipe = { source: "gift", brand: "Amico", name: "Bent" };
  const older = {
    ...journalRow(OWNER_A, "older", "Terza"),
    started_at: "2026-11-16T19:00:00Z",
  };
  const oldest = {
    ...journalRow(OWNER_A, "oldest", "Quarta"),
    started_at: "2018-11-18T19:00:00Z",
    created_at: "2026-11-18T23:00:00Z",
  };
  const bytes = Buffer.from(PHOTO.split(",")[1], "base64");
  const path = OWNER_A + "/cigar-photos/" + "a".repeat(64);
  const newest = {
    ...cigarRow(OWNER_A, "latest", "Nuovo"),
    created_at: "2026-11-17T19:00:00Z",
  };
  newest.extra = {
    remaining: 40,
    cataloguePhoto: {
      path,
      mime: "image/png",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
  const pipe = {
    ...row(),
    created_at: "2026-10-15T19:00:00Z",
    updated_at: "2026-11-18T20:00:00Z",
  };
  const api = await cloudMock(
    page,
    [pipe],
    [tobaccoRow()],
    [newest, cigarRow()],
    [older, oldest, borrowed, gift],
  );
  api.objects.set(path, { bytes, type: "image/png" });
  api.media.push({
    user_id: OWNER_A,
    cigar_id: newest.id,
    bucket_id: "journal-photos",
    object_path: path,
    mime_type: "image/png",
    size_bytes: bytes.length,
  });
  await page.goto("/");
  await expect(
    page.getByText("Accedi per visualizzare la tua dashboard personale."),
  ).toBeVisible();
  expect(
    api.requests.some((request) =>
      request.path.includes("/rest/v1/smoking_sessions"),
    ),
  ).toBe(false);
  await signIn(page);
  await expect(
    dash(page).getByRole("heading", { name: "Dashboard" }),
  ).toBeVisible();
  await expect(
    dash(page).getByRole("link", { name: "1 Pipe" }),
  ).toHaveAttribute("href", "#pipes");
  await expect(
    dash(page).getByRole("link", { name: "1 Tabacchi" }),
  ).toHaveAttribute("href", "#tobaccos");
  await expect(
    dash(page).getByRole("link", { name: "2 Tipologie di sigari" }),
  ).toHaveAttribute("href", "#cigars");
  const sessions = recent(page).getByRole("link");
  await expect(sessions).toHaveCount(3);
  await expect(sessions.nth(0)).toContainText("Sigaro offerto");
  await expect(sessions.nth(0)).toContainText("4/5");
  await expect(sessions.nth(1)).toContainText("Pipa prestata");
  await expect(sessions.nth(2)).toContainText("Terza");
  await expect(latest(page)).toContainText("Example Nuovo");
  await latest(page).locator(".photo").scrollIntoViewIfNeeded();
  await expect(latest(page).locator("img")).toHaveAttribute("src", /^blob:/);
  expect(
    api.requests.filter(({ path, method }) => method === "GET" && path.startsWith("/storage/")).length,
  ).toBe(1);
  expect(
    await dash(page).evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await sessions.nth(0).click();
  await expect(page).toHaveURL(/#diary\/session\/gift%2Fslash$/);
  const opened = page.locator(".card").filter({ hasText: "Sigaro di Luca" });
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(opened.getByText("Offerto da: Luca")).toBeVisible();
  await page.getByRole("link", { name: "Apri Diario" }).click();
  await expect(page.locator(".card")).toHaveCount(4);
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await dash(page).getByRole("link", { name: "2 Tipologie di sigari" }).click();
  await expect(page).toHaveURL(/#cigars$/);
});

test("quick registration reuses the catalogue and dashboard refreshes the session and stock", async ({
  page,
}) => {
  const cigar = cigarRow();
  cigar.extra.remaining = 4;
  const api = await cloudMock(page, [], [], [cigar]);
  await page.goto("/");
  await signIn(page);
  await expect(
    dash(page).getByRole("link", { name: "Registra la prima fumata" }),
  ).toBeVisible();
  await expect(
    dash(page).getByRole("region", { name: "Avvisi di scorta" }),
  ).toHaveCount(0);
  const catalogueRequests = () =>
    api.requests.filter(
      ({ path }) =>
        /^\/rest\/v1\/(tobaccos|cigars|pipes)\?/.test(path) &&
        !new URL("https://test" + path).searchParams
          .get("id")
          ?.startsWith("eq."),
    ).length;
  const before = catalogueRequests();
  await dash(page).getByRole("link", { name: "Nuova fumata" }).click();
  const editor = page.locator(".journal-editor");
  await expect(editor).toBeVisible();
  expect(catalogueRequests()).toBe(before);
  await editor.getByLabel("Tipo di fumata").selectOption("cigar");
  await editor
    .getByLabel("Scegli dal catalogo · Prodotto fumato")
    .selectOption("c1");
  await editor.getByRole("button", { name: "Salva fumata" }).click();
  await expect(
    page.getByText("Fumata salvata.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(
    recent(page).getByRole("link", { name: /Example Reserva/ }),
  ).toBeVisible();
  await expect(
    dash(page).getByRole("region", { name: "Avvisi di scorta" }),
  ).toContainText("Scorta bassa");
});

test("account preferences control dashboard alert visibility and isolated chart history", async ({
  page,
}) => {
  const a = cigarRow(OWNER_A, "a", "Above default");
  a.extra.remaining = 5;
  const b = cigarRow(OWNER_B, "b", "Other");
  b.extra.remaining = 0;
  const tobacco = tobaccoRow(OWNER_A, "low", "Low blend");
  tobacco.extra.remainingLevel = "almostEmpty";
  const historic = {
    ...journalRow(OWNER_A, "old", "Old"),
    started_at: "2016-02-01T19:00:00Z",
  };
  const current = {
    ...journalRow(OWNER_A, "recent", "Current"),
    started_at: new Date(Date.now() - 86400000).toISOString(),
  };
  const api = await cloudMock(
    page,
    [],
    [tobacco],
    [a, b],
    [historic, current, journalRow(OWNER_B, "b", "Foreign session")],
  );
  api.stockPreferences.set(OWNER_A, {
    stock_alerts_enabled: true,
    cigar_low_stock_threshold: 5,
  });
  api.stockPreferences.set(OWNER_B, {
    stock_alerts_enabled: false,
    cigar_low_stock_threshold: 10,
  });
  await page.goto("/");
  await signIn(page);
  const alerts = dash(page).getByRole("region", { name: "Avvisi di scorta" });
  await expect(alerts).toContainText("Above default");
  await expect(alerts).toContainText("Low blend");
  await expect(alerts.getByRole("link", { name: /Low blend/ })).toHaveAttribute(
    "href",
    "#tobaccos/item/low",
  );
  await expect(dash(page).getByText("Foreign session")).toHaveCount(0);
  const chart = dash(page).getByRole("region", {
    name: "Frequenza delle fumate",
  });
  await expect(chart.locator("tbody tr")).toHaveCount(5);
  await chart.getByLabel("Periodo").selectOption("year");
  await expect(chart.locator("tbody tr")).toHaveCount(12);
  await chart.getByLabel("Periodo").selectOption("all");
  await expect(
    chart.getByRole("button", { name: "Periodi precedenti" }),
  ).toBeEnabled();
  await chart.getByRole("button", { name: "Periodi precedenti" }).click();
  await expect(
    chart.getByText("Nessuna fumata in questo periodo."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await signIn(page, "other@example.test");
  await expect(recent(page)).toContainText("Foreign session");
  await expect(recent(page).getByText("Guest Current")).toHaveCount(0);
  await expect(alerts).toHaveCount(0);
});
