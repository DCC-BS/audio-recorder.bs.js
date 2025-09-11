# Audio Recorder Playwright Tests

This directory contains end-to-end tests for the audio recorder web application using Playwright.

## Setup

The tests are already configured and ready to run. Playwright and the necessary dependencies have been installed.

## Running Tests

### Run all tests (headless mode)
```bash
bun run test:e2e
```

### Run tests with UI (interactive mode)
```bash
bun run test:e2e:ui
```

### Run specific test file
```bash
bunx playwright test tests/e2e/audio-recorder.spec.ts
```

### Run tests in headed mode (with browser visible)
```bash
bunx playwright test --headed
```

## Test Features

The tests cover the following functionality:

1. **Basic UI**: Verifies the start recording button is visible on page load
2. **Recording Flow**: Tests the complete start → record → stop cycle
3. **Time Formatting**: Validates recording time is displayed in MM:SS format
4. **Multiple Sessions**: Tests that multiple recording sessions work correctly
5. **Error Handling**: Tests graceful handling of microphone permission denied

## Mocking Strategy

The tests use comprehensive mocking to simulate audio recording without requiring actual microphone access:

- **MediaRecorder API**: Fully mocked to simulate recording states and events
- **getUserMedia**: Mocked to return fake MediaStream objects
- **Audio Data**: Simulated with fake Blob data

## Audio Recording Simulation

The mocks simulate:
- MediaRecorder state changes (inactive → recording → inactive)
- Audio data events with realistic timing
- Stream creation and management
- Permission handling scenarios

## Configuration

Tests are configured via `playwright.config.ts`:
- Runs against `http://localhost:3000`
- Automatically starts the dev server
- Uses Chromium browser
- Includes proper microphone permissions

## Debugging

For debugging test failures:
1. Run with `--headed` to see browser interactions
2. Use `--debug` to step through tests
3. Check the HTML report generated after test runs
4. Use browser developer tools in headed mode

The tests provide comprehensive coverage of the audio recording functionality while being completely isolated from actual audio hardware dependencies.
