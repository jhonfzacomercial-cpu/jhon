import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Testes de integração compartilham um banco: executa os arquivos em sequência.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://fza:fza@localhost:5432/fza_monitor_test',
      APP_ORIGIN: 'http://localhost:5173',
      ALLOW_DEMO_PROVIDER: 'true',
    },
  },
});
