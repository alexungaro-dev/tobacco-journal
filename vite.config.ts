import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { authConfig } from "./src/auth/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  if (
    authConfig(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY).status ===
    "invalid"
  ) {
    // Stop before bundling: a rejected secret would still leak if embedded in JS.
    throw new Error(
      "Invalid Supabase frontend configuration. Use a project URL and a public publishable/anon key. Never use an admin or secret key.",
    );
  }
  return { plugins: [react()] };
});
