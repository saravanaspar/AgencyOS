import { defineConfig, devices } from "@playwright/test";

const baseURL = (process.env.AGENCYOS_E2E_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const externalServer = Boolean(process.env.AGENCYOS_E2E_BASE_URL);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;
const video = process.env.PLAYWRIGHT_VIDEO === "1" ? "retain-on-failure" : "off";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results/playwright/artifacts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 240_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/playwright/results.json" }],
    ["html", { outputFolder: "test-results/playwright/html", open: "never" }],
  ],
  use: {
    baseURL,
    browserName: "chromium",
    headless: process.env.AGENCYOS_E2E_HEADLESS !== "0",
    launchOptions: executablePath
      ? { executablePath, args: ["--no-sandbox", "--disable-setuid-sandbox"] }
      : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video,
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "desktop-1440",
      use: { viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "tablet-1024",
      use: { viewport: { width: 1024, height: 900 } },
    },
    {
      name: "tablet-768",
      use: { viewport: { width: 768, height: 900 } },
    },
    {
      name: "mobile-375",
      use: { ...devices["iPhone 13"], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: externalServer
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1",
        url: baseURL,
        env: {
          APP_URL: baseURL,
        },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
