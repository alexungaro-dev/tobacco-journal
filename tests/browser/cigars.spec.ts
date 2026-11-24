import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  authSession,
  cigarRow,
  cloudMock,
  OWNER_A,
  OWNER_B,
  PHOTO,
  row,
  signIn,
  signOut,
  tobaccoRow,
} from "./cloudMock";

const bytes = Buffer.from(PHOTO.split(",")[1], "base64");
const secondPhoto = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQLGAEAAEwAIsT8S5sAAAAAElFTkSuQmCC",
  "base64",
);
const editor = (page: Page) => page.locator(".cigar-editor");
const card = (page: Page, name: string) =>
  page.locator(".card").filter({ hasText: name });
const save = (page: Page) =>
  editor(page).getByRole("button", { name: "Salva sigaro" });
const setPhoto = (page: Page, buffer: Buffer) =>
  editor(page).locator('input[type="file"]').setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer,
  });
async function open(page: Page) {
  await page.goto("/#cigars");
  await signIn(page);
}
async function download(page: Page) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta dati JSON" }).click();
  return JSON.parse(await readFile((await (await event).path())!, "utf8"));
}

test("cigar CRUD validates fields, supports custom vitola, rating, filters and personal humidity", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await cloudMock(page, [], [], [cigarRow()]);
  await open(page);
  await expect(
    card(page, "Example Reserva").getByText("Umidità target personale"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Aggiungi sigaro" }).click();
  const form = editor(page);
  const brand = form.getByLabel("Marca", { exact: true });
  const name = form.getByLabel("Nome", { exact: true });
  await save(page).click();
  expect(
    await brand.evaluate(
      (input: HTMLInputElement) => input.validity.valueMissing,
    ),
  ).toBe(true);
  expect(
    await name.evaluate(
      (input: HTMLInputElement) => input.validity.valueMissing,
    ),
  ).toBe(true);
  await brand.fill("Manifattura");
  await name.fill("Selezione");
  await form.getByLabel("Vitola o formato").fill("Toscano speciale");
  await expect(
    form.locator('datalist option[value="Half Corona"]'),
  ).toHaveCount(1);
  await form.getByLabel("Paese d’origine").fill("Italia");
  await form.getByText("Dettagli avanzati").click();
  const humidity = form.getByLabel("Umidità target (% UR)");
  await expect(humidity).toHaveValue("");
  await humidity.fill("101");
  const remaining = form.getByLabel("Quantità residua (pezzi)");
  await remaining.fill("1.5");
  await save(page).click();
  expect(
    await humidity.evaluate(
      (input: HTMLInputElement) => input.validity.rangeOverflow,
    ),
  ).toBe(true);
  expect(
    await remaining.evaluate(
      (input: HTMLInputElement) => input.validity.stepMismatch,
    ),
  ).toBe(true);
  expect(api.cigars).toHaveLength(1);
  await humidity.fill("64.5");
  await remaining.fill("2");
  await form.getByLabel("Quantità iniziale (pezzi)").fill("6");
  await form.getByLabel("Fascia", { exact: true }).fill("Kentucky");
  await form.getByRole("button", { name: "4 su 5" }).click();
  await save(page).click();
  const added = card(page, "Manifattura Selezione");
  await expect(added).toContainText("64,5 % UR");
  await expect(added).toContainText("4/5");
  await page.getByLabel("Ordina per").selectOption("remaining");
  await expect(page.locator(".card").first()).toContainText("Reserva");
  await page.getByLabel("Vitola o formato").selectOption("Toscano speciale");
  await page.getByLabel("Paese d’origine").selectOption("Italia");
  await page.locator('input[type="search"]').fill("kentucky");
  await expect(page.locator(".card")).toHaveCount(1);
  await added.getByRole("button").click();
  await expect(form.getByRole("button", { name: "4 su 5" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await form.getByLabel("Quantità residua (pezzi)").fill("0");
  await save(page).click();
  await expect(form).toHaveCount(0);
  expect(
    api.cigars.find((item) => item.name === "Selezione")?.extra.remaining,
  ).toBe(0);
  await added.getByRole("button").click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await form.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(added).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await form.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(added).toHaveCount(0);
  await page.locator("select.language").selectOption("en");
  await expect(page.getByRole("button", { name: "Add cigar" })).toBeVisible();
});

test("cigar private photo replacement and removal verify storage and clean prior objects", async ({
  page,
}) => {
  const api = await cloudMock(page, [], [], [cigarRow()]);
  await open(page);
  const existing = card(page, "Example Reserva");
  await existing.getByRole("button").click();
  await setPhoto(page, Buffer.from("invalid"));
  await expect(editor(page).getByRole("alert")).toContainText("JPEG");
  await setPhoto(page, bytes);
  await expect(
    editor(page).getByAltText("Anteprima fotografia"),
  ).toHaveAttribute("src", /^blob:/);
  await save(page).click();
  await expect(existing.locator("img")).toHaveAttribute("src", /^blob:/);
  const [initial] = api.objects.keys();
  expect(api.media[0]).toMatchObject({ cigar_id: "c1", user_id: OWNER_A });
  expect(initial).toMatch(new RegExp(`^${OWNER_A}/cigar-photos/`));
  await page.reload();
  await expect(existing.locator("img")).toHaveAttribute("src", /^blob:/);
  await existing.getByRole("button").click();
  await setPhoto(page, secondPhoto);
  await expect(
    editor(page).getByAltText("Anteprima fotografia"),
  ).toHaveAttribute("src", /^blob:/);
  api.failPhoto("upload");
  await save(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Caricamento della fotografia non verificato",
  );
  expect(api.objects.has(initial)).toBe(true);
  await save(page).click();
  await expect(editor(page)).toHaveCount(0);
  expect(api.objects.has(initial)).toBe(false);
  expect(api.media).toHaveLength(1);
  const path = api.media[0].object_path;
  expect(api.objects.get(path)?.bytes).toEqual(secondPhoto);
  await existing.getByRole("button").click();
  await editor(page)
    .getByRole("button", { name: "Rimuovi fotografia" })
    .click();
  await save(page).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(existing.locator("img")).toHaveCount(0);
  expect(api.objects.size).toBe(0);
  expect(api.media).toHaveLength(0);
});

test("cigar JSON import protects duplicate IDs and round-trips humidity and private photo independently", async ({
  page,
}) => {
  const api = await cloudMock(page, [row()], [tobaccoRow()], [cigarRow()]);
  await open(page);
  await expect(
    page.getByRole("button", { name: "Importa dati JSON" }),
  ).toBeEnabled();
  const source = {
    format: "tobacco-journal-cigars",
    version: 1,
    cigars: [
      { id: "c1", brand: "Override", name: "Duplicate" },
      { id: "float", brand: "Invalid", name: "Quantity", remaining: 1.5 },
      {
        id: "imported",
        brand: "Imported",
        name: "Corona",
        vitola: "Half Corona",
        humidity: 62,
        remaining: 5,
        series: "Serie",
        country: "Italia",
        length: 109,
        ringGauge: 42,
        wrapper: "W",
        binder: "B",
        filler: "F",
        strength: "Media",
        initial: 6,
        price: 12,
        date: "2026-11-18",
        rating: 3,
        notes: "Note",
        photo: PHOTO,
      },
    ],
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "cigars.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  const confirm = page.getByRole("button", {
    name: "Conferma importazione sigari",
  });
  page.once("dialog", (dialog) => dialog.dismiss());
  await confirm.click();
  expect(api.cigars).toHaveLength(1);
  page.once("dialog", (dialog) => dialog.accept());
  await confirm.click();
  await expect(
    page.getByText(/Importate: 1. Errori o duplicati: 1/),
  ).toBeVisible();
  await expect(card(page, "Imported Corona").locator("img")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  const exported = await download(page);
  expect(exported).toMatchObject({ format: source.format, version: 1 });
  expect(
    exported.cigars.find((item: { id: string }) => item.id === "imported"),
  ).toMatchObject(source.cigars[2]);
  expect(api.cigars.find((item) => item.id === "c1")?.name).toBe("Reserva");
  expect(
    api.requests.some((request) =>
      /\/rest\/v1\/(pipes|tobaccos)/.test(request.path),
    ),
  ).toBe(false);
  // An earlier interrupted write can leave a managed file linked in media.
  const stagedPath = `${OWNER_A}/cigar-photos/${"f".repeat(64)}`;
  api.objects.set(stagedPath, { bytes: secondPhoto, type: "image/png" });
  api.media.push({
    ...api.media[0],
    object_path: stagedPath,
    size_bytes: secondPhoto.length,
  });
  await card(page, "Imported Corona").getByRole("button").click();
  page.once("dialog", (dialog) => dialog.accept());
  await editor(page)
    .getByRole("button", { name: "Elimina", exact: true })
    .click();
  await expect(card(page, "Imported Corona")).toHaveCount(0);
  expect(api.media).toHaveLength(0);
  expect(api.objects.size).toBe(0);
});

test("logout during cigar upload prevents late attachment or cross-account reads", async ({
  page,
}) => {
  const api = await cloudMock(
    page,
    [],
    [],
    [cigarRow(), cigarRow(OWNER_B, "c1", "Other")],
  );
  await open(page);
  await card(page, "Example Reserva").getByRole("button").click();
  await setPhoto(page, bytes);
  await expect(editor(page).getByAltText("Anteprima fotografia")).toBeVisible();
  const release = api.pauseUpload();
  const pending = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/cigar-photos/"),
  );
  await save(page).click();
  const request = await pending;
  await signOut(page);
  await expect(editor(page)).toHaveCount(0);
  await signIn(page, "other@example.test");
  release();
  await expect(card(page, "Example Other")).toBeVisible();
  await expect(card(page, "Example Reserva")).toHaveCount(0);
  expect(api.media).toHaveLength(0);
  expect(
    await page.evaluate(
      async ({ url, token }) => {
        return (
          await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        ).status;
      },
      { url: request.url(), token: authSession(OWNER_B).access_token },
    ),
  ).toBe(403);
});
