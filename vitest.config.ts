import { fileURLToPath } from "node:url";
import { defineVitestConfig } from "@nuxt/test-utils/config";
import { coverageConfigDefaults } from "vitest/config";

export default defineVitestConfig({
    test: {
        environment: "nuxt",
        globals: true,
        environmentOptions: {
            nuxt: {
                rootDir: fileURLToPath(new URL("test/nuxt/", import.meta.url)),
            },
        },
        coverage: {
            provider: "v8",
            exclude: [
                "**/playground/**",
                "**/components/**",
                "**/models/**",
                "src/module.ts",
                ...coverageConfigDefaults.exclude,
            ],
        },
        reporters: ["junit", "default"],
        outputFile: "test-report.junit.xml",
    },
});
