import { expect, test } from "@playwright/test";
import { cloudMock, signIn } from "./cloudMock";

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

test("optional stars support keyboard and touch, localize feedback and persist integer or null", async ({
  page,
}) => {
  const api = await cloudMock(page);
  await page.goto("/#tobaccos");
  await signIn(page);
  await page.getByRole("button", { name: "Aggiungi tabacco" }).click();
  const editor = page.locator(".tobacco-editor");
  const rating = page.getByRole("group", { name: "Gradimento personale" });
  const star = (score: number) =>
    rating.getByRole("button", { name: `${score} su 5` });
  const save = editor.getByRole("button", { name: "Salva scheda" });
  const card = page.locator(".card").filter({ hasText: "Marca Miscela" });
  await editor.getByLabel("Marca", { exact: true }).fill("Marca");
  await editor.getByLabel("Nome", { exact: true }).fill("Miscela");
  await expect(rating.getByRole("status")).toHaveText(
    "0/5 · Nessuna valutazione",
  );
  await expect(rating.locator('[data-filled="true"]')).toHaveCount(0);
  await save.click();
  await expect(card).toBeVisible();
  expect(api.tobaccos[0].extra.rating).toBeNull();

  await card.getByRole("button").click();
  await star(1).focus();
  await page.keyboard.press("Tab");
  await expect(star(2)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(star(2)).toHaveAttribute("aria-pressed", "true");
  await expect(rating.locator('[data-filled="true"]')).toHaveCount(2);
  await expect(rating.getByRole("status")).toHaveText("2/5 · Poco gradito");
  await page.keyboard.press("Enter");
  await expect(star(2)).toHaveAttribute("aria-pressed", "false");
  await star(5).tap();
  await expect(rating.locator('[data-filled="true"]')).toHaveCount(5);
  await save.click();
  await expect(editor).toHaveCount(0);
  expect(api.tobaccos[0].extra.rating).toBe(5);

  await page.reload();
  await card.getByRole("button").click();
  await expect(star(5)).toHaveAttribute("aria-pressed", "true");
  await page.locator("select.language").selectOption("en");
  const english = page.getByRole("group", { name: "Personal rating" });
  await expect(english.getByRole("status")).toHaveText("5/5 · Excellent");
  await english.getByRole("button", { name: "5 out of 5" }).tap();
  await expect(english.getByRole("status")).toHaveText("0/5 · No rating");
  await editor.getByRole("button", { name: "Save pipe" }).click();
  await expect(editor).toHaveCount(0);
  expect(api.tobaccos[0].extra.rating).toBeNull();
});
