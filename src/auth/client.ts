import { createClient } from "@supabase/supabase-js";
import { authConfig } from "./config";

export const configuration = authConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
export const supabase =
  configuration.status === "configured"
    ? createClient(configuration.url, configuration.key, {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: false,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;

// Fixed same-origin destinations: never accept a URL from query parameters.
export function callbackUrl(recovery = false) {
  return `${window.location.origin}/auth/${recovery ? "recovery" : "callback"}`;
}
