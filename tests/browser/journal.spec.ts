import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  authSession,
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

const editor = (page: Page) => page.locator(".journal-editor");
const card = (page: Page, name: string) =>
  page.locator(".card").filter({ hasText: name });
const save = (page: Page) =>
  editor(page).getByRole("button", { name: "Salva fumata" });
const product = (page: Page) =>
  editor(page).getByLabel("Scegli dal catalogo · Prodotto fumato");
async function open(page: Page) {
  await page.goto("/#diary");
  await signIn(page);
}
async function start(page: Page, cigar = false) {
  await page.getByRole("button", { name: "Registra fumata" }).click();
  if (cigar)
    await editor(page).getByLabel("Tipo di fumata").selectOption("cigar");
}
async function exportJournal(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta dati JSON" }).click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}
function accept(page: Page) {
  page.once("dialog", (dialog) => dialog.accept());
}

test("quick cigar logging defaults to a single atomic charge and retries a lost response", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await cloudMock(page, [], [], [cigarRow()]);
  await open(page);
  await start(page, true);
  const datetime = editor(page).getByLabel("Data e ora");
  expect(await datetime.inputValue()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
  await product(page).selectOption("c1");
  await expect(editor(page).getByText("Pezzi: 12 → 11")).toBeVisible();
  api.loseSessionWrite();
  await save(page).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(api.cigars[0].extra.remaining).toBe(11);
  await save(page).click();
  const existing = card(page, "Example Reserva");
  await expect(existing).toBeVisible();
  expect(api.cigars[0].extra.remaining).toBe(11);
  expect(api.sessions).toHaveLength(1);
  expect(api.sessions[0].rating).toBeNull();

  await page.reload();
  await existing.getByRole("button", { name: "Modifica fumata" }).click();
  await expect(editor(page).getByLabel("Sottrai 1 pezzo")).toHaveCount(0);
  await editor(page).getByRole("button", { name: "4 su 5" }).click();
  await save(page).click();
  await expect(existing).toContainText("4/5");
  accept(page);
  await existing.getByRole("button", { name: "Modifica fumata" }).click();
  await editor(page)
    .getByRole("button", { name: "Elimina", exact: true })
    .click();
  await expect(existing).toHaveCount(0);
  expect(api.cigars[0].extra.remaining).toBe(11);
  expect(api.sessions).toHaveLength(0);
});

test("pipe provenance is independent and stock changes only the selected tobacco fields", async ({
  page,
}) => {
  const api = await cloudMock(page, [row()], [tobaccoRow()]);
  await open(page);
  await start(page);
  await product(page).selectOption("t1");
  await editor(page)
    .getByLabel("Provenienza · Pipa utilizzata")
    .selectOption("gift");
  const pipe = editor(page).getByRole("group", { name: "Pipa utilizzata" });
  await pipe.getByLabel("Marca", { exact: true }).fill("Maker");
  await pipe.getByLabel("Nome", { exact: true }).fill("Pipa prestata");
  await pipe.getByLabel("Offerto da").fill("Anna");
  await editor(page).getByLabel("Aggiorna scorta").check();
  await editor(page).getByLabel("Modifica livello visivo").check();
  await editor(page).getByLabel("Livello residuo").selectOption("half");
  await editor(page).getByText("Esperienza", { exact: true }).click();
  await editor(page).getByLabel("Legno").check();
  await editor(page)
    .getByLabel(/Altri aromi/)
    .fill("Vaniglia");
  await editor(page).getByLabel("Evoluzione aromatica").fill("Più dolce");
  await editor(page).getByText("Dettagli pipa", { exact: true }).click();
  await editor(page)
    .getByLabel("Preparazione e caricamento")
    .fill("Caricamento leggero");
  await editor(page).getByText("Conclusioni", { exact: true }).click();
  await editor(page).getByLabel("Lo fumerei nuovamente").selectOption("yes");
  await editor(page).getByLabel("Note finali").fill("Da ripetere");
  await save(page).click();
  const added = card(page, "Example Mixture");
  await expect(added).toBeVisible();
  expect(api.sessions[0]).toMatchObject({
    tobacco_id: "t1",
    pipe_id: null,
    extra: {
      pipe: { name: "Pipa prestata", source: "gift", offeredBy: "Anna" },
      tags: ["wood", "Vaniglia"],
      again: true,
    },
  });
  expect(api.tobaccos[0].extra).toMatchObject({
    remaining: 40,
    remainingLevel: "half",
    status: "sealed",
  });
  await added.getByText("Dettagli della fumata").click();
  await expect(added).toContainText("Caricamento leggero");
  await expect(added).toContainText("Vaniglia");
  accept(page);
  await added.getByRole("button", { name: "Aggiungi al catalogo" }).click();
  await expect(page.getByText("Prodotto aggiunto al catalogo.")).toBeVisible();
  expect(api.rows).toHaveLength(2);
  accept(page);
  await added.getByRole("button", { name: "Aggiungi al catalogo" }).click();
  await expect(page.getByRole("alert")).toContainText("Esiste già");
  expect(api.rows).toHaveLength(2);

  await start(page);
  await editor(page)
    .getByLabel("Provenienza · Prodotto fumato")
    .selectOption("gift");
  await editor(page)
    .getByRole("group", { name: "Prodotto fumato" })
    .getByLabel("Nome", { exact: true })
    .fill("Tabacco offerto");
  await editor(page)
    .getByLabel("Scegli dal catalogo · Pipa utilizzata")
    .selectOption("legacy");
  await expect(editor(page).getByLabel("Aggiorna scorta")).toHaveCount(0);
  await save(page).click();
  await expect(card(page, "Tabacco offerto")).toBeVisible();
  expect(api.sessions[1]).toMatchObject({
    tobacco_id: null,
    pipe_id: "legacy",
  });
});

test("stale stock is rejected and journal backups keep snapshots and photos without charging inventory", async ({
  page,
}) => {
  const api = await cloudMock(page, [], [], [cigarRow()]);
  await open(page);
  await start(page, true);
  await product(page).selectOption("c1");
  api.cigars[0].updated_at = "2026-11-18T10:00:00.000Z";
  api.cigars[0].extra.remaining = 8;
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText("La scorta è cambiata");
  expect(api.sessions).toHaveLength(0);

  await page.getByRole("button", { name: "Ricarica dal cloud" }).click();
  await start(page, true);
  await product(page).selectOption("c1");
  await editor(page).getByLabel("Sottrai 1 pezzo").uncheck();
  await editor(page).getByText("Sessione e foto").click();
  await editor(page)
    .locator('input[type="file"]')
    .setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(PHOTO.split(",")[1], "base64"),
    });
  await expect(editor(page).getByAltText("Anteprima fotografia")).toBeVisible();
  await save(page).click();
  const existing = card(page, "Example Reserva");
  await expect(existing.locator("img")).toHaveAttribute("src", /^blob:/);
  expect(api.media[0]).toMatchObject({
    user_id: OWNER_A,
    smoking_session_id: api.sessions[0].id,
  });
  const backup = await exportJournal(page);
  expect(backup.sessions[0]).toMatchObject({
    photo: PHOTO,
    product: { name: "Reserva", catalogueId: "c1" },
  });
  backup.sessions.push({ ...backup.sessions[0], id: "restored" });
  await page
    .locator('.cloudtools input[type="file"]')
    .setInputFiles({
      name: "diary.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  accept(page);
  await page
    .getByRole("button", { name: "Conferma importazione diario" })
    .click();
  await expect(
    page.getByText(/Importate: 1. Errori o duplicati: 1/),
  ).toBeVisible();
  expect(api.cigars[0].extra.remaining).toBe(8);
  expect(api.sessions).toHaveLength(2);
  expect(api.objects.size).toBe(2);
  await page.getByLabel("Tipo di fumata").selectOption("cigar");
  await page
    .getByLabel("Prodotto fumato")
    .selectOption({ label: "Example Reserva" });
  await page.getByRole("searchbox").fill("reserva");
  await expect(existing).toHaveCount(2);
});

test("switching accounts during photo upload prevents late attachment and rejects foreign objects", async ({
  page,
}) => {
  const api = await cloudMock(
    page,
    [],
    [],
    [],
    [journalRow(), journalRow(OWNER_B, "j1", "Other cigar")],
  );
  await open(page);
  const own = card(page, "Guest Private cigar");
  await own.getByRole("button", { name: "Modifica fumata" }).click();
  await editor(page).getByText("Sessione e foto").click();
  await editor(page)
    .locator('input[type="file"]')
    .setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(PHOTO.split(",")[1], "base64"),
    });
  await expect(editor(page).getByAltText("Anteprima fotografia")).toBeVisible();
  const release = api.pauseUpload();
  const upload = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/session-photos/"),
  );
  await save(page).click();
  const request = await upload;
  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await signIn(page, "other@example.test");
  release();
  await expect(card(page, "Guest Other cigar")).toBeVisible();
  await expect(own).toHaveCount(0);
  expect(api.media).toHaveLength(0);
  const code = await page.evaluate(
    async ({ url, token }) =>
      (await fetch(url, { headers: { Authorization: `Bearer ${token}` } }))
        .status,
    { url: request.url(), token: authSession(OWNER_B).access_token },
  );
  expect(code).toBe(403);
});
