export default defineNuxtConfig({
    modules: ["../src/module", "@nuxt/ui", "@nuxtjs/i18n"],
    devtools: { enabled: true },
    compatibilityDate: "2025-02-17",
    css: ["assets/main.css"],
    i18n: {
        locales: [
            { code: "en", file: "en.json" },
            { code: "de", file: "de.json" },
        ],
        defaultLocale: "en",
        langDir: "lang",
        strategy: "no_prefix",
    },
});
