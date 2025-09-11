# audio-recorder.bs.js

![GitHub package.json version](https://img.shields.io/github/package-json/v/DCC-BS/audio-recorder.bs.js)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/DCC-BS/audio-recorder.bs.js/publish.yml)
[![codecov](https://codecov.io/gh/DCC-BS/audio-recorder.bs.js/graph/badge.svg?token=3PBNL8OR24)](https://codecov.io/gh/DCC-BS/audio-recorder.bs.js)

TODO

## Quick Setup

To install the module create a `.npmrc` next to your `package.json` file:

```txt
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
@dcc-bs:registry=https://npm.pkg.github.com
```

Create a github [personal access token (classic)](https://github.com/settings/tokens/new) with `read:packages` permissions and add it to your `.env` file:

```txt
GITHUB_TOKEN='YOUR_TOKEN'
```

Install the module to your Nuxt application with:

```bash
bun add @dcc-bs/audio-recorder.bs.js
```

Add it to your `nuxt.config.ts`:
```ts
export default defineNuxtConfig({
    ...
    modules: [
        '@dcc-bs/audio-recorder.bs.js',
        ...
    ],
    ...
})
```

That's it! You can now use audio-recorder.bs.js in your Nuxt app ✨

## Usage

TODO

## Release a new Version
Commit your changes and then:
```sh
bun release
```