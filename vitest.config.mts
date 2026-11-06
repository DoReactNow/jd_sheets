import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

// Levels (Decision 24): "unit" (logic, node), "unit-dom" (React components and the editor bridge,
// jsdom), "integration" (route handlers to the real test database, serial) and "contract"
// (fixtures shared with the Rust service, plus adapters against the real Rust service).
export default defineConfig({
  resolve: { alias: { "@": srcDir } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.unit.test.ts", "scripts/**/*.unit.test.mjs"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "unit-dom",
          include: ["src/**/*.unit.test.tsx"],
          environment: "jsdom",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          environment: "node",
          fileParallelism: false,
          globalSetup: ["src/tests/setup/integrationGlobalSetup.ts"],
          setupFiles: ["src/tests/setup/loadTestEnv.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "contract",
          include: ["src/**/*.contract.test.ts"],
          environment: "node",
          fileParallelism: false,
          setupFiles: ["src/tests/setup/loadTestEnv.ts"],
        },
      },
    ],
  },
});
