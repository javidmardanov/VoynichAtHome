import { defineConfig,devices } from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',fullyParallel:false,workers:1,timeout:90000,retries:0,
  use:{baseURL:'http://127.0.0.1:8899',trace:'retain-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}}],
  webServer:{command:'node scripts/run-ts.mjs scripts/e2e-server.ts',url:'http://127.0.0.1:8899/_app/immutable/test-ready',timeout:120000,reuseExistingServer:false},
  reporter:[['list'],['json',{outputFile:'test-results/browser-report.json'}]]
});
