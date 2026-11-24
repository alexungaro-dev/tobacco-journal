import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  authSession,
  AUTH_ORIGIN,
  cloudMock,
  OWNER_A,
  OWNER_B,
  PHOTO,
  signIn,
  signOut,
  tobaccoRow,
} from "./cloudMock";

const bytes = Buffer.from(PHOTO.split(",")[1], "base64");
const editor = (page: Page) => page.locator(".tobacco-editor");
const save = (page: Page) =>
  editor(page).getByRole("button", { name: "Salva scheda" });
const card = (page: Page, name: string) =>
  page.locator(".card").filter({ hasText: name });
async function open(page: Page) {
  await page.goto("/#tobaccos");
  await signIn(page);
}
async function backup(page: Page, name: string) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}

test("tobacco CRUD, components, filters, sorting, private photo and English UI", async ({
  page,
}) => {
  const api = await cloudMock(
    page,
    [],
    [
      tobaccoRow(OWNER_A, "existing", "Zeta"),
      tobaccoRow(OWNER_B, "secret", "Secret"),
    ],
  );
  await open(page);
  await page.getByRole("button", { name: "Aggiungi tabacco" }).click();
  await editor(page).getByLabel("Marca", { exact: true }).fill("Tobacco Co");
  await editor(page).getByLabel("Nome", { exact: true }).fill("Alpha");
  await editor(page).getByLabel("Tipo di miscela").fill("Virginia blend");
  await editor(page).getByLabel("Quantità iniziale (g)").fill("50");
  await editor(page).getByText("Grammi residui esatti (facoltativo)").click();
  await editor(page).getByLabel("Quantità residua (g)").fill("36.5");
  await editor(page).getByRole("button", { name: "4 su 5" }).click();
  await editor(page)
    .getByLabel("Stato", { exact: true })
    .selectOption("opened");
  await editor(page).getByLabel("Virginia", { exact: true }).check();
  await editor(page)
    .getByLabel(/Altri componenti/)
    .fill("Custom leaf");
  await editor(page)
    .locator('input[type="file"]')
    .setInputFiles({
      name: "invalid.png",
      mimeType: "image/png",
      buffer: Buffer.from("invalid"),
    });
  await expect(editor(page).getByRole("alert")).toContainText("JPEG");
  await editor(page)
    .locator('input[type="file"]')
    .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: bytes });
  await expect(
    editor(page).getByAltText("Anteprima fotografia"),
  ).toHaveAttribute("src", /^blob:/);
  await save(page).click();
  await expect(card(page, "Tobacco Co Alpha").locator("img")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  expect(api.media[0].tobacco_id).toBeTruthy();
  expect(api.media[0]).not.toHaveProperty("pipe_id");
  expect(api.media[0].object_path).toMatch(
    new RegExp(`^${OWNER_A}/tobacco-photos/`),
  );
  await expect(page.locator(".card").first()).toContainText("Alpha");
  await page.getByLabel("Ordina per").selectOption("remaining");
  await expect(page.locator(".card").first()).toContainText("Zeta");
  await page.getByLabel("Tipo di miscela").selectOption("Virginia blend");
  await page.getByLabel("Stato", { exact: true }).selectOption("opened");
  await page.locator('input[type="search"]').fill("custom leaf");
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(page.locator(".card")).toContainText("Custom leaf");
  const exported = await backup(page, "Esporta dati JSON");
  expect(exported.format).toBe("tobacco-journal-tobaccos");
  expect(
    exported.tobaccos.find((entry: { name: string }) => entry.name === "Alpha")
      .photo,
  ).toBe(PHOTO);
  await page.reload();
  await expect(card(page, "Tobacco Co Alpha").locator("img")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await card(page, "Tobacco Co Alpha").getByRole("button").click();
  const originalPath = api.media[0].object_path;
  const replacement = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQLGAEAAEwAIsT8S5sAAAAAElFTkSuQmCC",
    "base64",
  );
  await editor(page)
    .locator('input[type="file"]')
    .setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: replacement,
    });
  await expect(
    editor(page).getByAltText("Anteprima fotografia"),
  ).toHaveAttribute("src", /^blob:/);
  api.failPhoto("upload");
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Caricamento della fotografia non verificato",
  );
  expect(api.objects.has(originalPath)).toBe(true);
  await save(page).click();
  await expect(editor(page)).toHaveCount(0);
  expect(api.objects.has(originalPath)).toBe(false);
  expect(api.media).toHaveLength(1);
  expect(api.objects.get(api.media[0].object_path)?.bytes).toEqual(replacement);
  await card(page, "Tobacco Co Alpha").getByRole("button").click();
  await editor(page).getByText("Grammi residui esatti (facoltativo)").click();
  await editor(page).getByLabel("Quantità residua (g)").fill("0");
  await editor(page)
    .getByRole("button", { name: "Rimuovi fotografia" })
    .click();
  await save(page).click();
  await expect(card(page, "Tobacco Co Alpha").locator("img")).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
  expect(api.objects.size).toBe(0);
  expect(
    api.tobaccos.find((row) => row.name === "Alpha")?.extra.remaining,
  ).toBe(0);
  await card(page, "Tobacco Co Alpha").getByRole("button").click();
  page.once("dialog", (dialog) => dialog.accept());
  await editor(page)
    .getByRole("button", { name: "Elimina", exact: true })
    .click();
  await expect(card(page, "Tobacco Co Alpha")).toHaveCount(0);
  await page.locator("select.language").selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Pipe tobacco" }),
  ).toBeVisible();
  await expect(page.getByText("Secret")).toHaveCount(0);
});

test("backup and explicit import protect duplicates and resume a partial private photo", async ({
  page,
}) => {
  const api = await cloudMock(page, [], [tobaccoRow()]);
  await open(page);
  await expect(
    page.getByRole("button", { name: "Importa dati JSON" }),
  ).toBeEnabled();
  const source = {
    format: "tobacco-journal-tobaccos",
    version: 1,
    tobaccos: [
      { id: "t1", brand: "Overwrite", name: "Existing" },
      { id: "both", brand: "A", name: "One" },
      { id: "both", brand: "B", name: "Two" },
      {
        id: "new",
        brand: "Imported",
        name: "Tin",
        components: ["Custom"],
        photo: PHOTO,
      },
    ],
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "tobaccos.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  const confirm = page.getByRole("button", {
    name: "Conferma importazione tabacchi",
  });
  await expect(confirm).toBeDisabled();
  const before = await backup(page, "Scarica backup prima dell’importazione");
  expect(before.tobaccos).toHaveLength(1);
  page.once("dialog", (dialog) => dialog.dismiss());
  await confirm.click();
  expect(api.tobaccos).toHaveLength(1);
  api.failPhoto("upload");
  page.once("dialog", (dialog) => dialog.accept());
  await confirm.click();
  await expect(
    page.getByText(/Importate: 0. Errori o duplicati: 2/),
  ).toBeVisible();
  await expect(page.getByText(/in attesa di caricamento/)).toBeVisible();
  await backup(page, "Scarica backup prima dell’importazione");
  page.once("dialog", (dialog) => dialog.accept());
  await confirm.click();
  await expect(
    page.getByText(/Importate: 1. Errori o duplicati: 1/),
  ).toBeVisible();
  await expect(card(page, "Imported Tin").locator("img")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  expect(api.tobaccos.find((row) => row.id === "t1")?.brand).toBe("Example");
  expect(api.tobaccos).toHaveLength(2);
  expect(api.media).toHaveLength(1);
});

test("stale edits, logout during upload, and owner switching leave the other catalogue isolated", async ({
  page,
}) => {
  const api = await cloudMock(
    page,
    [],
    [tobaccoRow(), tobaccoRow(OWNER_B, "t1", "Other")],
  );
  await open(page);
  await card(page, "Example Mixture").getByRole("button").click();
  api.tobaccos[0].updated_at = "2026-11-18T10:00:00.000Z";
  await save(page).click();
  await expect(page.getByRole("alert")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Ricarica/ }).click();
  await card(page, "Example Mixture").getByRole("button").click();
  await editor(page)
    .locator('input[type="file"]')
    .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: bytes });
  await expect(editor(page).getByAltText("Anteprima fotografia")).toBeVisible();
  const release = api.pauseUpload();
  const upload = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/tobacco-photos/"),
  );
  await save(page).click();
  const request = await upload;
  await signOut(page);
  await expect(editor(page)).toHaveCount(0);
  await signIn(page, "other@example.test");
  release();
  await expect(card(page, "Example Other")).toBeVisible();
  await expect(card(page, "Example Mixture")).toHaveCount(0);
  expect(api.media).toHaveLength(0);
  const status = await page.evaluate(
    async ({ url, token }) =>
      (await fetch(url, { headers: { Authorization: `Bearer ${token}` } }))
        .status,
    {
      url: request.url().replace(/^https:[^/]+\/\/[^/]+/, AUTH_ORIGIN),
      token: authSession(OWNER_B).access_token,
    },
  );
  expect(status).toBe(403);
});
