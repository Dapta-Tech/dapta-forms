import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for the web app run in plain node (no DOM): component specs
// assert on React element trees, not rendered markup, so no jsdom is needed.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['app/**/*.spec.{ts,tsx}', 'components/**/*.spec.{ts,tsx}', 'lib/**/*.spec.{ts,tsx}'],
  },
});
