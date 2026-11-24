import { expect, test, type Page } from "@playwright/test";
import { AUTH_ORIGIN, signIn, signOut } from "./cloudMock";
import { photoCatalogueFixture } from "./photoCatalogueFixture";

function card(page: Page, name: string) {
  return page.locator(".card").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

async function openCatalogue(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#cigars");
  await signIn(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(".card")).toHaveCount(8);
}

test("private card photos load on intersection and when filters reveal an unseen card", async ({ page }) => {
  const { downloads, metadata, fixtures } = await photoCatalogueFixture(page);
  await openCatalogue(page);

  const first = card(page, "Example Riserva 0");
  const last = card(page, "Example Riserva 7");
  await expect(first.locator("img")).toHaveAttribute("src", /^blob:/);
  await expect(last.locator(".photo")).not.toBeInViewport();
  expect(downloads()).toHaveLength(1);
  expect(metadata()).toHaveLength(1);

  await last.locator(".photo").scrollIntoViewIfNeeded();
  await expect(last.locator("img")).toHaveAttribute("src", /^blob:/);
  expect(downloads().some(({ path }) => path.includes(fixtures[7].path))).toBe(true);
  expect(downloads().some(({ path }) => path.includes(fixtures[4].path))).toBe(false);

  const search = page.getByRole("searchbox", { name: "Cerca sigari" });
  await search.fill("Riserva 4");
  await page.evaluate(() => window.scrollTo(0, 0));
  const newlyVisible = card(page, "Example Riserva 4");
  await expect(newlyVisible.locator("img")).toHaveAttribute("src", /^blob:/);
  expect(downloads().some(({ path }) => path.includes(fixtures[4].path))).toBe(true);

  await newlyVisible.getByRole("button", { name: "Visualizza / Modifica →" }).click();
  const preview = page.locator(".cigar-editor").getByAltText("Anteprima fotografia");
  await expect(preview).toHaveAttribute("src", /^blob:/);
  await expect(preview).not.toBeInViewport();
  await page.locator(".cigar-editor").getByRole("button", { name: "Annulla" }).click();

  await search.clear();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(first.locator("img")).toHaveAttribute("src", /^blob:/);
  await expect(last.locator("img")).toHaveCount(0);
});

test("switching accounts discards a deferred download already in flight", async ({ page }) => {
  const { fixtures, downloads } = await photoCatalogueFixture(page);
  const lastPath = fixtures[7].path;
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(
    (url) => url.origin === AUTH_ORIGIN &&
      decodeURIComponent(url.pathname).endsWith("/" + lastPath),
    async (route) => {
      start();
      await held;
      await route.fallback().catch(() => {});
    },
  );

  try {
    await openCatalogue(page);
    const last = card(page, "Example Riserva 7");
    await last.locator(".photo").scrollIntoViewIfNeeded();
    await started;
    await signOut(page);
    await expect(page.locator(".card")).toHaveCount(0);

    await signIn(page, "other@example.test");
      await page.evaluate(() => window.scrollTo(0, 0));
    await expect(card(page, "Example Other private cigar").locator("img")).toHaveAttribute("src", /^blob:/);
    release();
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.getByAltText(/Riserva/)).toHaveCount(0);
    expect(downloads().some(({ path }) => path.includes(fixtures[4].path))).toBe(false);
  } finally {
    release();
  }
});
