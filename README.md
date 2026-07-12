# Alexa Smart Home Plus

Alexa Smart Home Plus lets you choose devices already connected to Alexa and bring them into Apple Home through Homebridge.

Amazon sign-in, discovery, selection, and naming are handled in the Homebridge settings screen, so the initial setup does not require hand-editing JSON.

[日本語](README.ja.md) | [Roadmap](ROADMAP.md)

## What the settings screen does

After connecting an Amazon account, the plugin retrieves Alexa devices and routines. The result can be searched, filtered visually by type, and reduced to only the items that should appear in HomeKit.

- Guided browser authentication
- Device and routine discovery with manual refresh
- Search, type labels, and bulk selection of visible results
- HomeKit-only aliases that do not rename Alexa devices
- Japanese and English UI with automatic language selection
- Inline authentication and discovery progress
- Alexa routines exposed as momentary HomeKit switches
- An on/off fallback for otherwise unknown Alexa device types

## First-run journey

### Connect Amazon

Open the plugin settings in Homebridge UI. Select the Amazon marketplace used by the Alexa account and provide a Homebridge host that the current browser can reach. The authentication proxy port must not be used by another service.

Select **Connect to Alexa** and complete Amazon's sign-in flow, including MFA, CAPTCHA, or device approval when requested. When the completion page appears, close it and return to the Homebridge settings window.

### Choose what HomeKit receives

Select **Refresh devices** to retrieve devices and routines. Discovery runs without locking the rest of the form; the list updates when the request completes.

Choose the items to publish and optionally assign HomeKit-specific names.

### Apply the selection

Save the configuration and restart the Child Bridge. The chosen accessories will then be published to Apple Home.

## Alexa-to-HomeKit translation

The plugin evaluates both the Alexa device type and the operations reported for that endpoint.

| Alexa endpoint | HomeKit presentation | Typical controls |
|---|---|---|
| Light | Lightbulb | Power, brightness, color temperature, color when available |
| Smart lock | Lock | Lock, unlock, current state |
| Outlet or plug | Outlet | Power |
| Switch | Switch or Lightbulb | Power, brightness when available |
| Fan | Fan | Power and available speed controls |
| Thermostat | Thermostat | Temperature and operating mode |
| Temperature, humidity, air quality, or CO endpoint | Sensor service | Current readings |
| Alexa routine | Momentary switch | Run routine |

Alexa integrations can report different capabilities for the same physical product, so available HomeKit controls may vary by account.

### Hardware paths verified during development

- Qrio Lock Tokyo: lock, unlock, and current state
- Alexa-connected light: power, brightness, color temperature, and current state

## Credentials and stored data

There are no plugin fields for an Amazon username, password, or MFA code. Those values are entered only into the Amazon-hosted sign-in flow and are not saved by this plugin.

After authentication, the Alexa session material required for later requests is stored under Homebridge's `persist` directory. The plugin refreshes that session while possible and asks for browser authentication again when user interaction is required.

## Where to look when something fails

### The Amazon page does not open

- Confirm that the browser can reach the configured Homebridge host.
- Choose a proxy port that is not already occupied.
- For a remote host or container, use an address reachable from the browser rather than a loopback-only address.

### Discovery is slow or returns no entries

- Confirm that the device is controllable in the Alexa app.
- Check that the settings screen reports an authenticated account.
- Discovery does not block form editing; wait briefly and retry **Refresh devices** if necessary.

### A selected item is missing from Apple Home

- Confirm that it remains selected before saving.
- Restart the Alexa Smart Home Plus Child Bridge after saving.
- Some sensor services appear in a room's status area rather than as accessory tiles.

## Runtime support

- Homebridge 1.x and 2.x
- Node.js 18, 20, 22, and 24
- Homebridge Config UI X is recommended for first-run setup

## Contributor checks

```bash
npm ci
npm run verify
npm pack --dry-run --ignore-scripts
```

`verify` runs unit tests, linting, and the production TypeScript build. Tests that require a real Amazon account are kept separate from the normal unit-test run.

## Project lineage and limitations

Some dependencies communicate through Amazon interfaces that are not public APIs. Authentication or device control may therefore need maintenance after Amazon-side changes. This project is not an Amazon product and is not affiliated with any device manufacturer.

The codebase began from the MIT-licensed `joeyhage/homebridge-alexa-smarthome` project and now uses its own package name, platform identity, configuration UI, authentication journey, and device-selection workflow. Its README text is independently written rather than reproduced from the upstream project. Publishing the same Alexa endpoint through both plugins will produce duplicate HomeKit accessories.
