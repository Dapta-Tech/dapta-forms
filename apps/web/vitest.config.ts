import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for the web app run in plain node (no DOM): component specs mostly
// assert on React element trees rather than rendered markup, so no jsdom is
// needed. A component with hooks can still be exercised with
// `react-dom/server`'s renderToStaticMarkup, which runs in node.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` is a build-time guard with no runtime module. A client
      // component that transitively imports a server action pulls it in, and
      // resolution fails before any test runs. Stub it so those components can
      // be unit-tested at all.
      'server-only': fileURLToPath(new URL('./lib/test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['app/**/*.spec.{ts,tsx}', 'components/**/*.spec.{ts,tsx}', 'lib/**/*.spec.{ts,tsx}'],
  },
});
