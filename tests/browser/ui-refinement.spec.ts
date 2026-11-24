import { expect, test } from "@playwright/test";
import {
  AUTH_ORIGIN,
  cigarRow,
  cloudMock,
  journalRow,
  LEGACY,
  OWNER_A,
  OWNER_B,
  row,
  signIn,
  tobaccoRow,
} from "./cloudMock";

test("journal editor scrolls into view and restores focus after cancel or deletion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sessions = Array.from({ length: 12 }, (_, index) =>
    journalRow(OWNER_A, String(index).padStart(2, "0"), "Session " + index),
  );
  await cloudMock(page, [], [], [], sessions);
  await page.goto("/#diary");
  await signIn(page);

  const trigger = page.locator(".card").last().getByRole("button", { name: "Modifica fumata" });
  const editor = page.locator(".journal-editor");
  const heading = editor.getByRole("heading", { name: "Modifica fumata" });
  await trigger.click();
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await editor.getByRole("button", { name: "Annulla" }).click();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("searchbox", { name: "Cerca nel diario" }).fill("No matching card");
  await editor.getByRole("button", { name: "Annulla" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.getByRole("button", { name: "Azzera filtri" }).click();

  await trigger.click();
  page.once("dialog", (dialog) => dialog.accept());
  await editor.getByRole("button", { name: "Elimina" }).click();
  await expect(page.locator(".card")).toHaveCount(11);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

  await page.goto("/#diary/new");
  await expect(editor.getByRole("heading")).toBeFocused();
  await editor.getByRole("button", { name: "Annulla" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});

test("tobacco and cigar editors return focus to the edited card", async ({ page }) => {
  await cloudMock(page, [], [tobaccoRow()], [cigarRow()]);
  await page.goto("/#tobaccos");
  await signIn(page);

  for (const [module, title] of [
    ["Tabacchi", "Modifica tabacco"],
    ["Sigari", "Modifica sigaro"],
  ]) {
    await page.getByRole("navigation").getByRole("button", { name: module }).click();
    const trigger = page.locator(".card").getByRole("button", { name: "Visualizza / Modifica →" });
    await trigger.click();
    await expect(page.getByRole("heading", { name: title })).toBeFocused();
    await page.getByRole("button", { name: "Annulla", exact: true }).click();
    await expect(trigger).toBeFocused();
  }
});

test("read failures can be retried and a failed save and rejected reload keep the draft", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await cloudMock(page, [], [], [cigarRow()]);
  let failReading = true;
  await page.route(
    (url) => url.origin === AUTH_ORIGIN && url.pathname === "/rest/v1/cigars",
    (route) => {
      if (failReading || route.request().method() === "POST")
        return route.fulfill({ status: 400, json: { code: "XX000" } });
      return route.fallback();
    },
  );
  await page.goto("/#cigars");
  await signIn(page);
  await expect(page.getByRole("alert")).toHaveText(/Impossibile caricare i dati/);
  await expect(page.locator(".empty")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aggiungi sigaro" })).toBeDisabled();

  failReading = false;
  await page.getByRole("button", { name: "Riprova", exact: true }).click();
  await expect(page.locator(".card")).toHaveCount(1);

  await page.getByRole("button", { name: "Aggiungi sigaro" }).click();
  const editor = page.getByRole("form", { name: "Aggiungi sigaro" });
  await editor.locator('[name="brand"]').fill("Draft brand");
  await editor.locator('[name="name"]').fill("Draft name");
  await editor.getByRole("button", { name: "Salva sigaro" }).click();
  const error = editor.getByRole("alert");
  await expect(error).toContainText("Operazione cloud non verificata");
  await expect(error).toBeInViewport();
  expect(api.cigars).toHaveLength(1);

  const reads = api.requests.length;
  let confirmation = "";
  page.once("dialog", async (dialog) => {
    confirmation = dialog.message();
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Ricarica dal cloud" }).click();
  expect(confirmation).toContain("modifiche non salvate");
  await expect(editor.locator('[name="name"]')).toHaveValue("Draft name");
  expect(api.requests).toHaveLength(reads);
});

test("navigation fits at 320 and 390 px in IT and EN and journal filters stay compact", async ({ page }) => {
  const cigar = journalRow(OWNER_A, "c1", "Featured");
  cigar.rating = 4;
  await cloudMock(page, [], [], [], [cigar, journalRow(OWNER_A, "c2", "Unrated")]);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  const language = page.locator(".language");
  const nav = page.getByRole("navigation");

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [value, diary] of [["it", "Diario"], ["en", "Smoking diary"]]) {
      await language.selectOption(value);
      const link = nav.getByRole("button", { name: diary, exact: true });
      await expect(link).toBeVisible();
      expect(await nav.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(width - 32);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await link.click();
      await expect(link).toHaveAttribute("aria-current", "page");
    }
  }

  await language.selectOption("it");
  await signIn(page);
  const filters = page.locator(".journal-filters");
  const search = filters.getByRole("searchbox");
  const type = filters.getByLabel("Tipo di fumata");
  const summary = filters.locator("summary");
  const rating = filters.getByLabel("Valutazione");
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(search).toBeVisible();
  await expect(type).toBeVisible();
  await expect(rating).toBeHidden();
  await summary.click();
  await search.fill("Featured");
  await type.selectOption("cigar");
  await rating.selectOption("4");
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(summary).toContainText("1 attivo");
  await summary.click();
  await filters.getByRole("button", { name: "Azzera filtri" }).click();
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(search).toHaveValue("");
  await expect(type).toHaveValue("");
  await expect(summary).toHaveText("Altri filtri");
});

test("legacy pipes with missing status match In use and long names wrap", async ({ page }) => {
  const longName = "L".repeat(100);
  const legacy = row(OWNER_A, { ...LEGACY, status: undefined });
  const api = await cloudMock(page, [legacy], [], [cigarRow(OWNER_A, "long", longName)]);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/#pipes");
  await signIn(page);
  await expect(page.locator(".card .pill")).toHaveText("In uso");
  await page.getByLabel("Stato", { exact: true }).selectOption("in_use");
  await expect(page.locator(".card")).toHaveCount(1);
  expect(api.rows[0].status).toBeNull();

  await page.getByRole("navigation").getByRole("button", { name: "Sigari" }).click();
  const title = page.locator(".card .name");
  await expect(title).toContainText(longName);
  expect(await title.evaluate((element) => element.scrollWidth)).toBe(
    await title.evaluate((element) => element.clientWidth),
  );
});

test("dashboard links open the exact product and direct routes preserve filters and history", async ({ page }) => {
  const id = "featured/2026 & more";
  const cigar = cigarRow(OWNER_A, id, "Featured");
  cigar.created_at = "2026-11-24T00:00:00.000Z";
  cigar.extra.remaining = 2;
  const tobacco = tobaccoRow(OWNER_A, "blend", "Low blend");
  tobacco.extra.remainingLevel = "almostEmpty";
  const route = "#cigars/item/" + encodeURIComponent(id);
  await cloudMock(page, [], [tobacco], [cigar, cigarRow()], []);
  await page.goto("/");
  await signIn(page);

  const dashboard = page.locator(".dashboard");
  const latest = dashboard.getByRole("region", { name: "Ultimo prodotto aggiunto" }).getByRole("link");
  const alerts = dashboard.getByRole("region", { name: "Avvisi di scorta" });
  await expect(alerts.getByRole("link", { name: /Featured/ })).toHaveAttribute("href", route);
  await latest.click();
  await expect(page).toHaveURL(new RegExp("/" + route + "$"));
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Example Featured" })).toBeFocused();

  await page.goBack();
  await expect(latest).toBeVisible();
  await alerts.getByRole("link", { name: /Low blend/ }).click();
  await expect(page.getByRole("article", { name: "Example Low blend" })).toBeFocused();

  await page.getByRole("navigation").getByRole("button", { name: "Sigari" }).click();
  const search = page.getByRole("searchbox", { name: "Cerca sigari" });
  await search.fill("Reserva");
  await expect(page.locator(".card")).toHaveCount(1);
  await page.evaluate((hash) => { window.location.hash = hash; }, route);
  await expect(page.getByRole("article", { name: "Example Featured" })).toBeFocused();
  await page.getByRole("link", { name: "Torna al catalogo" }).click();
  await expect(search).toHaveValue("Reserva");
  await expect(page.locator(".card")).toContainText("Reserva");
  await page.goBack();
  await expect(page.getByRole("article", { name: "Example Featured" })).toBeFocused();

  await page.reload();
  const direct = page.getByRole("article", { name: "Example Featured" });
  await expect(direct).toBeFocused();
  await direct.getByRole("button", { name: "Visualizza / Modifica →" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(page.getByText("Il prodotto richiesto non è disponibile in questo catalogo.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.getByRole("link", { name: "Torna al catalogo" }).click();
  await expect(search).toBeVisible();
});

test("stock preferences can be retried on Dashboard and opened from Account", async ({ page }) => {
  const api = await cloudMock(page);
  let fail = true;
  await page.route(
    (url) => url.origin === AUTH_ORIGIN && url.pathname === "/rest/v1/profiles" &&
      url.searchParams.get("select")?.includes("stock_alerts_enabled") === true,
    (route) => fail
      ? route.fulfill({ status: 400, json: { code: "XX000" } })
      : route.fallback(),
  );
  await page.goto("/");
  await signIn(page);
  await expect(page.getByRole("alert")).toHaveText("Impossibile caricare le preferenze di scorta.");
  fail = false;
  await page.getByRole("button", { name: "Riprova preferenze di scorta" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  const settings = page.locator(".stock-alert-settings");
  await page.getByRole("button", { name: "Impostazioni avvisi di scorta" }).click();
  await expect(settings.locator("summary")).toBeFocused();
  const threshold = settings.getByLabel("Soglia sigari (pezzi)");
  await threshold.selectOption("4");
  await page.getByRole("navigation").getByRole("button", { name: "Pipe" }).click();
  await expect(threshold).toHaveValue("4");
  await settings.getByRole("button", { name: "Salva preferenze scorte" }).click();
  await expect.poll(() => api.stockPreferences.get(OWNER_A)?.cigar_low_stock_threshold).toBe(4);

  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await expect(settings).toHaveCount(0);
  api.stockPreferences.set(OWNER_B, {
    stock_alerts_enabled: false,
    cigar_low_stock_threshold: 10,
  });
  await signIn(page, "other@example.test");
  await page.getByRole("button", { name: "Impostazioni avvisi di scorta" }).click();
  await expect(threshold).toHaveValue("10");
});

test("a product added from the journal is immediately available in a new session", async ({ page }) => {
  const session = journalRow(OWNER_A, "gift", "New blend");
  session.kind = "pipe";
  session.extra.product = { source: "gift", brand: "Friend", name: "New blend" };
  session.extra.pipe = { source: "gift", brand: "Friend", name: "Bent" };
  const api = await cloudMock(page, [], [], [], [session]);
  await page.goto("/#diary");
  await signIn(page);
  const details = page.locator(".card details");
  await details.locator("summary").click();
  page.once("dialog", (dialog) => dialog.accept());
  await details.getByRole("button", { name: "Aggiungi al catalogo" }).first().click();
  await expect(page.getByText("Prodotto aggiunto al catalogo.")).toBeVisible();
  const saved = api.tobaccos.find((item) => item.name === "New blend");
  expect(saved).toBeDefined();
  await page.getByRole("button", { name: "Registra fumata" }).click();
  const product = page.locator(".journal-editor").getByLabel("Scegli dal catalogo · Prodotto fumato");
  await product.selectOption({ label: "Friend · New blend" });
  await expect(product).toHaveValue(saved!.id);
  expect(api.sessions[0].extra.product).toMatchObject({ source: "gift", name: "New blend" });
});
