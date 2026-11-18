import { expect, type Page } from "@playwright/test";
export const AUTH_ORIGIN = "https://auth-test.supabase.co";
export const OWNER_A = "11111111-1111-1111-1111-111111111111";
export const OWNER_B = "22222222-2222-2222-2222-222222222222";
export const PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoEFEBAAHQALnTUbepAAAAAElFTkSuQmCC";
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
export function tobaccoRow(owner = OWNER_A, id = "t1", name = "Mixture") {
  return {
    id,
    user_id: owner,
    brand: "Example",
    name,
    blend_type: "English",
    notes: null,
    extra: { status: "sealed", remaining: 40 } as Record<string, unknown>,
    created_at: "2026-11-16T16:00:00.000Z",
    updated_at: "2026-11-16T16:00:00.000Z",
  };
}
export function cigarRow(owner = OWNER_A, id = "c1", name = "Reserva") {
  return {
    id,
    user_id: owner,
    brand: "Example",
    name,
    vitola: "Toro",
    notes: null,
    extra: { country: "Honduras", remaining: 12 } as Record<string, unknown>,
    created_at: "2026-11-16T16:00:00.000Z",
    updated_at: "2026-11-16T16:00:00.000Z",
  };
}
export function journalRow(owner = OWNER_A, id = "j1", name = "Private cigar") {
  return {
    id,
    user_id: owner,
    kind: "cigar",
    pipe_id: null,
    tobacco_id: null,
    cigar_id: null,
    started_at: "2026-11-18T19:00:00.000Z",
    ended_at: null,
    rating: null,
    notes: null,
    extra: { product: { source: "other", brand: "Guest", name } } as Record<
      string,
      unknown
    >,
    created_at: "2026-11-16T16:00:00.000Z",
    updated_at: "2026-11-16T16:00:00.000Z",
  };
}
export async function cloudMock(
  page: Page,
  initial: ReturnType<typeof row>[] = [],
  initialTobaccos: ReturnType<typeof tobaccoRow>[] = [],
  initialCigars: ReturnType<typeof cigarRow>[] = [],
  initialSessions: ReturnType<typeof journalRow>[] = [],
) {
  const rows = structuredClone(initial);
  const tobaccos = structuredClone(initialTobaccos);
  const cigars = structuredClone(initialCigars);
  const sessions = structuredClone(initialSessions);
  const receipts = new Map<string, string>();
  const stockPreferences = new Map<
    string,
    { stock_alerts_enabled: boolean; cigar_low_stock_threshold: number }
  >();
  let loseSession = false;
  const objects = new Map<string, { bytes: Buffer; type: string }>();
  const media: Record<string, any>[] = [];
  let photoFault = "";
  let holdUpload: Promise<void> | undefined;
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
    const storage = url.pathname.startsWith("/storage/v1/object");
    const body = storage && method === "POST" ? null : request.postDataJSON();
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
      if (method === "POST") {
        status = 201;
        data = null;
      } else if (!owner || url.searchParams.get("id") !== `eq.${owner}`) {
        status = 403;
        data = { code: "42501" };
      } else {
        const current = stockPreferences.get(owner) ?? {
          stock_alerts_enabled: true,
          cigar_low_stock_threshold: 3,
        };
        data = method === "PATCH" ? { ...current, ...body } : current;
        if (method === "PATCH") stockPreferences.set(owner, data);
      }
    } else if (storage) {
      const root = "/storage/v1/object/journal-photos";
      const path = decodeURIComponent(url.pathname.slice(root.length + 1));
      const paths: string[] = method === "DELETE" ? body.prefixes : [path];
      if (
        !owner ||
        !url.pathname.startsWith(root) ||
        !paths.every((p) => p.startsWith(owner + "/"))
      ) {
        status = 403;
        data = { message: "RLS" };
      } else if (method === "POST") {
        if (holdUpload) {
          const held = holdUpload;
          holdUpload = undefined;
          await held;
        }
        if (photoFault === "upload") {
          photoFault = "";
          await route.abort("failed");
          return;
        }
        if (objects.has(path)) {
          status = 409;
          data = { message: "Exists" };
        } else {
          objects.set(path, {
            bytes: request.postDataBuffer()!,
            type: headers["content-type"],
          });
          data = { Id: path, Key: path };
        }
        if (photoFault === "lost-upload") {
          photoFault = "";
          await route.abort("failed");
          return;
        }
      } else if (method === "GET") {
        const object = objects.get(path);
        if (object) {
          await route
            .fulfill({ contentType: object.type, body: object.bytes })
            .catch(() => {});
          return;
        }
        status = 404;
        data = { message: "Missing object" };
      } else if (method === "DELETE") {
        if (photoFault === "cleanup") {
          photoFault = "";
          status = 500;
          data = { message: "File cleanup unavailable" };
        } else {
          paths.forEach((p) => objects.delete(p));
          data = paths.map((name) => ({ name }));
        }
      }
    } else if (url.pathname === "/rest/v1/rpc/record_smoking_session") {
      const { entry, stock } = body;
      const key = owner + "/" + entry.id;
      const prior = receipts.get(key);
      const existing = sessions.find(
        (row) => row.user_id === owner && row.id === entry.id,
      );
      const expected = JSON.stringify(body);
      const inventory = stock?.kind === "cigar" ? cigars : tobaccos;
      const product = inventory.find(
        (row) =>
          row.user_id === owner &&
          row.id ===
            (stock?.kind === "cigar" ? entry.cigar_id : entry.tobacco_id),
      );
      if (!owner) {
        status = 403;
        data = { code: "42501" };
      } else if (prior && existing && prior === expected) {
        data = [existing];
      } else if (prior || existing) {
        status = 409;
        data = { code: "23505" };
      } else if (stock && (!product || stock.revision !== product.updated_at)) {
        status = 409;
        data = { code: "40001" };
      } else if (
        stock?.kind === "cigar" &&
        (!Number.isSafeInteger(product?.extra.remaining) ||
          (product?.extra.remaining as number) < 1)
      ) {
        status = 422;
        data = { code: "PT422" };
      } else {
        const timestamp = new Date(
          Date.UTC(2026, 10, 16, 17, 0, ++version),
        ).toISOString();
        const session = {
          ...entry,
          user_id: owner,
          created_at: timestamp,
          updated_at: timestamp,
        };
        sessions.push(session);
        receipts.set(key, expected);
        if (
          stock?.kind === "cigar" &&
          product &&
          typeof product.extra.remaining === "number" &&
          product.extra.remaining > 0
        ) {
          product.extra.remaining--;
          product.updated_at = timestamp;
          session.extra.stockOutcome = {
            kind: "cigar",
            remaining: product.extra.remaining,
          };
        } else if (stock?.kind === "tobacco" && product) {
          Object.assign(product.extra, stock.patch);
          product.updated_at = timestamp;
          session.extra.stockOutcome = {
            kind: "tobacco",
            remainingLevel: product.extra.remainingLevel ?? null,
          };
        }
        if (loseSession) {
          loseSession = false;
          await route.abort("failed");
          return;
        }
        data = [session];
      }
    } else if (url.pathname === "/rest/v1/smoking_sessions") {
      if (
        !owner ||
        (method === "POST"
          ? body.user_id !== owner
          : url.searchParams.get("user_id") !== `eq.${owner}`)
      ) {
        status = 403;
        data = { code: "42501" };
      } else {
        const id = url.searchParams.get("id");
        const revision = url.searchParams.get("updated_at");
        const selected = sessions.filter(
          (row) =>
            row.user_id === owner &&
            (!id ||
              (id.startsWith("eq.")
                ? row.id === id.slice(3)
                : row.id > id.slice(3))) &&
            (!revision || revision === `eq.${row.updated_at}`),
        );
        if (method === "GET") {
          data = selected.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2);
        } else if (method === "POST") {
          if (
            sessions.some((row) => row.user_id === owner && row.id === body.id)
          ) {
            status = 409;
            data = { code: "23505" };
          } else {
            const now = new Date(
              Date.UTC(2026, 10, 16, 17, 0, ++version),
            ).toISOString();
            const row = { ...body, created_at: now, updated_at: now };
            sessions.push(row);
            status = 201;
            data = row;
          }
        } else if (method === "PATCH") {
          const now = new Date(
            Date.UTC(2026, 10, 16, 17, 0, ++version),
          ).toISOString();
          selected.forEach((row) =>
            Object.assign(row, body, { updated_at: now }),
          );
          data = selected[0] ?? null;
        } else if (method === "DELETE") {
          data = selected.map(({ id }) => ({ id }));
          for (const row of selected) {
            sessions.splice(sessions.indexOf(row), 1);
            for (const item of media.filter(
              (item) =>
                item.user_id === owner && item.smoking_session_id === row.id,
            ))
              media.splice(media.indexOf(item), 1);
          }
        }
      }
    } else if (url.pathname === "/rest/v1/media") {
      const filters = [...url.searchParams].filter(([, value]) =>
        value.startsWith("eq."),
      );
      if (
        !owner ||
        (method === "POST"
          ? body.user_id !== owner ||
            !body.object_path.startsWith(owner + "/") ||
            !(body.smoking_session_id
              ? sessions.some(
                  (r) =>
                    r.user_id === owner && r.id === body.smoking_session_id,
                )
              : body.cigar_id
                ? cigars.some(
                    (r) => r.user_id === owner && r.id === body.cigar_id,
                  )
                : body.tobacco_id
                  ? tobaccos.some(
                      (r) => r.user_id === owner && r.id === body.tobacco_id,
                    )
                  : rows.some(
                      (r) => r.user_id === owner && r.id === body.pipe_id,
                    ))
          : url.searchParams.get("user_id") !== `eq.${owner}`)
      ) {
        status = 403;
        data = { code: "42501", message: "RLS" };
      } else if (method === "POST") {
        if (photoFault === "metadata") {
          photoFault = "";
          await route.abort("failed");
          return;
        }
        if (!media.some((m) => m.object_path === body.object_path))
          media.push(body);
        status = 201;
        data = null;
        if (photoFault === "lost-metadata") {
          photoFault = "";
          await route.abort("failed");
          return;
        }
      } else {
        const selected = media.filter(
          (m) =>
            m.user_id === owner &&
            filters.every(([key, value]) => m[key] === value.slice(3)) &&
            (!url.searchParams.has("object_path") ||
              !url.searchParams.get("object_path")?.startsWith("gt.") ||
              m.object_path > url.searchParams.get("object_path")!.slice(3)),
        );
        if (url.searchParams.has("order"))
          selected.sort((a, b) => a.object_path.localeCompare(b.object_path));
        if (method === "DELETE")
          selected.forEach((m) => media.splice(media.indexOf(m), 1));
        data = selected;
      }
    } else if (
      url.pathname === "/rest/v1/tobaccos" ||
      url.pathname === "/rest/v1/cigars"
    ) {
      const cigar = url.pathname.endsWith("/cigars");
      const inventory = cigar ? cigars : tobaccos;
      const link = cigar ? "cigar_id" : "tobacco_id";
      if (
        !owner ||
        (method !== "POST" &&
          url.searchParams.get("user_id") !== `eq.${owner}`) ||
        (body?.user_id && body.user_id !== owner)
      ) {
        status = 403;
        data = { code: "42501", message: "RLS" };
      } else if (fail === method) {
        fail = "";
        await route.abort("failed");
        return;
      } else {
        const revision = url.searchParams.get("updated_at");
        const id = url.searchParams.get("id");
        const selected = inventory.filter(
          (r) =>
            r.user_id === owner &&
            (!id ||
              (id.startsWith("eq.")
                ? r.id === id.slice(3)
                : r.id > id.slice(3))) &&
            (!revision || revision === `eq.${r.updated_at}`),
        );
        const now = () =>
          new Date(Date.UTC(2026, 10, 16, 17, 0, ++version)).toISOString();
        if (method === "GET") {
          data = selected.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2);
        } else if (method === "POST") {
          if (inventory.some((r) => r.user_id === owner && r.id === body.id)) {
            status = 409;
            data = { code: "23505", message: "Duplicate" };
          } else {
            const timestamp = now();
            const entry = {
              ...body,
              created_at: timestamp,
              updated_at: timestamp,
            };
            inventory.push(entry);
            status = 201;
            data = entry;
          }
        } else if (method === "PATCH") {
          selected.forEach((entry) =>
            Object.assign(entry, body, { updated_at: now() }),
          );
          data = selected[0] ?? null;
        } else if (method === "DELETE") {
          data = selected.map(({ id }) => ({ id }));
          for (const entry of selected) {
            inventory.splice(inventory.indexOf(entry), 1);
            for (const item of media.filter(
              (m) => m.user_id === owner && m[link] === entry.id,
            ))
              media.splice(media.indexOf(item), 1);
          }
        }
      }
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
          if (photoFault === "lost-pipe") {
            photoFault = "";
            await route.abort("failed");
            return;
          }
        } else if (method === "DELETE") {
          data = selected.map((r) => ({ id: r.id }));
          for (const r of selected) {
            rows.splice(rows.indexOf(r), 1);
            for (const item of media.filter(
              (m) => m.user_id === owner && m.pipe_id === r.id,
            ))
              media.splice(media.indexOf(item), 1);
          }
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
    tobaccos,
    cigars,
    sessions,
    stockPreferences,
    loseSessionWrite: () => {
      loseSession = true;
    },
    requests,
    objects,
    media,
    failPhoto: (stage: string) => {
      photoFault = stage;
    },
    pauseUpload: () => {
      let release!: () => void;
      holdUpload = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
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
