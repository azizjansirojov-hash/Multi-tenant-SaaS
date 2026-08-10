import { defineConfig } from "vitest/config";
import path from "path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, ".env") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
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
