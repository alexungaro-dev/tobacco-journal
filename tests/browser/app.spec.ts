import { test, expect } from "@playwright/test";
const photo =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII=";
const legacy = {
  id: "legacy",
  brand: "Peterson",
  model: "999",
  shape: "Bent",
  material: "Radica",
  filter: "9",
  status: "stored",
  date: "2025-05-10",
  price: 125.5,
  notes: "Ricordo personale",
  photo,
  custom: "retained",
};
test("legacy data, translations, locale, navigation and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!localStorage.getItem("tj-pipes-v1"))
      localStorage.setItem("tj-pipes-v1", JSON.stringify([p]));
  }, legacy);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Peterson 999" }),
  ).toBeVisible();
  await expect(page.getByAltText("Fotografia di Peterson 999")).toBeVisible();
  await expect(page.locator(".photo img")).toHaveJSProperty("naturalWidth", 1);
  await expect(page.locator(".details")).toContainText("125,50");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByRole("heading", { name: "My pipes" })).toBeVisible();
  await expect(page.locator(".details")).toContainText("125.50");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.getByRole("heading", { name: "My pipes" })).toBeVisible();
  for (const name of ["Dashboard", "Tobaccos", "Cigars", "Smoking diary"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByText("This module will be available in a future milestone."),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Go to pipes" }).click();
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.getByRole("button", { name: "View / Edit →" }).click();
  await expect(page.getByLabel("Personal notes")).toHaveValue(
    "Ricordo personale",
  );
  await page.getByLabel("Model *", { exact: true }).fill("Updated");
  await page.getByRole("button", { name: "Save pipe", exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tj-pipes-v1")!),
  );
  expect(saved[0].custom).toBe("retained");
  expect(saved[0].photo).toBe(photo);
  expect(errors).toEqual([]);
});
test("CRUD, photos, search, filters, persistence and JSON round trip", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "+ Aggiungi pipa" }).click();
  await page.getByLabel("Marca *").fill("Savinelli");
  await page.getByLabel("Modello *").fill("Roma");
  await page.getByLabel("Note personali").fill("Test personale");
  await page.getByLabel("Stato", { exact: true }).last().selectOption("stored");
  const chooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("button", {
      name: "Scegli una fotografia JPEG, PNG o WebP (max 3 MB)",
    })
    .click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(photo.split(",")[1], "base64"),
  });
  await expect(page.getByAltText("Anteprima fotografia")).toBeVisible();
  await page.getByRole("button", { name: "Salva scheda" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Savinelli Roma" }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("assente");
  await expect(
    page.getByText("Nessun risultato", { exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await page.getByLabel("Stato", { exact: true }).selectOption("in_use");
  await expect(
    page.getByText("Nessun risultato", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Stato", { exact: true }).selectOption("stored");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta dati JSON" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  await page.getByRole("button", { name: "Visualizza / Modifica →" }).click();
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Elimina", exact: true }).click();
  await expect(page.getByText("La tua collezione inizia qui")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByLabel("Importa dati JSON", { exact: true })
    .setInputFiles(path!);
  await expect(
    page.getByRole("heading", { name: "Savinelli Roma" }),
  ).toBeVisible();
  await expect(page.getByAltText("Fotografia di Savinelli Roma")).toBeVisible();
});
test("malformed storage is preserved and recoverable, invalid import cannot overwrite", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("tj-pipes-v1", "{broken"),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "I dati originali non sono stati modificati",
  );
  await expect(
    page.getByRole("button", { name: "+ Aggiungi pipa" }),
  ).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("tj-pipes-v1"))).toBe(
    "{broken",
  );
  await page.getByLabel("Importa dati JSON", { exact: true }).setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "Importazione non riuscita",
  );
  expect(await page.evaluate(() => localStorage.getItem("tj-pipes-v1"))).toBe(
    "{broken",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("Importa dati JSON", { exact: true }).setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "tobacco-journal-pipes",
        version: 1,
        pipes: [legacy],
      }),
    ),
  });
  await expect(
    page.getByRole("heading", { name: "Peterson 999" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "+ Aggiungi pipa" }),
  ).toBeEnabled();
});
test("initial English browser language is detected", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-GB" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My pipes" })).toBeVisible();
  await context.close();
});

test("storage unavailable and quota errors do not crash or discard records", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Impossibile leggere i dati salvati",
  );
  await expect(
    page.getByRole("button", { name: "+ Aggiungi pipa" }),
  ).toBeDisabled();
});

test("failed writes keep the form and original collection; photo validation and modal keyboard", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "+ Aggiungi pipa" }).click();
  await expect(page.getByLabel("Marca *")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Salva scheda" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "+ Aggiungi pipa" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "+ Aggiungi pipa" }).click();
  await page.getByLabel("Marca *").fill("Test");
  await page.getByLabel("Modello *").fill("Quota");
  await page.locator("#pic").setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("test"),
  });
  await expect(page.getByRole("alert")).toContainText("Utilizza un JPEG");
  await page.locator("#pic").setInputFiles({
    name: "valid.png",
    mimeType: "image/png",
    buffer: Buffer.from(photo.split(",")[1], "base64"),
  });
  await expect(page.getByAltText("Anteprima fotografia")).toBeVisible();
  await page.getByRole("button", { name: "Rimuovi fotografia" }).click();
  await expect(page.getByAltText("Anteprima fotografia")).toHaveCount(0);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "Salva scheda" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Salvataggio non riuscito",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("tj-pipes-v1")),
  ).toBeNull();
});
