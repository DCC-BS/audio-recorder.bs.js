# Audio Recorder (Nuxt Module)

![GitHub package.json version](https://img.shields.io/github/package-json/v/DCC-BS/audio-recorder.bs.js)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/DCC-BS/audio-recorder.bs.js/publish.yml)

Audio Recorder is a powerful Nuxt.js module that provides advanced audio recording, processing, and management capabilities for web applications. This module includes Vue components, composables, and utilities for seamless audio recording integration with client-side storage and audio format conversion.

## Features

- **Audio Recording**: Web-based audio recording with MediaRecorder API integration
- **Audio Visualization**: Real-time audio visualization during recording
- **Session Management**: Persistent audio session storage with IndexedDB
- **Audio Conversion**: FFmpeg integration for WebM to MP3 conversion
- **Storage Services**: Client-side audio blob storage and management
- **Session Explorer**: Browse and manage recorded audio sessions
- **Abandoned Recording Recovery**: Automatic detection and recovery of interrupted recordings
- **Internationalization**: Built-in i18n support (English and German)

## Technology Stack

- **Framework**: [Nuxt.js](https://nuxt.com/) module with Vue 3
- **Package Manager**: [Bun](https://bun.sh/)
- **Audio Processing**: [FFmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm) WebAssembly
- **Database**: [Dexie](https://dexie.org/) for IndexedDB management
- **Animation**: [Motion-V](https://motion-v.netlify.app/) for smooth UI transitions
- **Testing**: Playwright for e2e testing

## Setup

### Prerequisites

- Node.js 18+
- Bun package manager
- Modern browser with MediaRecorder API support

### Installation

Install the module to your Nuxt application:

```bash
bun add git+https://github.com/DCC-BS/audio-recorder.bs.js#v1.1.0
```
replace `v1.1.0` with the latest version tag: ![GitHub package.json version](https://img.shields.io/github/package-json/v/DCC-BS/common-ui.bs.js)

Add it to your `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
    modules: [
        '@dcc-bs/audio-recorder.bs.js',
    ],
})
```

add the following line to your main CSS file:
```css
@import '@dcc-bs/audio-recorder.bs.js';
```

## Usage

### Basic Audio Recording

```vue
<template>
  <div>
    <AudioRecorder 
      @recording-started="onRecordingStarted"
      @recording-stopped="onRecordingStopped"
    />
  </div>
</template>

<script setup>
function onRecordingStarted(stream) {
  console.log('Recording started:', stream)
}

function onRecordingStopped(audioBlob, audioUrl) {
  console.log('Recording stopped:', { audioBlob, audioUrl })
}
</script>
```

### Using Audio Recording Composable

```vue
<script setup>
import { useAudioRecording } from '@dcc-bs/audio-recorder.bs.js'

const { 
  startRecording, 
  stopRecording, 
  abandonedRecording, 
  getMp3Blob,
  deleteAbandonedRecording 
} = useAudioRecording({
  logger: console.log,
  deleteOldSessionsDaysInterval: 7,
  onRecordingStarted: (stream) => {
    console.log('Recording started')
  },
  onRecordingStopped: (audioBlob, audioUrl) => {
    console.log('Recording completed')
  }
})

// Start recording
await startRecording()

// Stop recording
await stopRecording()

// Download recorded audio as MP3
async function downloadAudio(sessionId) {
  const blob = await getMp3Blob(sessionId)
  if (blob) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `recording-${Date.now()}.mp3`
    a.click()
    URL.revokeObjectURL(url)
  }
}
</script>
```

### Audio Session Explorer

```vue
<template>
  <AudioSessionExplorer />
</template>
```

## Components

- **AudioRecorder**: Main recording component with start/stop controls
- **AudioVisualizer**: Real-time audio waveform visualization
- **AudioSessionExplorer**: Browse and manage audio sessions

## Development

Start the development playground:

```bash
bun dev
```

Build the module:

```bash
bun dev:build
```

Prepare the development environment:

```bash
bun dev:prepare
```

## Testing

Run unit tests:

```bash
bun test
```

Run tests with coverage:

```bash
bun test:coverage
```

Run end-to-end tests:

```bash
bun test:e2e
```

Run tests in watch mode:

```bash
bun test:watch
```

## Code Quality

Format code with Biome:

```bash
bun lint
```

Run linting and fixes:

```bash
bun check
```

## Project Architecture

- `src/`: Main module source code
  - `module.ts`: Nuxt module entry point
  - `runtime/`: Runtime components and composables
    - `components/`: Vue components for audio recording
    - `composables/`: Audio recording and conversion composables
    - `services/`: Audio storage and database services
    - `utils/`: Utility functions for microphone handling
    - `lang/`: Internationalization files
- `playground/`: Development playground and examples
- `tests/`: Unit and integration tests
  - `e2e/`: End-to-end tests with Playwright
  - `nuxt/`: Nuxt-specific tests

## Release

To release a new version:

```bash
bun release
```

This will run linting, tests, build the module, generate changelog, and push with tags.

## License

[MIT](LICENSE) © Data Competence Center Basel-Stadt

<a href="https://www.bs.ch/schwerpunkte/daten/databs/schwerpunkte/datenwissenschaften-und-ki"><img src="https://github.com/DCC-BS/.github/blob/main/_imgs/databs_log.png?raw=true" alt="DCC Logo" width="200" /></a>

Datenwissenschaften und KI <br>
Developed with ❤️ by DCC - Data Competence Center