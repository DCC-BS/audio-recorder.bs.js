import { addComponentsDir, createResolver, defineNuxtModule } from "@nuxt/kit";
import type { ModuleRuntimeHooks } from "@nuxtjs/i18n";

export * from "./runtime/composables/audioConversion";
export * from "./runtime/composables/audioRecoding";
export * from "./runtime/utils/microphone";

export default defineNuxtModule<ModuleRuntimeHooks>({
    meta: {
        name: "audio-recorder.bs.js",
        configKey: "audio-recorder.bs.js",
    },
    // Default configuration options of the Nuxt module
    defaults: {},
    setup(_options, _nuxt) {
        const resolver = createResolver(import.meta.url);

        _nuxt.hook("i18n:registerModule", (register) => {
            register({
                langDir: resolver.resolve("./runtime/lang"),
                locales: [
                    {
                        code: "en",
                        file: "en.json",
                    },
                    {
                        code: "de",
                        file: "de.json",
                    },
                ],
            });
        });

        addComponentsDir({
            path: resolver.resolve("./runtime/components"),
            global: true,
            pathPrefix: false,
        });

        if (!_nuxt.options.vite) {
            _nuxt.options.vite = {};
        }

        if (!_nuxt.options.vite.optimizeDeps) {
            _nuxt.options.vite.optimizeDeps = {};
        }

        _nuxt.options.vite.optimizeDeps.exclude = [
            ...(_nuxt.options.vite.optimizeDeps.exclude ?? []),
            "@ffmpeg/ffmpeg",
            "@ffmpeg/util",
        ];
    },
});
