import { defineConfig } from 'vite';

// GitHub Pages serves the game under /ZamboniSIM/ – the deploy workflow sets
// BASE_PATH; local dev and preview keep the root base.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
});
