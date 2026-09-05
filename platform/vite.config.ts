import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { sites } from '@openai/sites-vite-plugin';
export default defineConfig({ plugins: [sveltekit(),sites()], server: { port: 5173, strictPort: true } });
