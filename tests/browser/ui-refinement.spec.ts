import { expect, test } from "@playwright/test";
import {
  AUTH_ORIGIN,
  cigarRow,
  cloudMock,
  journalRow,
  OWNER_A,
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
