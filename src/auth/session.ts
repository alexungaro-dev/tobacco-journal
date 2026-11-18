import type { SupabaseClient } from "@supabase/supabase-js";
const RECOVERY_KEY = "tj-auth-recovery-user";
export function recoveryUser(): string | null {
  try {
    return sessionStorage.getItem(RECOVERY_KEY);
  } catch {
    return null;
  }
}
export function setRecoveryUser(id: string | null) {
  try {
    if (id) sessionStorage.setItem(RECOVERY_KEY, id);
    else sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* Recovery still works for the current page without sessionStorage. */
  }
}

export async function restoreAccess(client: SupabaseClient) {
  const url = new URL(window.location.href);
  const callback = ["/auth/callback", "/auth/recovery"].includes(url.pathname);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const hasAuthParams =
    url.searchParams.has("code") ||
    url.searchParams.has("error") ||
    fragment.has("access_token") ||
    fragment.has("error");
  if (callback || hasAuthParams) {
    // Remove credentials/errors from the address bar before asynchronous work.
    window.history.replaceState(null, "", "/#dashboard");
    const code = url.searchParams.get("code");
    if (
      !callback ||
      !code ||
      url.searchParams.has("error") ||
      fragment.has("access_token") ||
      fragment.has("error")
    ) {
      throw new Error("invalid_callback");
    }
    const flowId = url.searchParams.get("sb_flow_id");
    if (flowId !== null && !/^[a-f0-9]{32}$/.test(flowId))
      throw new Error("invalid_callback");
    let recovery = false;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") recovery = true;
    });
    const { data, error } = await client.auth
      .exchangeCodeForSession(code, flowId ? { flowId } : undefined)
      .finally(() => subscription.unsubscribe());
    if (error || !data.session) throw new Error("invalid_callback");
    if (url.pathname === "/auth/recovery" && !recovery)
      throw new Error("invalid_callback");
    setRecoveryUser(recovery ? data.session.user.id : null);
    return {
      session: data.session,
      recovery,
      message: recovery ? "" : "auth.confirmed",
    };
  }
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const recovery = !!data.session && recoveryUser() === data.session.user.id;
  if (!recovery) setRecoveryUser(null);
  return { session: data.session, recovery, message: "" };
}

// INSERT ... ON CONFLICT DO NOTHING: never overwrite an existing locale or name.
export async function ensureProfile(
  client: SupabaseClient,
  id: string,
  locale: string,
) {
  const { error } = await client
    .from("profiles")
    .upsert(
      { id, preferred_locale: locale.startsWith("it") ? "it" : "en" },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (error) throw error;
}
