import { expect, type Page } from "@playwright/test";
export const AUTH_ORIGIN = "https://auth-test.supabase.co";
export const OWNER_A = "11111111-1111-1111-1111-111111111111";
export const OWNER_B = "22222222-2222-2222-2222-222222222222";
export const PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII=";
export const LEGACY = {
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
  photo: PHOTO,
  createdAt: "2025-01-01",
  custom: { retained: true },
};
export function authSession(owner = OWNER_A, email = "reader@example.test") {
  const now = Math.floor(Date.now() / 1000);
  const token = Buffer.from(
    JSON.stringify({
      sub: owner,
      role: "authenticated",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  return {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.synthetic`,
    refresh_token: `refresh-${owner}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: owner,
      aud: "authenticated",
      role: "authenticated",
      email,
      email_confirmed_at: "2026-01-01T00:00:00Z",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}
export function row(owner = OWNER_A, pipe: Record<string, unknown> = LEGACY) {
  return {
    id: pipe.id,
    user_id: owner,
    brand: pipe.brand,
    model: pipe.model,
    shape: pipe.shape ?? null,
    material: pipe.material ?? null,
    filter: pipe.filter ?? null,
    status: pipe.status ?? null,
    acquired_on: pipe.date ?? null,
    price: pipe.price ?? null,
    notes: pipe.notes ?? null,
    legacy_payload: structuredClone(pipe),
    created_at: "2026-11-16T16:00:00.000Z",
    updated_at: "2026-11-16T16:00:00.000Z",
  };
}
export async function cloudMock(
  page: Page,
  initial: ReturnType<typeof row>[] = [],
) {
  const rows = structuredClone(initial);
  const requests: {
    method: string;
    path: string;
    body: any;
    owner: string | null;
    headers: Record<string, string>;
  }[] = [];
  let refreshOffline = false;
  let fail = "",
    lostWrite = false,
    unauthorized = false;
  let pause: { wait: Promise<void>; release: () => void } | null = null;
  let logoutPause: { wait: Promise<void>; release: () => void } | null = null;
  let version = 0;
  await page.route(`${AUTH_ORIGIN}/**`, async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    const body = request.postDataJSON();
    const headers = request.headers();
    let owner: string | null = null;
    try {
      owner = JSON.parse(
        Buffer.from(
          headers.authorization.split(".")[1],
          "base64url",
        ).toString(),
      ).sub;
    } catch {}
    requests.push({
      method,
      path: url.pathname + url.search,
      body,
      owner,
      headers,
    });
    let data: any = {},
      status = 200;
    if (url.pathname === "/auth/v1/logout" && logoutPause) {
      const held = logoutPause;
      logoutPause = null;
      await held.wait;
    }
    if (
      url.pathname === "/auth/v1/token" &&
      url.searchParams.get("grant_type") === "refresh_token" &&
      refreshOffline
    ) {
      await route.abort("failed");
      return;
    }
    if (url.pathname === "/auth/v1/token")
      data = authSession(
        body.email === "other@example.test" ? OWNER_B : OWNER_A,
        body.email,
      );
    else if (url.pathname === "/auth/v1/user")
      data = authSession(owner || OWNER_A).user;
    else if (url.pathname === "/rest/v1/profiles") {
      status = 201;
      data = null;
    } else if (url.pathname === "/rest/v1/pipes") {
      if (unauthorized) {
        status = 401;
        data = { code: "PGRST301", message: "expired" };
      } else if (
        !owner ||
        (url.searchParams.get("user_id") !== `eq.${owner}` &&
          method !== "POST") ||
        (body?.user_id && body.user_id !== owner)
      ) {
        status = 403;
        data = { code: "42501", message: "RLS" };
      } else {
        if (fail === method) {
          fail = "";
          await route.abort("failed");
          return;
        }
        const id = url.searchParams.get("id");
        const revision = url.searchParams.get("updated_at");
        let selected = rows.filter(
          (r) =>
            r.user_id === owner &&
            (!id ||
              (id.startsWith("eq.") && r.id === id.slice(3)) ||
              (id?.startsWith("gt.") && String(r.id) > id.slice(3))) &&
            (!revision || r.updated_at === revision.slice(3)),
        );
        if (method === "GET") {
          selected.sort((a, b) => String(a.id).localeCompare(String(b.id)));
          // Deliberately cap below the client's requested limit to exercise keyset paging.
          data = structuredClone(
            selected.slice(
              0,
              Math.min(Number(url.searchParams.get("limit") || 100), 2),
            ),
          );
          if (pause) {
            const held = pause;
            pause = null;
            await held.wait;
          }
        } else if (method === "POST") {
          const exists = rows.find(
            (r) => r.user_id === owner && r.id === body.id,
          );
          if (
            exists &&
            !headers.prefer?.includes("resolution=ignore-duplicates")
          ) {
            status = 409;
            data = { code: "23505", message: "duplicate" };
          } else if (!exists) {
            const next = row(owner!, body.legacy_payload);
            Object.assign(next, body);
            next.updated_at = new Date(
              Date.UTC(2026, 10, 16, 17, 0, ++version),
            ).toISOString();
            rows.push(next);
            data = headers.prefer?.includes("return=representation")
              ? next
              : null;
            status = 201;
          } else {
            data = null;
            status = 201;
          }
          if (lostWrite) {
            lostWrite = false;
            await route.abort("failed");
            return;
          }
        } else if (method === "PATCH") {
          for (const r of selected)
            Object.assign(r, body, {
              updated_at: new Date(
                Date.UTC(2026, 10, 16, 17, 0, ++version),
              ).toISOString(),
            });
          data = selected.length === 1 ? selected[0] : null;
        } else if (method === "DELETE") {
          data = selected.map((r) => ({ id: r.id }));
          for (const r of selected) rows.splice(rows.indexOf(r), 1);
        }
      }
    }
    // maybeSingle GET accepts arrays; mutation responses use the object media type.
    if (
      method !== "GET" &&
      headers.accept?.includes("vnd.pgrst.object") &&
      Array.isArray(data)
    )
      data = data[0] ?? null;
    try {
      await route.fulfill({
        status,
        contentType: "application/json",
        headers: {
          "x-supabase-api-version": "2024-01-01",
          "access-control-expose-headers": "x-supabase-api-version",
        },
        body: JSON.stringify(data),
      });
    } catch {
      /* request cancelled during logout */
    }
  });
  return {
    rows,
    requests,
    failNext: (method: string) => {
      fail = method;
    },
    loseWrite: () => {
      lostWrite = true;
    },
    blockRefresh: () => {
      refreshOffline = true;
    },
    expire: () => {
      unauthorized = true;
    },
    pauseNextLogout: () => {
      let release!: () => void;
      const wait = new Promise<void>((r) => {
        release = r;
      });
      logoutPause = { wait, release };
      return release;
    },
    pauseNextRead: () => {
      let release!: () => void;
      const wait = new Promise<void>((r) => {
        release = r;
      });
      pause = { wait, release };
      return release;
    },
  };
}
export async function signIn(page: Page, email = "reader@example.test") {
  const account = page.locator(".account");
  if (!(await account.evaluate((e) => (e as HTMLDetailsElement).open)))
    await account.locator("summary").click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("A-long-synthetic-password-123");
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await expect(page.getByText(`Accesso come ${email}`)).toBeVisible();
}
