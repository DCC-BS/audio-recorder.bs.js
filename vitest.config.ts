import { fileURLToPath } from "node:url";
import { defineVitestConfig } from "@nuxt/test-utils/config";
import { configDefaults, coverageConfigDefaults } from "vitest/config";

export default defineVitestConfig({
    test: {
        environment: "nuxt",
        globals: true,
        // Playwright owns tests/e2e (see playwright.config.ts)
        exclude: [...configDefaults.exclude, "tests/e2e/**"],
        // No unit tests in the repo yet; don't fail the release pipeline on it
        passWithNoTests: true,
        environmentOptions: {
            nuxt: {
                rootDir: fileURLToPath(new URL("tests/nuxt/", import.meta.url)),
            },
        },
        coverage: {
            provider: "v8",
            exclude: [
                "**/playground/**",
                "**/components/**",
                "**/models/**",
                "src/module.ts",
                "tests/e2e/**",
                ...coverageConfigDefaults.exclude,
            ],
        },
        reporters: ["junit", "default"],
        outputFile: "test-report.junit.xml",
    },
});
