import { expect, test, type Page } from "@playwright/test";
import {
  cigarRow,
  cloudMock,
  OWNER_A,
  OWNER_B,
  row,
  signIn,
  signOut,
  openPreferences,
  tobaccoRow,
} from "./cloudMock";

const card = (page: Page, name: string) =>
  page.locator(".card").filter({ hasText: name });
const editor = (page: Page) => page.locator(".journal-editor");
const save = (page: Page) =>
  editor(page).getByRole("button", { name: "Salva fumata" });

async function startCigar(page: Page, id: string) {
  await page.getByRole("button", { name: "Registra fumata" }).click();
  await editor(page).getByLabel("Tipo di fumata").selectOption("cigar");
  await editor(page)
    .getByLabel("Scegli dal catalogo · Prodotto fumato")
    .selectOption(id);
}

test("stock alerts use account settings, persist and never infer tobacco level from grams", async ({
  page,
}) => {
  const api = await cloudMock(
    page,
    [],
    [
      {
        ...tobaccoRow(OWNER_A, "low", "Blend low"),
        extra: { remainingLevel: "almostEmpty", remaining: 50 },
      },
      {
        ...tobaccoRow(OWNER_A, "empty", "Blend empty"),
        extra: { remainingLevel: "empty", remaining: 50 },
      },
      {
        ...tobaccoRow(OWNER_A, "unknown", "Blend unknown"),
        extra: { remaining: 0 },
      },
    ],
    [
      { ...cigarRow(OWNER_A, "above", "Four"), extra: { remaining: 4 } },
      { ...cigarRow(OWNER_A, "low", "Three"), extra: { remaining: 3 } },
      { ...cigarRow(OWNER_A, "empty", "None"), extra: { remaining: 0 } },
      { ...cigarRow(OWNER_A, "unknown", "Unknown"), extra: {} },
      { ...cigarRow(OWNER_B, "other", "Other"), extra: { remaining: 2 } },
    ],
  );
  await page.goto("/#cigars");
  await signIn(page);
  await expect(card(page, "Three").getByText("Scorta bassa")).toBeVisible();
  await expect(card(page, "None").getByText("Esaurito")).toBeVisible();
  await expect(card(page, "Four").locator(".stock-alert")).toHaveCount(0);
  await expect(card(page, "Unknown").locator(".stock-alert")).toHaveCount(0);
  await openPreferences(page);
  const threshold = page.getByLabel("Soglia sigari (pezzi)");
  const persist = page.getByRole("button", { name: "Salva preferenze scorte" });
  await threshold.selectOption("4");
  await persist.click();
  await page.getByRole("button", { name: "Chiudi", exact: true }).click();
  await expect(card(page, "Four").getByText("Scorta bassa")).toBeVisible();
  await page.reload();
  await expect(card(page, "Four").getByText("Scorta bassa")).toBeVisible();

  await page.getByRole("button", { name: "Tabacchi", exact: true }).click();
  await expect(card(page, "Blend low").getByText("Scorta bassa")).toBeVisible();
  await expect(card(page, "Blend empty").getByText("Esaurito")).toBeVisible();
  await expect(card(page, "Blend unknown").locator(".stock-alert")).toHaveCount(
    0,
  );
  await openPreferences(page);
  await page.getByLabel("Mostra gli avvisi di scorta").uncheck();
  await persist.click();
  await page.getByRole("button", { name: "Chiudi", exact: true }).click();
  await expect(card(page, "Blend low").locator(".stock-alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Diario", exact: true }).click();
  await startCigar(page, "low");
  await expect(editor(page).locator(".stock-alert")).toHaveCount(0);
  expect(api.stockPreferences.get(OWNER_A)).toEqual({
    stock_alerts_enabled: false,
    cigar_low_stock_threshold: 4,
  });
  await signOut(page);
  await signIn(page, "other@example.test");
  await startCigar(page, "other");
  await expect(editor(page).getByText("Scorta bassa")).toBeVisible();
});

test("zero-row cigar debit rolls back and lets the user register without a debit", async ({
  page,
}) => {
  const api = await cloudMock(
    page,
    [],
    [],
    [
      { ...cigarRow(OWNER_A, "last", "Last"), extra: { remaining: 1 } },
      { ...cigarRow(OWNER_A, "unspecified", "Unspecified"), extra: {} },
    ],
  );
  await page.goto("/#diary");
  await signIn(page);
  await startCigar(page, "last");
  await expect(editor(page).getByText("Scorta bassa")).toBeVisible();
  api.cigars[0].extra.remaining = 0;
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "La fumata non è stata registrata",
  );
  await expect(page.getByText("Fumata salvata.", { exact: true })).toHaveCount(
    0,
  );
  expect(api.sessions).toHaveLength(0);
  expect(api.cigars[0].extra.remaining).toBe(0);
  await editor(page).getByLabel("Sottrai 1 pezzo").uncheck();
  await save(page).click();
  await expect(
    page.getByText("Fumata salvata.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Scorte invariate.")).toBeVisible();
  expect(api.sessions).toHaveLength(1);
  expect(api.cigars[0].extra.remaining).toBe(0);

  await page.reload();
  await startCigar(page, "unspecified");
  await expect(editor(page).getByLabel("Sottrai 1 pezzo")).toBeDisabled();
  await expect(editor(page).locator(".stock-alert")).toHaveCount(0);
  await save(page).click();
  await expect(page.getByText("Scorte invariate.")).toBeVisible();
  expect(api.sessions).toHaveLength(2);
});

test("successful stock updates report the committed result after crossing the threshold and at zero", async ({
  page,
}) => {
  const api = await cloudMock(
    page,
    [row()],
    [{ ...tobaccoRow(), extra: { remainingLevel: "half", status: "opened" } }],
    [
      { ...cigarRow(OWNER_A, "below", "Threshold"), extra: { remaining: 4 } },
      { ...cigarRow(OWNER_A, "last", "Last"), extra: { remaining: 1 } },
    ],
  );
  await page.goto("/#diary");
  await signIn(page);
  await startCigar(page, "below");
  await expect(editor(page).locator(".stock-alert")).toHaveCount(0);
  await save(page).click();
  await expect(page.locator(".stock-confirmation")).toHaveText(
    /Scorta aggiornata.*Scorta bassa/,
  );
  expect(api.cigars[0].extra.remaining).toBe(3);

  await startCigar(page, "last");
  await save(page).click();
  await expect(page.locator(".stock-confirmation")).toHaveText(
    /Scorta aggiornata.*Esaurito/,
  );
  expect(api.cigars[1].extra.remaining).toBe(0);
  await startCigar(page, "last");
  await expect(editor(page).getByLabel("Sottrai 1 pezzo")).toBeDisabled();
  await expect(editor(page).getByText("Esaurito")).toBeVisible();
  await editor(page)
    .getByRole("button", { name: "Annulla", exact: true })
    .click();

  await page.getByRole("button", { name: "Registra fumata" }).click();
  await editor(page)
    .getByLabel("Scegli dal catalogo · Prodotto fumato")
    .selectOption("t1");
  await editor(page)
    .getByLabel("Scegli dal catalogo · Pipa utilizzata")
    .selectOption("legacy");
  await editor(page).getByLabel("Aggiorna scorta").check();
  await editor(page).getByLabel("Modifica livello visivo").check();
  await editor(page).getByLabel("Livello residuo").selectOption("almostEmpty");
  await save(page).click();
  await expect(page.locator(".stock-confirmation")).toHaveText(
    /Scorta aggiornata.*Scorta bassa/,
  );
  expect(api.tobaccos[0].extra).toMatchObject({
    remainingLevel: "almostEmpty",
    status: "opened",
  });
});
