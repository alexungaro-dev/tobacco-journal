import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  cloudMock,
  signIn,
  row,
  LEGACY,
  PHOTO,
  OWNER_A,
  OWNER_B,
  AUTH_ORIGIN,
  authSession,
} from "./cloudMock";

const replacement =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQLGAEAAEwAIsT8S5sAAAAAElFTkSuQmCC";
const data = (source: string) => Buffer.from(source.split(",")[1], "base64");
const save = (page: Page) =>
  page.getByRole("button", { name: "Salva scheda", exact: true });
const card = (page: Page) =>
  page.locator(".card").filter({ hasText: "Peterson 999" });
const file = (page: Page) => page.locator("#pipephoto");
const choose = (page: Page, source = replacement) =>
  file(page).setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: data(source),
  });
async function privatePicture(page: Page) {
  await card(page).locator(".photo").scrollIntoViewIfNeeded();
  await expect(card(page).locator("img")).toHaveAttribute("src", /^blob:/);
}
const pending = (page: Page, count: number) =>
  expect(
    page.getByText(`Fotografie ancora da trasferire: ${count}.`),
  ).toBeVisible();
const migrate = (page: Page) => {
  page.once("dialog", (dialog) => dialog.accept());
  return page
    .getByRole("button", { name: "Trasferisci fotografie legacy" })
    .click();
};

async function exportPipe(page: Page, label = "Esporta dati JSON") {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: label }).click();
  const json = JSON.parse(
    await readFile((await (await downloaded).path())!, "utf8"),
  );
  expect(json.version).toBe(1);
  expect(json.format).toBe("tobacco-journal-pipes");
  expect(json.pipes[0]).not.toHaveProperty("_tobaccoJournalStoragePhoto");
  return json.pipes[0];
}

test("validated upload for a new pipe, private display after refresh, replacement and removal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await cloudMock(page);
  await page.goto("/#pipes");
  await signIn(page);
  await page.getByRole("button", { name: /Aggiungi/ }).click();
  await page.getByLabel("Marca *").fill("Peterson");
  await page.getByLabel("Modello *").fill("999");
  for (const input of [
    { mimeType: "text/plain", buffer: data(PHOTO) },
    { mimeType: "image/png", buffer: Buffer.from("not a PNG") },
    { mimeType: "image/png", buffer: data(PHOTO).subarray(0, 20) },
    { mimeType: "image/png", buffer: Buffer.alloc(3 * 1024 * 1024 + 1) },
  ]) {
    await file(page).setInputFiles({ name: "photo.png", ...input });
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect(save(page)).toBeDisabled();
  }
  expect(api.objects.size).toBe(0);
  await choose(page, PHOTO);
  await expect(page.getByAltText("Anteprima fotografia")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await save(page).click();
  await privatePicture(page);
  expect(api.media).toHaveLength(1);
  const [initial] = api.objects.keys();
  expect(initial).toMatch(new RegExp(`^${OWNER_A}/pipe-photos/`));
  expect(api.objects.get(initial)?.bytes).toEqual(data(PHOTO));
  await page.reload();
  await privatePicture(page);
  await card(page)
    .getByRole("button", { name: /Modifica/ })
    .click();
  await choose(page);
  await expect(page.getByAltText("Anteprima fotografia")).toBeVisible();
  await save(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await privatePicture(page);
  expect(api.objects.has(initial)).toBe(false);
  expect(api.media).toHaveLength(1);
  expect((await exportPipe(page)).photo).toBe(replacement);
  await card(page)
    .getByRole("button", { name: /Modifica/ })
    .click();
  await page.getByRole("button", { name: "Rimuovi fotografia" }).click();
  await save(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card(page).locator("img")).toHaveCount(0);
  expect(api.objects.size).toBe(0);
  expect(api.media).toHaveLength(0);
  expect((await exportPipe(page)).photo).toBeNull();
});

test("legacy migration confirms, retries partial failures, preserves originals and falls back", async ({
  page,
}) => {
  const api = await cloudMock(page, [row()]);
  await page.goto("/#pipes");
  await signIn(page);
  await pending(page, 1);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Trasferisci fotografie legacy" })
    .click();
  expect(api.objects.size).toBe(0);

  api.failPhoto("metadata");
  await migrate(page);
  await expect(
    page.getByText(/Fotografie verificate: 0. Errori: 1/),
  ).toBeVisible();
  await pending(page, 1);
  expect(api.objects.size).toBe(1);
  expect(api.media).toHaveLength(0);
  await expect(card(page).locator("img")).toHaveAttribute("src", PHOTO);
  api.rows[0].updated_at = "2026-11-17T16:00:00.000Z";
  api.failPhoto("lost-pipe");
  await migrate(page);
  await expect(
    page.getByText(/Fotografie verificate: 1. Errori: 0/),
  ).toBeVisible();
  await privatePicture(page);
  await pending(page, 0);
  const migrateButton = page.getByRole("button", {
    name: "Trasferisci fotografie legacy",
  });
  await expect(migrateButton).toBeDisabled();
  expect(api.objects.size).toBe(1);
  expect(api.media).toHaveLength(1);
  expect(api.rows[0].id).toBe(LEGACY.id);
  const { _tobaccoJournalStoragePhoto: ref, ...original } =
    api.rows[0].legacy_payload;
  expect(ref).toBeDefined();
  expect(original).toEqual(LEGACY);
  expect((await exportPipe(page)).photo).toBe(PHOTO);

  await card(page)
    .getByRole("button", { name: /Modifica/ })
    .click();
  await choose(page);
  await expect(page.getByAltText("Anteprima fotografia")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await expect(save(page)).toBeEnabled();
  api.failPhoto("upload");
  await save(page).click();
  await expect(
    page.getByText("Caricamento della fotografia non verificato. Riprova."),
  ).toBeVisible();
  expect(api.objects.size).toBe(1);
  expect(api.media).toHaveLength(1);
  api.failPhoto("lost-upload");
  await save(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const backup = await exportPipe(page);
  expect(backup.photo).toBe(replacement);
  expect(backup.tobaccoJournalOriginalPhoto).toBe(PHOTO);
  expect(backup.custom).toEqual({ retained: true });
  expect(api.rows[0].legacy_payload.photo).toBe(PHOTO);
  api.objects.clear();
  await page.reload();
  await expect(card(page).locator("img")).toHaveAttribute("src", PHOTO);
  await expect(
    card(page).getByText(/È mostrata la copia originale/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Esporta dati JSON" }).click();
  await expect(
    page.getByText(/Il backup completo non è disponibile/),
  ).toBeVisible();
  expect((await exportPipe(page, "Esporta copie originali")).photo).toBe(PHOTO);
  await card(page)
    .getByRole("button", { name: /Modifica/ })
    .click();
  await page.getByRole("button", { name: "Rimuovi fotografia" }).click();
  await save(page).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card(page).locator("img")).toHaveCount(0);
  await pending(page, 0);
  expect(api.rows[0].legacy_payload.photo).toBe(PHOTO);
  expect((await exportPipe(page)).tobaccoJournalOriginalPhoto).toBe(PHOTO);
});

test("late uploads cannot attach or disclose photos after logout and owner change", async ({
  page,
}) => {
  const api = await cloudMock(page, [
    row(),
    row(OWNER_B, { id: LEGACY.id, brand: "Other", model: "Private" }),
  ]);
  await page.goto("/#pipes");
  await signIn(page);
  await migrate(page);
  await privatePicture(page);
  const [originalPath] = api.objects.keys();
  await card(page)
    .getByRole("button", { name: /Modifica/ })
    .click();
  await choose(page);
  await expect(save(page)).toBeEnabled();
  const release = api.pauseUpload();
  const upload = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes("/storage/v1/object/"),
  );
  await save(page).click();
  await upload;
  const other = await page.context().newPage();
  await cloudMock(other);
  await other.goto("/#pipes");
  await other.locator(".account summary").click();
  await other.getByRole("button", { name: "Esci", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  await other.close();
  await signIn(page, "other@example.test");
  release();
  await expect(
    page.getByRole("heading", { name: "Other Private" }),
  ).toBeVisible();
  await expect(page.locator(".card img")).toHaveCount(0);
  expect(api.media).toHaveLength(1);
  expect(api.media[0].object_path).toBe(originalPath);
  expect(
    api.requests.filter(
      (request) =>
        request.owner === OWNER_B && request.path.includes("/storage/"),
    ),
  ).toHaveLength(0);
  const otherStatus = await page.evaluate(
    async ({ url, token }) => {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.status;
    },
    {
      url: `${AUTH_ORIGIN}/storage/v1/object/journal-photos/${originalPath}`,
      token: authSession(OWNER_B).access_token,
    },
  );
  expect(otherStatus).toBe(403);
});

test("invalid and oversized legacy images are reported and retained", async ({
  page,
}) => {
  const corrupt = "data:image/png;base64,AAAA";
  const unsupported = "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==";
  const oversized =
    "data:image/png;base64," + "A".repeat(4 * (1024 * 1024 + 1));
  const api = await cloudMock(page, [
    row(OWNER_A, { ...LEGACY, id: "bad", photo: corrupt }),
    row(OWNER_A, { ...LEGACY, id: "large", photo: oversized }),
    row(OWNER_A, { ...LEGACY, id: "gif", photo: unsupported }),
  ]);
  await page.goto("/#pipes");
  await signIn(page);
  await pending(page, 3);
  await migrate(page);
  await expect(
    page.getByText(/bad: Scegli un’immagine JPEG, PNG o WebP valida/),
  ).toBeVisible();
  await expect(
    page.getByText(/gif: Scegli un’immagine JPEG, PNG o WebP valida/),
  ).toBeVisible();
  await expect(
    page.getByText(/large: La fotografia deve avere una dimensione/),
  ).toBeVisible();
  await pending(page, 3);
  expect(api.objects.size).toBe(0);
  expect(api.rows.map((entry) => entry.legacy_payload.photo)).toEqual([
    corrupt,
    oversized,
    unsupported,
  ]);
});

test("cleanup failure retains only the new active photo and reports the leftover object", async ({
  page,
}) => {
  const api = await cloudMock(page, [row()]);
  await page.goto("/#pipes");
  await signIn(page);
  await migrate(page);
  await privatePicture(page);
  const [old] = api.objects.keys();
  await card(page)
    .getByRole("button", { name: /Modifica/ })
    .click();
  await choose(page);
  api.failPhoto("cleanup");
  await save(page).click();
  await expect(
    page.getByText(
      /pulizia della fotografia precedente non è stata confermata/,
    ),
  ).toBeVisible();
  expect(api.objects.has(old)).toBe(true);
  expect(api.media).toHaveLength(1);
  expect(api.media[0].object_path).not.toBe(old);
  expect((await exportPipe(page)).photo).toBe(replacement);
});
