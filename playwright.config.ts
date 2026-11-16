import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:5173",
    locale: "it-IT",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    env: {
      // Synthetic public configuration; all Auth tests intercept this host.
      VITE_SUPABASE_URL: "https://auth-test.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only_not_a_real_key",
    },
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
  },
});
