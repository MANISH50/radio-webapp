import { defineConfig, devices } from '@playwright/test';

const APP_PORT = 4173;
const MOCK_PORT = 4010;

// The app runs from its production build against a local mock of the Radio Browser API.
// UPSTREAM_ALLOW_PRIVATE lets the SSRF guard reach the loopback mock; the server refuses
// that flag outside NODE_ENV=test.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/mock-upstream.mjs',
      url: `http://127.0.0.1:${MOCK_PORT}/json/countries`,
      env: { MOCK_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
    },
    {
      command: 'node server/dist/index.js',
      url: `http://localhost:${APP_PORT}/api/v1/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: String(APP_PORT),
        HOST: '127.0.0.1',
        ALLOWED_ORIGINS: `http://localhost:${APP_PORT}`,
        SESSION_SECRET: 'e2e-only-secret-not-for-production-use-0123456789',
        RB_MIRRORS: `http://127.0.0.1:${MOCK_PORT}`,
        UPSTREAM_ALLOWED_HOSTS: '127.0.0.1',
        UPSTREAM_ALLOW_PRIVATE: 'true',
        INCLUDE_HTTP_STREAMS: 'true',
        STATIC_DIR: 'client/dist',
        LOG_LEVEL: 'warn',
      },
    },
  ],
});
