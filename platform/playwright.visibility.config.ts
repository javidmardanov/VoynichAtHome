import { defineConfig,devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({...base,
  testMatch:'visibility.spec.ts',
  outputDir:'test-results/visibility-artifacts',
  projects:[{name:'chromium-headed',use:{...devices['Desktop Chrome'],headless:false}}],
  reporter:[['list'],['json',{outputFile:'test-results/visibility-report.json'}]]
});
