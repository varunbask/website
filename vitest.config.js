import { defineConfig } from 'vitest/config';

// Offline unit tests. The RLS suite has its own config (vitest.rls.config.js).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    // Some suites import every portal view in beforeAll (files-routes); under a
    // full parallel run on a busy machine that can pass the 10 s default
    hookTimeout: 30_000,
  },
});
