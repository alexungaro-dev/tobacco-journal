import { test, expect, type Page } from "@playwright/test";
const id = "11111111-1111-1111-1111-111111111111";
const origin = "https://auth-test.supabase.co";
const email = "reader@example.test";
const password = "A-long-test-password-123";
const user = {
  id,
  aud: "authenticated",
  role: "authenticated",
  email,
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
function session(expires = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: id, role: "authenticated", iat: now, exp: now + expires })).toString("base64url")}.test-signature`;
  return {
    access_token: jwt,
    refresh_token: "synthetic-refresh-token",
    token_type: "bearer",
    expires_in: expires,
    expires_at: now + expires,
    user,
  };
}
async function mock(
  page: Page,
  options: {
    invalid?: boolean;
    profileFails?: boolean;
    expired?: boolean;
  } = {},
) {
  const requests: {
    path: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }[] = [];
  let profileFails = options.profileFails;
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const body = request.postDataJSON() || {};
    requests.push({
      path: url.pathname + url.search,
      body,
      headers: request.headers(),
    });
    let status = 200;
    let result: unknown = {};
    if (url.pathname === "/auth/v1/token") {
      if (
        options.expired &&
        url.searchParams.get("grant_type") === "refresh_token"
      ) {
        status = 400;
        result = {
          code: "refresh_token_not_found",
          msg: "Refresh token revoked",
        };
      } else if (
        options.invalid &&
        url.searchParams.get("grant_type") === "password"
      ) {
        status = 400;
        result = {
          code: "invalid_credentials",
          msg: "Raw private server message",
        };
      } else result = session();
    } else if (url.pathname === "/rest/v1/pipes") result = [];
    else if (url.pathname === "/auth/v1/signup")
      result = { user: { ...user, email_confirmed_at: null }, session: null };
    else if (url.pathname === "/auth/v1/user") result = user;
    else if (url.pathname === "/rest/v1/profiles") {
      if (profileFails) {
        status = 503;
        result = { message: "DB unavailable" };
      } else {
        status = 201;
        result = null;
      }
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      headers: {
        "x-supabase-api-version": "2024-01-01",
        "access-control-expose-headers": "x-supabase-api-version",
      },
      body: JSON.stringify(result),
    });
  });
  return {
    requests,
    allowProfile: () => {
      profileFails = false;
    },
  };
}
async function openAccount(page: Page) {
  await page.goto("/#pipes");
  await page.locator(".account summary").click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
}
async function login(page: Page) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
}

test("login, profile retry, session reload and logout preserve local catalogue", async ({
  page,
}) => {
  const api = await mock(page, { profileFails: true });
  const pipes = JSON.stringify([
    { id: "legacy", brand: "Peterson", model: "999", extra: "retained" },
  ]);
  await page.addInitScript((value) => {
    if (!localStorage.getItem("tj-pipes-v1"))
      localStorage.setItem("tj-pipes-v1", value);
  }, pipes);
  await openAccount(page);
  await login(page);
  await expect(page.getByText(`Accesso come ${email}`)).toBeVisible();
  await expect(
    page.getByText(/non è stato possibile preparare il profilo/),
  ).toBeVisible();
  api.allowProfile();
  await page.getByRole("button", { name: "Riprova creazione profilo" }).click();
  await expect(
    page.getByText(/non è stato possibile preparare il profilo/),
  ).toHaveCount(0);
  const profile = api.requests
    .filter((r) => r.path.startsWith("/rest/v1/profiles"))
    .at(-1)!;
  expect(profile.body).toEqual({ id, preferred_locale: "it" });
  expect(profile.headers.prefer).toContain("resolution=ignore-duplicates");
  await page.reload();
  await page.locator(".account summary").click();
  await expect(page.getByText(`Accesso come ${email}`)).toBeVisible();
  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("tj-pipes-v1"))).toBe(
    pipes,
  );
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain(password);
  await expect(page.getByRole("heading", { name: "Peterson 999" })).toHaveCount(
    0,
  );
  expect(
    api.requests.some((r) => r.path === "/auth/v1/logout?scope=local"),
  ).toBeTruthy();
});

test("translated login errors do not reveal raw server details; form works on mobile", async ({
  page,
}) => {
  await mock(page, { invalid: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await openAccount(page);
  await login(page);
  await expect(page.getByRole("alert")).toContainText(
    "Email o password non corretti",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByRole("alert")).toContainText(
    "Email or password incorrect",
  );
  await expect(page.getByText("Raw private server message")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/auth-mobile.png",
    fullPage: true,
  });
});

test("signup requires confirmation and recovery uses fixed same-origin callbacks", async ({
  page,
}) => {
  const api = await mock(page);
  await openAccount(page);
  await page.getByRole("button", { name: "Registrati", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByLabel("Conferma password", { exact: true })
    .fill(password + "mismatch");
  await page.getByRole("button", { name: "Registrati", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("non coincidono");
  expect(
    api.requests.some((r) => r.path.startsWith("/auth/v1/signup")),
  ).toBeFalsy();
  await page.getByLabel("Conferma password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Registrati", exact: true }).click();
  await expect(page.locator(".account").getByRole("status")).toContainText(
    "Controlla la posta",
  );
  const signup = api.requests.find((r) =>
    r.path.startsWith("/auth/v1/signup"),
  )!;
  expect(signup.path).toContain(
    encodeURIComponent("http://127.0.0.1:5173/auth/callback"),
  );
  expect(signup.body.code_challenge).toBeTruthy();
  expect(
    api.requests.some((r) => r.path.startsWith("/rest/v1/profiles")),
  ).toBeFalsy();
  await page
    .getByRole("button", { name: "Recupera password", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recupera password", exact: true })
    .click();
  await expect(page.locator(".account").getByRole("status")).toContainText(
    "Se l’indirizzo è registrato",
  );
  expect(
    api.requests.find((r) => r.path.startsWith("/auth/v1/recover"))!.path,
  ).toContain(encodeURIComponent("http://127.0.0.1:5173/auth/recovery"));
});

test("PKCE password recovery, reload and password update; invalid callbacks are scrubbed", async ({
  page,
}) => {
  const api = await mock(page);
  await openAccount(page);
  await page
    .getByRole("button", { name: "Recupera password", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Recupera password", exact: true })
    .click();
  await expect(page.locator(".account").getByRole("status")).toContainText(
    "Se l’indirizzo è registrato",
  );
  const request = api.requests.find((r) =>
    r.path.startsWith("/auth/v1/recover"),
  )!;
  const redirect = new URL(
    new URL(origin + request.path).searchParams.get("redirect_to")!,
  );
  redirect.searchParams.set("code", "synthetic-code");
  await page.goto(redirect.pathname + redirect.search);
  await expect(
    page.getByRole("heading", { name: "Scegli una nuova password" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/#dashboard$/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Scegli una nuova password" }),
  ).toBeVisible();
  await page.getByLabel("Nuova password", { exact: true }).fill(password);
  await page.getByLabel("Conferma password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Salva nuova password" }).click();
  await expect(page.locator(".account").getByRole("status")).toContainText(
    "Password aggiornata",
  );
  expect(
    api.requests.some(
      (r) => r.path === "/auth/v1/user" && r.body.password === password,
    ),
  ).toBeTruthy();
  expect(
    await page.evaluate(() => sessionStorage.getItem("tj-auth-recovery-user")),
  ).toBeNull();
  await page.goto(
    "/auth/recovery#error=access_denied&error_description=sensitive",
  );
  await expect(page.getByRole("alert")).toContainText("Il link non è valido");
  await expect(page).toHaveURL(/\/#dashboard$/);
});

test("expired stored session refreshes before restoring access", async ({
  page,
}) => {
  const api = await mock(page);
  await page.addInitScript(
    (value) =>
      localStorage.setItem("sb-auth-test-auth-token", JSON.stringify(value)),
    session(-10),
  );
  await page.goto("/#pipes");
  await page.locator(".account summary").click();
  await expect(page.getByText(`Accesso come ${email}`)).toBeVisible();
  expect(
    api.requests.some((r) => r.path.includes("grant_type=refresh_token")),
  ).toBeTruthy();
});

test("email confirmation exchanges PKCE code only once and creates a profile after access", async ({
  page,
}) => {
  const api = await mock(page);
  await openAccount(page);
  await page.getByRole("button", { name: "Registrati", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Conferma password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Registrati", exact: true }).click();
  await expect(page.locator(".account").getByRole("status")).toContainText(
    "Controlla la posta",
  );
  const signup = api.requests.find((r) =>
    r.path.startsWith("/auth/v1/signup"),
  )!;
  const redirect = new URL(
    new URL(origin + signup.path).searchParams.get("redirect_to")!,
  );
  redirect.searchParams.set("code", "confirmation-code");
  await page.goto(redirect.pathname + redirect.search);
  await expect(
    page.getByText("Email confermata. Accesso effettuato.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(`Accesso come ${email}`)).toBeVisible();
  expect(
    api.requests.filter((r) => r.path.includes("grant_type=pkce")),
  ).toHaveLength(1);
  await expect
    .poll(
      () =>
        api.requests.filter((r) => r.path.startsWith("/rest/v1/profiles"))
          .length,
    )
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "test-results/auth-desktop.png",
    fullPage: true,
  });
});

test("revoked refresh token returns to login without touching local data", async ({
  page,
}) => {
  await mock(page, { expired: true });
  await page.addInitScript((value) => {
    localStorage.setItem("sb-auth-test-auth-token", JSON.stringify(value));
    localStorage.setItem("tj-pipes-v1", "[]");
  }, session(-10));
  await page.goto("/#pipes");
  await page.locator(".account summary").click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("tj-pipes-v1"))).toBe(
    "[]",
  );
  await expect(page.getByText(`Accesso come ${email}`)).toHaveCount(0);
});

test("logout propagates to another tab", async ({ page, context }) => {
  await mock(page);
  await openAccount(page);
  await login(page);
  await expect(page.getByText(`Accesso come ${email}`)).toBeVisible();
  const other = await context.newPage();
  await mock(other);
  await openAccountSignedIn(other);
  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await expect(other.getByLabel("Email", { exact: true })).toBeVisible();
  await other.close();
});
async function openAccountSignedIn(page: Page) {
  await page.goto("/#pipes");
  await page.locator(".account summary").click();
  await expect(page.getByText(`Accesso come ${email}`)).toBeVisible();
}

test("confirmation resend uses Auth API without creating a profile", async ({
  page,
}) => {
  const api = await mock(page);
  await openAccount(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Invia di nuovo la conferma email" })
    .click();
  await expect(page.locator(".account").getByRole("status")).toContainText(
    "Controlla la posta",
  );
  const resend = api.requests.find((r) =>
    r.path.startsWith("/auth/v1/resend"),
  )!;
  expect(resend.body.type).toBe("signup");
  expect(resend.body.email).toBe(email);
  expect(
    api.requests.some((r) => r.path.startsWith("/rest/v1/profiles")),
  ).toBeFalsy();
});
