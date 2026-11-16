import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authConfig, authErrorKey } from "../src/auth/config";
import {
  ensureProfile,
  restoreAccess,
  recoveryUser,
} from "../src/auth/session";
import it from "../src/locales/it.json";
import en from "../src/locales/en.json";

test("configuration permits only public keys and safe project URLs", () => {
  assert.equal(authConfig().status, "missing");
  for (const key of [
    "sb_secret_never_use",
    "invalid",
    `e30.${btoa('{"role":"service_role"}')}.x`,
  ])
    assert.equal(
      authConfig("https://example.supabase.co", key).status,
      "invalid",
    );
  for (const url of [
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com?key=x",
  ])
    assert.equal(authConfig(url, "sb_publishable_test").status, "invalid");
  assert.equal(
    authConfig("https://example.supabase.co", "sb_publishable_test").status,
    "configured",
  );
  assert.equal(
    authConfig("http://127.0.0.1:54321", `e30.${btoa('{"role":"anon"}')}.x`)
      .status,
    "configured",
  );
});
test("errors use translated safe messages without exposing server details", () => {
  assert.equal(
    authErrorKey({
      code: "invalid_credentials",
      message: "private server detail",
    }),
    "auth.errors.credentials",
  );
  assert.equal(authErrorKey(new Error("secret")), "auth.errors.generic");
  assert.equal(
    authErrorKey({ code: "email_not_confirmed" }),
    "auth.errors.unconfirmed",
  );
  assert.deepEqual(Object.keys(it.auth).sort(), Object.keys(en.auth).sort());
  assert.deepEqual(
    Object.keys(it.auth.errors).sort(),
    Object.keys(en.auth.errors).sort(),
  );
});
test("profile insertion ignores existing rows instead of updating preferences", async () => {
  let received: unknown[] = [];
  const fake = {
    from(table: string) {
      assert.equal(table, "profiles");
      return {
        async upsert(...args: unknown[]) {
          received = args;
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  await ensureProfile(fake, "user-id", "it-IT");
  assert.deepEqual(received, [
    { id: "user-id", preferred_locale: "it" },
    { onConflict: "id", ignoreDuplicates: true },
  ]);
  const failing = {
    from: () => ({ upsert: async () => ({ error: new Error("db down") }) }),
  } as unknown as SupabaseClient;
  await assert.rejects(() => ensureProfile(failing, "user-id", "en"));
});
function browser(url: string) {
  const storage = new Map<string, string>();
  let cleaned = "";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { href: url },
      history: {
        replaceState: (_a: unknown, _b: string, path: string) => {
          cleaned = path;
        },
      },
    },
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
  });
  return () => cleaned;
}
test("PKCE recovery is recognized from verified exchange, URL is scrubbed and marker restores", async () => {
  const cleaned = browser(
    "https://preview.example/auth/recovery?code=single-use-code",
  );
  const session = { user: { id: "owner" } };
  let listener: (event: string) => void = () => {};
  const fake = {
    auth: {
      onAuthStateChange: (callback: (event: string) => void) => {
        listener = callback;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      exchangeCodeForSession: async (code: string) => {
        assert.equal(code, "single-use-code");
        assert.equal(cleaned(), "/#pipes");
        listener("PASSWORD_RECOVERY");
        return { data: { session }, error: null };
      },
      getSession: async () => ({ data: { session }, error: null }),
    },
  } as unknown as SupabaseClient;
  assert.equal((await restoreAccess(fake)).recovery, true);
  assert.equal(recoveryUser(), "owner");
  window.location.href = "https://preview.example/#pipes";
  assert.equal((await restoreAccess(fake)).recovery, true);
});
test("invalid, implicit and spoofed recovery URLs never authorize a password reset", async () => {
  const fake = {
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      exchangeCodeForSession: async () => ({
        data: { session: { user: { id: "owner" } } },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
  for (const path of [
    "/auth/recovery",
    "/auth/recovery?code=normal-confirmation",
    "/auth/callback#error=access_denied",
    "/auth/callback#access_token=untrusted",
    "/?code=untrusted",
  ]) {
    const cleaned = browser("https://preview.example" + path);
    await assert.rejects(() => restoreAccess(fake), /invalid_callback/);
    assert.equal(cleaned(), "/#pipes");
    assert.equal(recoveryUser(), null);
  }
});
