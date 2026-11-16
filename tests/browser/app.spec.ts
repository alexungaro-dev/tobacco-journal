import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  cloudMock,
  signIn,
  row,
  LEGACY,
  PHOTO,
  OWNER_A,
  OWNER_B,
} from "./cloudMock";

test("signed-out catalogue hides local and cloud personal data; explicit import only", async ({
  page,
}) => {
  const api = await cloudMock(page, [row()]);
  const original = JSON.stringify([LEGACY]);
  await page.addInitScript(
    (v) => localStorage.setItem("tj-pipes-v1", v),
    original,
  );
  await page.goto("/");
  await expect(page.getByText(/Accedi dalla sezione Account/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Peterson 999" })).toHaveCount(
    0,
  );
  expect(
    api.requests.some((r) => r.path.startsWith("/rest/v1/pipes")),
  ).toBeFalsy();
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Peterson 999" }),
  ).toBeVisible();
  expect(
    api.requests
      .filter((r) => r.path.startsWith("/rest/v1/pipes"))
      .every((r) => r.method === "GET"),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Prepara importazione dal browser" })
    .click();
  await expect(
    page.getByRole("region", { name: "Importazione nel cloud" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Peterson 999" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("region", { name: "Importazione nel cloud" }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("tj-pipes-v1"))).toBe(
    original,
  );
});

test("cloud CRUD, search, filters, bilingual responsive UI and JSON export", async ({
  page,
}) => {
  const api = await cloudMock(page);
  await page.goto("/");
  await signIn(page);
  await page.getByRole("button", { name: "+ Aggiungi pipa" }).click();
  await expect(page.getByLabel("Marca *")).toBeFocused();
  await page.getByLabel("Marca *").fill("Savinelli");
  await page.getByLabel("Modello *").fill("Roma");
  await page.getByLabel("Note personali").fill("Cloud note");
  await page.getByLabel("Stato", { exact: true }).last().selectOption("stored");
  await expect(page.locator("#pic")).toHaveCount(0);
  await page.getByRole("button", { name: "Salva scheda", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Savinelli Roma" }),
  ).toBeVisible();
  expect(api.rows).toHaveLength(1);
  expect(api.rows[0].user_id).toBe(OWNER_A);
  await page.getByRole("searchbox").fill("absent");
  await expect(
    page.getByText("Nessun risultato", { exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await page.getByLabel("Stato", { exact: true }).selectOption("in_use");
  await expect(
    page.getByText("Nessun risultato", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Stato", { exact: true }).selectOption("stored");
  await page.getByRole("button", { name: "Visualizza / Modifica →" }).click();
  await page.getByLabel("Modello *").fill("Roma Updated");
  await page.getByRole("button", { name: "Salva scheda", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Savinelli Roma Updated" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await page.screenshot({
      path: `test-results/cloud-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON data" }).click();
  const backup = JSON.parse(
    await readFile((await (await downloaded).path())!, "utf8"),
  );
  expect(backup.format).toBe("tobacco-journal-pipes");
  expect(backup.pipes[0].model).toBe("Roma Updated");
  await page.getByRole("button", { name: "View / Edit →" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(api.rows).toHaveLength(0);
  expect(
    await page.evaluate(() => localStorage.getItem("tj-pipes-v1")),
  ).toBeNull();
});

test("local migration preserves photos, reports invalid rows, verifies retries and never overwrites conflicts", async ({
  page,
}) => {
  const api = await cloudMock(page);
  const original = JSON.stringify([
    LEGACY,
    { ...LEGACY, id: "negative", price: -1 },
    { ...LEGACY, id: "bad-date", date: "2025-02-30" },
    { id: "broken" },
    { ...LEGACY, id: "dup" },
    { ...LEGACY, id: "dup" },
  ]);
  await page.addInitScript((v) => {
    if (!localStorage.getItem("tj-pipes-v1"))
      localStorage.setItem("tj-pipes-v1", v);
  }, original);
  await page.goto("/");
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Peterson 999" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Prepara importazione dal browser" })
    .click();
  const region = page.getByRole("region", { name: "Importazione nel cloud" });
  await expect(region).toContainText(
    "Schede importabili: 1. Schede escluse: 5.",
  );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Scarica backup prima del trasferimento" })
    .click();
  const backup = JSON.parse(
    await readFile((await (await downloaded).path())!, "utf8"),
  );
  expect(backup.pipes).toEqual(JSON.parse(original));
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Conferma trasferimento delle schede" })
    .click();
  expect(api.rows).toHaveLength(0);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Conferma trasferimento delle schede" })
    .click();
  await expect(region).toContainText(
    "Schede verificate nel cloud: 1. Escluse: 5.",
  );
  expect(api.rows).toHaveLength(1);
  expect(api.rows[0].legacy_payload).toEqual(LEGACY);
  await expect(page.getByAltText("Fotografia di Peterson 999")).toBeVisible();
  await expect(region).toContainText(
    "trasferimento delle fotografie NON è completato",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Conferma trasferimento delle schede" })
    .click();
  await expect(region).toContainText("Schede verificate nel cloud: 1.");
  expect(api.rows).toHaveLength(1);
  await page.getByRole("button", { name: "Visualizza / Modifica →" }).click();
  await expect(page.getByAltText("Anteprima fotografia")).toHaveAttribute(
    "src",
    PHOTO,
  );
  await page.getByLabel("Modello *").fill("Changed in cloud");
  await page.getByRole("button", { name: "Salva scheda", exact: true }).click();
  expect(api.rows[0].legacy_payload.photo).toBe(PHOTO);
  expect(api.rows[0].legacy_payload.custom).toEqual({ retained: true });
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Conferma trasferimento delle schede" })
    .click();
  await expect(region).toContainText("Conflitti o errori: 1.");
  expect(api.rows[0].model).toBe("Changed in cloud");
  await page.screenshot({
    path: "test-results/cloud-import.png",
    fullPage: true,
  });
  const cloudDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta dati JSON" }).click();
  const cloudBackup = JSON.parse(
    await readFile((await (await cloudDownload).path())!, "utf8"),
  );
  expect(cloudBackup.pipes[0].photo).toBe(PHOTO);
  expect(cloudBackup.pipes[0].custom).toEqual({ retained: true });
  expect(await page.evaluate(() => localStorage.getItem("tj-pipes-v1"))).toBe(
    original,
  );
});

test("version 1 JSON import adds records without replacing the cloud catalogue", async ({
  page,
}) => {
  const api = await cloudMock(page, [
    row(OWNER_A, { id: "already", brand: "Existing", model: "Cloud" }),
  ]);
  await page.goto("/");
  await signIn(page);
  await page.getByLabel("Importa dati JSON", { exact: true }).setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "tobacco-journal-pipes",
        version: 1,
        pipes: [LEGACY],
      }),
    ),
  });
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Conferma trasferimento delle schede" })
    .click();
  await expect(page.getByText(/Schede verificate nel cloud: 1/)).toBeVisible();
  expect(api.rows).toHaveLength(2);
  expect(api.rows.find((r) => r.id === "already")?.model).toBe("Cloud");
  expect(
    await page.evaluate(() => localStorage.getItem("tj-pipes-v1")),
  ).toBeNull();
});

test("account isolation and pagination: logout clears open forms and switching users never shows old pipes", async ({
  page,
}) => {
  const api = await cloudMock(page, [
    row(),
    row(OWNER_A, { id: "2", brand: "A", model: "Two" }),
    row(OWNER_A, { id: "3", brand: "A", model: "Three" }),
    row(OWNER_B, { id: "legacy", brand: "Other", model: "Private" }),
  ]);
  await page.goto("/");
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Peterson 999" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "A Three" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Other Private" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Visualizza / Modifica →" })
    .first()
    .click();
  // Logout from a second tab must unmount even an open editing dialog.
  const other = await page.context().newPage();
  await cloudMock(other);
  await other.goto("/");
  await other.locator(".account summary").click();
  await expect(
    other.getByRole("button", { name: "Esci", exact: true }),
  ).toBeVisible();
  await other.getByRole("button", { name: "Esci", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Peterson 999" })).toHaveCount(
    0,
  );
  await other.close();
  await signIn(page, "other@example.test");
  await expect(
    page.getByRole("heading", { name: "Other Private" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Peterson 999" })).toHaveCount(
    0,
  );
  expect(
    api.requests
      .filter((r) => r.path.startsWith("/rest/v1/pipes") && r.method === "GET")
      .every(
        (r) =>
          new URL("https://test" + r.path).searchParams.get("user_id") ===
          `eq.${r.owner}`,
      ),
  ).toBeTruthy();
});

test("a late cloud response cannot repopulate the UI after logout", async ({
  page,
}) => {
  const api = await cloudMock(page, [row()]);
  const release = api.pauseNextRead();
  await page.goto("/");
  await signIn(page);
  await expect(page.getByText("Caricamento delle pipe cloud…")).toBeVisible();
  await page.getByRole("button", { name: "Esci", exact: true }).click();
  release();
  await expect(page.getByText(/Accedi dalla sezione Account/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Peterson 999" })).toHaveCount(
    0,
  );
  await signIn(page, "other@example.test");
  await expect(page.getByText("La tua collezione inizia qui")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Peterson 999" })).toHaveCount(
    0,
  );
});

test("network errors and lost write responses never report false success or duplicate records", async ({
  page,
}) => {
  const api = await cloudMock(page);
  api.failNext("GET");
  await page.goto("/");
  await signIn(page);
  await expect(page.getByRole("alert")).toContainText(
    "Operazione cloud non verificata",
  );
  await page
    .getByRole("button", { name: "Ricarica dal cloud" })
    .first()
    .click();
  await expect(page.getByText("La tua collezione inizia qui")).toBeVisible();
  await page.getByRole("button", { name: "+ Aggiungi pipa" }).click();
  await page.getByLabel("Marca *").fill("Network");
  await page.getByLabel("Modello *").fill("Uncertain");
  api.loseWrite();
  await page.getByRole("button", { name: "Salva scheda", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Operazione cloud non verificata",
  );
  expect(api.rows).toHaveLength(1);
  await expect(page.getByLabel("Modello *")).toHaveValue("Uncertain");
  await page.getByRole("button", { name: "Salva scheda", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "ID esiste già",
  );
  expect(api.rows).toHaveLength(1);
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  await page
    .getByRole("button", { name: "Ricarica dal cloud" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Network Uncertain" }),
  ).toBeVisible();
});

test("expired API session hides data and an edit conflict cannot overwrite a newer record", async ({
  page,
}) => {
  const api = await cloudMock(page, [row()]);
  await page.goto("/");
  await signIn(page);
  await page.getByRole("button", { name: "Visualizza / Modifica →" }).click();
  api.rows[0].updated_at = "2026-11-16T19:00:00.000Z";
  api.rows[0].model = "Newer version";
  await page.getByLabel("Modello *").fill("Stale change");
  await page.getByRole("button", { name: "Salva scheda", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "La scheda è stata modificata",
  );
  expect(api.rows[0].model).toBe("Newer version");
  await page.getByRole("button", { name: "Annulla", exact: true }).click();
  api.expire();
  await page
    .getByRole("button", { name: "Ricarica dal cloud" })
    .first()
    .click();
  await expect(page.getByText(/Accedi dalla sezione Account/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Peterson 999" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});

test("logout hides the account catalogue before the logout network request completes", async ({
  page,
}) => {
  const api = await cloudMock(page, [row()]);
  await page.goto("/");
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Peterson 999" }),
  ).toBeVisible();
  const release = api.pauseNextLogout();
  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Peterson 999" })).toHaveCount(
    0,
  );
  await expect(page.getByText(/Accedi dalla sezione Account/)).toBeVisible();
  release();
  await expect(page.getByLabel("Email", { exact: true })).toBeEnabled();
});

test("migration readback failure is reported and repeating verifies the existing record", async ({
  page,
}) => {
  const api = await cloudMock(page);
  await page.goto("/");
  await signIn(page);
  await expect(page.getByText("La tua collezione inizia qui")).toBeVisible();
  await page.getByLabel("Importa dati JSON", { exact: true }).setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "tobacco-journal-pipes",
        version: 1,
        pipes: [LEGACY],
      }),
    ),
  });
  api.failNext("GET");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Conferma trasferimento delle schede" })
    .click();
  await expect(page.getByText(/Schede verificate nel cloud: 0/)).toBeVisible();
  await expect(page.getByText(/Conflitti o errori: 1/)).toBeVisible();
  expect(api.rows).toHaveLength(1);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Conferma trasferimento delle schede" })
    .click();
  await expect(page.getByText(/Schede verificate nel cloud: 1/)).toBeVisible();
  expect(api.rows).toHaveLength(1);
});

test("malformed local data and denied localStorage access remain untouched", async ({
  page,
}) => {
  await cloudMock(page);
  await page.addInitScript(() =>
    localStorage.setItem("tj-pipes-v1", "{broken"),
  );
  await page.goto("/");
  await signIn(page);
  await page
    .getByRole("button", { name: "Prepara importazione dal browser" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Il file non è un backup",
  );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Scarica dati originali per recupero" })
    .click();
  expect(await readFile((await (await downloaded).path())!, "utf8")).toBe(
    "{broken",
  );
  expect(await page.evaluate(() => localStorage.getItem("tj-pipes-v1"))).toBe(
    "{broken",
  );
  await page.evaluate(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === "tj-pipes-v1")
        throw new DOMException("denied", "SecurityError");
      return get.call(this, key);
    };
  });
  await page
    .getByRole("button", { name: "Prepara importazione dal browser" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Impossibile leggere il catalogo locale",
  );
});

test("token expiry hides cached cloud data even when Auth refresh cannot reach the network", async ({
  page,
}) => {
  await page.clock.install();
  const api = await cloudMock(page, [row()]);
  await page.goto("/");
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Peterson 999" }),
  ).toBeVisible();
  api.blockRefresh();
  await page.clock.fastForward(3601 * 1000);
  await expect(page.getByText(/Accedi dalla sezione Account/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Peterson 999" })).toHaveCount(
    0,
  );
});
