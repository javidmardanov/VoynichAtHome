import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,testMatch:'load.spec.ts',outputDir:'test-results/load-artifacts',timeout:240000,projects:base.projects?.filter(p=>p.name==='chromium'),reporter:[['list'],['json',{outputFile:'test-results/load-report.json'}]]});
