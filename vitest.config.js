import { defineConfig } from 'vitest/config';

// Offline unit tests. The RLS suite has its own config (vitest.rls.config.js).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
  },
});
