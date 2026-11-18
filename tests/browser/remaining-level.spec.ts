import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { cloudMock, signIn, tobaccoRow } from "./cloudMock";

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test("fill level can be set and cleared independently of exact grams and packaging status", async ({
  page,
}) => {
  const api = await cloudMock(page, [], [tobaccoRow()]);
  await page.goto("/#tobaccos");
  await signIn(page);
  const card = page.locator(".card").filter({ hasText: "Example Mixture" });
  const editor = page.locator(".tobacco-editor");
  const level = page.getByRole("group", { name: "Livello residuo" });
  const unspecified = level.getByRole("radio", { name: "Non specificata" });
  const grams = editor.getByLabel("Quantità residua (g)");
  await expect(card.locator("dl")).toContainText("40");
  await expect(card.getByText("Livello residuo")).toHaveCount(0);
  await card.getByRole("button").click();
  await expect(unspecified).toBeChecked();
  await expect(grams).toBeHidden();
  await unspecified.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    level.getByRole("radio", { name: "Pieno", exact: true }),
  ).toBeChecked();
  await level.getByRole("radio", { name: "Metà" }).tap();
  await editor.getByRole("button", { name: "Salva scheda" }).click();
  await expect(card.locator("dd").first()).toHaveText("Metà");
  expect(api.tobaccos[0].extra).toMatchObject({
    remainingLevel: "half",
    remaining: 40,
    status: "sealed",
  });

  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta dati JSON" }).click();
  const backup = JSON.parse(
    await readFile((await (await downloaded).path())!, "utf8"),
  );
  expect(backup.version).toBe(1);
  expect(backup.tobaccos[0]).toMatchObject({
    remainingLevel: "half",
    remaining: 40,
  });

  await page.reload();
  await card.getByRole("button").click();
  await expect(level.getByRole("radio", { name: "Metà" })).toBeChecked();
  await editor.getByText("Grammi residui esatti (facoltativo)").tap();
  await expect(grams).toHaveValue("40");
  await unspecified.tap();
  await editor.getByRole("button", { name: "Salva scheda" }).click();
  await expect(editor).toHaveCount(0);
  expect(api.tobaccos[0].extra).toMatchObject({
    remainingLevel: null,
    remaining: 40,
    status: "sealed",
  });
  await expect(card.getByText("Livello residuo")).toHaveCount(0);

  await page.locator("select.language").selectOption("en");
  await card.getByRole("button").click();
  await expect(
    page
      .getByRole("group", { name: "Remaining fill level" })
      .getByRole("radio", { name: "Unspecified" }),
  ).toBeChecked();
});
