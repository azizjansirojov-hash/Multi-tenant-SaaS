import { defineConfig } from "vitest/config";
import path from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, ".env") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.e2e.test.ts"],
    env: {
      AUTH_SECRET: process.env.AUTH_SECRET || "vitest-auth-secret",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/lib/**/*.ts", "src/actions/**/*.ts", "src/app/api/**/*.ts"],
      exclude: ["src/generated/**", "**/*.test.ts", "**/*.e2e.test.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
