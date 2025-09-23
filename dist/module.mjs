import { defineNuxtModule, createResolver, addComponentsDir } from '@nuxt/kit';
export * from '../dist/runtime/composables/audioConversion.js';
export * from '../dist/runtime/composables/audioRecoding.js';
export * from '../dist/runtime/utils/microphone.js';

const module = defineNuxtModule({
  meta: {
    name: "audio-recorder.bs.js",
    configKey: "audio-recorder.bs.js"
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
            file: "en.json"
          },
          {
            code: "de",
            file: "de.json"
          }
        ]
      });
    });
    addComponentsDir({
      path: resolver.resolve("./runtime/components"),
      global: true,
      pathPrefix: false
    });
    if (!_nuxt.options.vite) {
      _nuxt.options.vite = {};
    }
    if (!_nuxt.options.vite.optimizeDeps) {
      _nuxt.options.vite.optimizeDeps = {};
    }
    _nuxt.options.vite.optimizeDeps.exclude = [
      ..._nuxt.options.vite.optimizeDeps.exclude ?? [],
      "@ffmpeg/ffmpeg",
      "@ffmpeg/util"
    ];
  }
});

export { module as default };
