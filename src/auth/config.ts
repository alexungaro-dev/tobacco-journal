export function authConfig(url?: string, key?: string) {
  if (!url && !key) return { status: "missing" as const };
  try {
    const parsed = new URL(url || "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (
      (parsed.protocol !== "https:" &&
        !(local && parsed.protocol === "http:")) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    )
      throw Error();
    // Only public publishable keys or legacy anon JWTs are accepted. Never admin keys.
    let publicKey = key?.startsWith("sb_publishable_") === true;
    if (key?.split(".").length === 3) {
      const payload = JSON.parse(
        atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      publicKey = payload.role === "anon";
    }
    if (!publicKey) throw Error();
    return { status: "configured" as const, url: parsed.origin, key: key! };
  } catch {
    return { status: "invalid" as const };
  }
}

export function authErrorKey(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  switch (code) {
    case "invalid_credentials":
      return "auth.errors.credentials";
    case "email_not_confirmed":
      return "auth.errors.unconfirmed";
    case "weak_password":
      return "auth.errors.password";
    case "same_password":
      return "auth.errors.samePassword";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "auth.errors.rateLimit";
    case "otp_expired":
    case "flow_state_expired":
    case "flow_state_not_found":
    case "bad_code_verifier":
      return "auth.errors.callback";
    default:
      return "auth.errors.generic";
  }
}
