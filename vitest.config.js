import { fileURLToPath } from 'url';
import path from 'path';
import { defineProject } from 'vitest/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineProject({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.js'],
  },
});
