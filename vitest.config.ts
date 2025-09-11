import { coverageConfigDefaults } from 'vitest/config';
import { defineVitestConfig } from '@nuxt/test-utils/config'
import { fileURLToPath } from 'node:url';

export default defineVitestConfig({
    test: {
        environment: 'nuxt',
        globals: true,
        environmentOptions: {
            nuxt: {
                rootDir: fileURLToPath(new URL('test/nuxt/', import.meta.url))
            }
        },
        coverage: {
            provider: 'v8',
            exclude: [
                '**/playground/**',
                '**/components/**',
                '**/models/**',
                'src/module.ts',
                ...coverageConfigDefaults.exclude]
        },
        reporters: ['junit', 'default'],
        outputFile: 'test-report.junit.xml',
    },
});