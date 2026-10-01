import { defineConfig } from 'vitest/config';

// Runs against the linked Supabase project with throwaway accounts, one file at a time.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rls/**/*.test.js'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
