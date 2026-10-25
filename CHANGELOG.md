# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-10-25

### Added

- Add an opt-in, bearer-authenticated Local Context API for Kokochi Pilot.
- Expose filtered Alexa device metadata and shared cached state, and route commands through the existing Alexa API wrapper.
- Add common capabilities and snapshots for locks, thermostats, temperature, and humidity, confirmed state patches, and state-difference events.
- Align the Kokochi UI with Mitsubishi Plus token generation, copy, and regeneration controls.
- Add `/v1/info`, required operation IDs, the common `changes` patch envelope, common error codes, and per-field apply results.

### Changed

- Update `alexa-cookie2` to 5.0.6 and `alexa-remote2` to 8.1.1 for current Amazon login and two-step verification redirects.
- Check saved authentication against Alexa when the settings UI opens instead of treating stored cookie fields alone as a valid session.
- Keep the Local Context projection independent from the existing HomeKit and Matter initialization paths.
- Bind the API to localhost only, separate receive and event tokens, and never update shared state from an unconfirmed command result.
- Make locks read-only, label ordinary Alexa observations as `reported`, retain mismatched confirmation observations as external changes, and enforce event delivery timeout/status checks.

### Fixed

- Resume Child Bridge initialization after authentication is saved in the settings UI, without restarting Homebridge.
- Show Kokochi Pilot settings only when its plugin is installed.
- Prevent dependency-internal cookie recovery from starting a browser proxy during runtime or device discovery.
- Remove upstream HTTPS-upgrade policies from local HTTP authentication responses.

- Recognize `Cookie invalid, Renew unsuccessful`, `InvalidToken`, and invalid authentication responses as expired Alexa authentication while keeping ordinary network failures out of the automatic re-authentication path.
- Keep Amazon's post-login callback on the authentication proxy scheme used at the start of the session: HTTP remains HTTP, while HTTPS behind a TLS reverse proxy remains HTTPS. The settings UI now passes its generated HTTP login scheme explicitly instead of relying on request-header inference.
- Prevent the Child Bridge from starting a second browser authentication proxy when saved authentication is missing or rejected. Browser authentication is now started only by the plugin settings server, avoiding port conflicts and stale proxy behavior.

## [1.1.0] - 2026-08-01

### Added

- Add optional Homebridge 2 Matter projection for Alexa lights, smart locks, smart plugs, and power-capable switches.
- Reuse the existing Alexa authentication, discovery, command, and state-polling paths for Matter instead of creating a second session or polling loop.
- Keep Matter state synchronized from the shared Alexa device cache, including changes found by periodic polling.
- Add detected-device rename fields that show the Alexa device name as the title and use it as the default editable HomeKit name.

### Changed

- Promote the device-tested Matter release candidate to a stable release.
- Build against the Homebridge 2.1.1 plugin API while retaining the existing HomeKit-only runtime path when Matter is unavailable.
- Document Matter setup, shared Alexa configuration, supported device types, and current limitations in English and Japanese.
- Clarify the periodic state refresh warning and display the unsupported/stale-state limitation on a separate line in the settings UI.

### Fixed

- Make custom configuration UI help text readable in Homebridge dark mode.
- Prevent stale cached Matter accessories from removing an active replacement when an Alexa device changes its Matter type.
- Restrict Jest discovery to the source tree so release verification completes without scanning unrelated workspace files.
- Reject Git pushes and npm release preparation when the destination is not `sylpied/homebridge-alexa-smarthome-plus`, and keep the upstream source repository fetch-only.

## [1.1.0-rc.2] - 2026-07-29

### Added

- Add optional Homebridge 2 Matter projection for Alexa lights, smart locks, smart plugs, and power-capable switches.
- Reuse the existing Alexa authentication, discovery, command, and state-polling paths for Matter instead of creating a second session or polling loop.
- Keep Matter state synchronized from the shared Alexa device cache, including changes found by periodic polling.

### Changed

- Build against the Homebridge 2.1.1 plugin API while retaining the existing HomeKit-only runtime path when Matter is unavailable.
- Document Matter setup, shared Alexa configuration, supported device types, and current limitations in English and Japanese.
- Explain in the settings UI and README that Alexa can return stale or unavailable device state even when periodic refresh is enabled.

### Fixed

- Make custom configuration UI help text readable in Homebridge dark mode.
- Prevent stale cached Matter accessories from removing an active replacement when an Alexa device changes its Matter type.
- Restrict Jest discovery to the source tree so release verification completes without scanning unrelated workspace files.
- Reject Git pushes and npm release preparation when the destination is not `sylpied/homebridge-alexa-smarthome-plus`, and keep the upstream source repository fetch-only.

## [1.0.0] - 2026-07-25

### Changed

- Promote the device-tested RC9 implementation to the first stable release.

### Fixed

- Remove the development-only Husky `prepare` script from the published package so Homebridge installations no longer request install-script approval.

## [1.0.0-rc.9] - 2026-07-17

### Removed

- Remove both ineffective Alexa pre-refresh experiments after device testing showed that neither Phoenix state requests nor full endpoint-list retrieval caused Alexa's stale cloud state to update.

### Fixed

- Retain the Homebridge 2-compatible periodic characteristic update introduced during RC7 testing.
- Populate the Alexa device and routine lists automatically when an authenticated settings session has no cached discovery result, while reusing completed results on later openings.

## [1.0.0-rc.8] - 2026-07-17

### Changed

- Remove the unsupported Phoenix per-device refresh, which returned `TargetApplianceNotFoundException` for modern GraphQL endpoints.
- Optionally refresh the complete Alexa endpoint list before individual state checks, wait three seconds, and then query the target device.
- Share the full-list request between accessories and throttle it to at most once every five minutes.

## [1.0.0-rc.7] - 2026-07-17

### Fixed

- Refresh HomeKit characteristics through the Homebridge 2 request handler instead of the removed runtime `getValue()` method.
- Try the full Alexa endpoint ID for the experimental app-style refresh and fall back to the stripped device ID when rejected.
- Include the sanitized Alexa rejection reason in debug logs without exposing response bodies or authentication data.

## [1.0.0-rc.6] - 2026-07-17

### Changed

- Wait three seconds after a successful experimental refresh before reading state, allowing Alexa's cached state time to propagate.
- Log the periodic and experimental refresh modes at Child Bridge startup so the effective configuration is unambiguous.

## [1.0.0-rc.5] - 2026-07-16

### Added

- Add periodic Alexa state refresh, enabled by default, for devices that do not report physical or external-remote changes.
- Refresh after 10, 15, and 30 seconds, then 1, 3, 5, 10, and 15 minutes, continuing at a configurable 1, 3, 5, 10, 15, or 30 minute interval (default: 5 minutes).
- Restart the refresh schedule after a HomeKit write.
- Stagger requests for multiple devices and apply automatic backoff after temporary failures.
- Add an opt-in experimental Alexa app-style state refresh with automatic fallback to the standard query.

### Security

- Suppress all raw `alexa-remote2` runtime diagnostic output.
- Remove the unused direct `uuid` dependency.

## [1.0.0-rc.4] - 2026-07-13

### Fixed

- Confirm smart-lock commands by polling Alexa for the physical `LOCKED` or `UNLOCKED` state and then update HomeKit, preventing the Home app from remaining indefinitely in progress.

## [1.0.0-rc.3] - 2026-07-13

### Security

- Suppress all `alexa-cookie2` diagnostic output during browser authentication because it can contain Amazon cookies, OAuth tokens, request bodies, account details, and private device keys.

## [1.0.0-rc.2] - 2026-07-13

### Fixed

- Time out stalled Alexa discovery requests and allow a later retry.
- Return discovery progress through the authenticated settings API instead of writing device names into the installed plugin directory.
- Store refreshed Alexa authentication atomically with owner-only file permissions.
- Do not infer a connected Amazon account solely from cached HomeKit accessories.
- Stop temporary Alexa connections after discovery completes or fails.
- Track selections by Alexa endpoint ID so devices with identical names can be selected independently.

### Tests

- Add settings-server tests for timeout cleanup and private authentication-file permissions.

## [1.0.0-rc.1] - 2026-07-12

### Added

- Add a guided bilingual configuration UI with browser-based Amazon authentication.
- Add Alexa device and routine discovery with search, bulk selection, aliases, and inline status.
- Add verified HomeKit mappings for Alexa lights and smart locks.
- Add release verification covering unit tests, linting, TypeScript builds, and npm package contents.

### Changed

- Refresh the English and Japanese documentation for the current setup workflow.
- Build installable npm archives in tagged GitHub release workflows.

### Security

- Do not collect or save the user's Amazon username or password.
- Persist only the Alexa session data required for subsequent authenticated access.

## [0.9.6] - 2026-07-12

### Fixed

- Remove the remaining discovery success toast from the polling completion path.
- Use only the inline completion message for discovery results.

## [0.9.5] - 2026-07-12

### Changed

- Show discovery completion inline instead of using a global success toast.
- Avoid duplicate notifications when Homebridge UI retains multiple custom-UI instances.

## [0.9.4] - 2026-07-12

### Fixed

- Prevent overlapping discovery runs in the settings UI.
- Disable the refresh button while discovery is active.
- Rate-limit discovery success notifications to one per 30 seconds.

## [0.9.3] - 2026-07-12

### Fixed

- Do not treat routine cookie refreshes during discovery as a new Alexa login.
- Prevent the authentication event handler from starting a second discovery job.
- Eliminate duplicate discovery completion notifications at their source.

## [0.9.2] - 2026-07-12

### Fixed

- Deduplicate discovery completion received through the event and JSON fallback paths.
- Show the successful discovery notification only once per completed retrieval.
- Include an initial discovery result file to avoid harmless asset-not-found log messages.

## [0.9.1] - 2026-07-12

### Fixed

- Update unit-test device fixtures, cache states, and Alexa wrapper calls to the current APIs.
- Separate environment-dependent integration tests from the default unit-test run.
- Accept the documented per-device disabled-operations setting during configuration validation.

### Tests

- Restore a clean default test run with 31 passing tests across 10 suites.

## [0.9.0] - 2026-07-12

### Added

- Log the Alexa-to-HomeKit type mapping and supported operations for every published device.
- Log successful power writes for lights, outlets, switches, and fans when debug logging is enabled.
- Keep diagnostic logs free of authentication data and Alexa internal identifiers.

## [0.8.3] - 2026-07-12

### Fixed

- Publish discovery results as an atomic static JSON file read directly by the settings UI.
- Bypass unreliable Homebridge UI 5.24 custom-server response forwarding for discovery data.
- Reject stale cached discovery results using completion timestamps.

## [0.8.2] - 2026-07-12

### Fixed

- Exclude large Alexa internal identifiers from custom UI discovery responses.
- Send only device names/types and routine names required by the settings UI.
- Deliver completed discovery through both an event and status polling fallback.

## [0.8.1] - 2026-07-12

### Fixed

- Start polling without waiting for Homebridge UI to resolve the discovery-start request.
- Continue polling after temporary status request failures.
- Report discovery-list rendering errors separately from Alexa request delays.

## [0.8.0] - 2026-07-12

### Added

- Search discovered Alexa devices and routines by name or type.
- Select or clear all currently visible discovery results.
- Show selected counts and Alexa device-type badges.

## [0.7.16] - 2026-07-12

### Fixed

- Defer Alexa connection startup until after the custom UI status response has been returned.
- Allow result polling to begin while Alexa discovery runs in the background.

## [0.7.15] - 2026-07-12

### Fixed

- Start and monitor Alexa discovery through the proven authentication-status route.
- Avoid custom discovery routes whose responses are not forwarded by Homebridge UI 5.24.

## [0.7.14] - 2026-07-12

### Fixed

- Rename the custom discovery-start route to avoid a Homebridge UI route-name conflict.
- Allow discovery startup to return before authentication-status polling begins.

## [0.7.13] - 2026-07-12

### Changed

- Start discovery in the background and return a small response immediately.
- Retrieve discovery results through the proven authentication-status route.
- Stop automatic Alexa discovery when merely opening the settings screen.

## [0.7.12] - 2026-07-12

### Changed

- Return completed discovery results directly from a single bounded request.
- Remove discovery-result polling to avoid duplicate discovery across cached UI versions.
- Bound server-side waiting to eight seconds and keep the settings screen interactive.

## [0.7.11] - 2026-07-12

### Fixed

- Use a non-overlapping custom UI route for discovery results to avoid Homebridge UI 5.24 prefix matching.
- Stop completed discovery from being restarted by result polling.

## [0.7.10] - 2026-07-12

### Fixed

- Register the discovery status route before the discovery route so status polling no longer starts discovery repeatedly.
- Display the completed Alexa discovery result in the settings screen.

## [0.7.9] - 2026-07-12

### Fixed

- Run Alexa discovery in the background so Homebridge UI requests return immediately.
- Poll discovery status without blocking the settings screen.
- Suppress the red server-timeout notification while discovery continues.

## [0.7.8] - 2026-07-12

### Changed

- Keep the settings page interactive during Alexa discovery instead of showing a full-screen spinner.
- End the foreground wait after 15 seconds and show a non-blocking inline status message.
- Add stage-based server logs for authentication initialization and Alexa device/routine retrieval.

## [0.7.7] - 2026-07-12

### Fixed

- Allow up to 60 seconds for Alexa device and routine discovery instead of applying the five-second settings request timeout.
- Show a clear progress message while Alexa discovery is running.

## [0.7.6] - 2026-07-12

### Changed

- Keep Alexa device discovery available even when the authentication-status response is not reflected by Homebridge UI.
- Infer an existing authenticated setup from cached Alexa accessories as a UI fallback; discovery still verifies the live saved session.
- Log the server-side authentication decision and persistence path without exposing credentials.

## [0.7.5] - 2026-07-12

### Added

- Poll authentication status after browser login for up to two minutes.
- Automatically change the settings badge to connected and discover Alexa devices and routines once the saved session becomes available.

## [0.7.4] - 2026-07-12

### Changed

- Add a clear, responsive Japanese or English authentication-complete page.
- Tell users to close the Amazon login page and return to Homebridge for device and routine discovery.

## [0.7.3] - 2026-07-12

### Fixed

- Use Amazon's global device-auth endpoint for browser token registration while retaining the configured regional Alexa API marketplace.
- Clear stale proxy registration state before a new login, avoiding redirects to the invalid `amazon.co.jp/ap/maplanding` page.

## [0.7.2] - 2026-07-12

### Fixed

- Reveal the deterministic local login URL after a short proxy startup grace period, even when Homebridge UI does not forward the custom-server response or event.

## [0.7.1] - 2026-07-12

### Fixed

- Return the Amazon login URL in the `/auth/start` response only after the proxy is listening.
- Update the settings page directly from the request response instead of depending solely on a custom pushed event.

## [0.7.0] - 2026-07-12

### Changed

- Replace indirect `alexa-remote2` authentication startup with the browser-proxy API provided directly by `alexa-cookie2`.
- Separate proxy readiness, browser login completion, session persistence, and Alexa discovery into distinct steps.
- Persist only the completed Alexa session data after successful browser authentication.

## [0.6.9] - 2026-07-12

### Fixed

- Ignore saved Alexa session data when the user explicitly starts a new browser authentication.
- Stop any previous proxy attempt before starting a new one.
- Fail proxy startup after ten seconds with a visible error instead of remaining in the starting state indefinitely.

## [0.6.8] - 2026-07-12

### Fixed

- Keep the Amazon login link hidden while the local authentication proxy is starting.
- Enable the login link only after the proxy reports that its listening socket is ready.
- Show proxy startup failures directly below the authentication controls.

## [0.6.7] - 2026-07-12

### Fixed

- Show the deterministic local Amazon login link immediately when authentication is requested.
- Start the authentication proxy without blocking the settings page on the server response or login lifecycle.

## [0.6.6] - 2026-07-12

### Changed

- Add a clear notice that Amazon user IDs and passwords are neither requested nor stored by the plugin.
- Hide the redundant successful-validation banner; validation is now only shown when required authentication host settings are incomplete.

## [0.6.5] - 2026-07-12

### Fixed

- Return the local Alexa authentication URL immediately while the proxy starts in the background.
- Explicitly enable proxy-only browser authentication without storing an Amazon password.
- Show an explicit Amazon login link instead of relying on an async popup, avoiding browser popup blocking.

## [0.6.4] - 2026-07-12

### Fixed

- Render the settings form before loading optional authentication and accessory data.
- Add timeouts and safe fallbacks for Homebridge configuration, localization, cached accessory, and authentication requests.
- Show an immediate loading message so UI initialization can be distinguished from an unloaded script.

## [0.6.3] - 2026-07-12

### Fixed

- Add versioned URLs to the custom UI JavaScript, stylesheet, and translations so Homebridge browsers do not reuse a stale settings bundle after plugin upgrades.

## [0.6.2] - 2026-07-12

### Fixed

- Add a guarded delayed initialization fallback for Homebridge UI versions where the ready event has already fired before the custom script attaches its listener.

## [0.6.1] - 2026-07-12

### Fixed

- Wait for the Homebridge custom UI ready event before loading configuration, preventing an empty settings page.
- Display initialization errors inside the settings page instead of leaving it blank.

## [0.6.0] - 2026-07-12

### Added

- Authentication-first setup directly from the Homebridge settings page.
- Live Alexa device and routine discovery after authentication.
- Checkbox selection of discovered devices and routines without manually entering names.
- Authentication status, refresh, and disconnect controls.

### Security

- Amazon passwords are never requested or stored. Only Alexa session and refresh data are persisted with owner-only file permissions.

## [0.5.0] - 2026-07-12

### Added

- Autocomplete suggestions from cached Homebridge accessories for device names.
- Autocomplete suggestions for previously registered Alexa routine accessories.
- Graceful fallback to manual input when cached accessory access is unavailable.

## [0.4.1] - 2026-07-12

### Changed

- Removed numeric prefixes from all settings section headings.

## [0.4.0] - 2026-07-12

### Added

- Custom Homebridge settings UI with automatic Japanese/English selection.
- Manual settings-language override: Automatic, 日本語, or English.
- English fallback for unsupported Homebridge UI languages.
- Responsive guided form for desktop and mobile screens.

### Changed

- Settings are updated through the official Homebridge custom UI API.
- Alexa authentication language remains independent from the settings UI language.

## [0.3.0] - 2026-07-12

### Changed

- Reorganised the standard Homebridge settings UI into four guided sections.
- Added a single device publication mode instead of showing include and exclude lists together.
- Moved authentication refresh, cache, disabled operations, and debug settings into a collapsed advanced section.
- Routine execution options are shown only after at least one routine is configured.

## [0.2.0] - 2026-07-12

### Added

- Selected Alexa routines can be exposed as momentary HomeKit switches.
- Automatic selection of an online controllable Echo as the execution context.
- Optional explicit Echo name or serial number for routine execution.
- Configurable delay before a routine switch returns to OFF.

## [0.1.0] - 2026-07-12

### Added

- Independent `homebridge-alexa-smarthome-plus` package and platform identity.
- Automatic browser re-authentication after a saved session is rejected.
- Device aliases for using different names in Alexa and HomeKit.
- Japanese setup documentation and a staged feature roadmap.

### Based on

- `homebridge-alexa-smarthome` 2.5.2, retained under its MIT License.

## [2.5.2] - 2026-07-05

### Added

- Added the hidden `name` field to the Homebridge config schema with the default platform name.

### Changed

- Upgraded alexa-cookie2 to version 5.0.4.
- Upgraded alexa-remote2 to version 8.0.5.

### Fixed

- Fixed token refresh failures when saved Alexa authentication data uses a different Amazon marketplace than the configured domain.

## [2.5.1] - 2026-05-26

### Changed

- Reduced logging verbosity. Logs are still visible using debug level.

## [2.5.0] - 2026-02-26

### Added

- The plugin configuration now supports a `disabledOperations` setting to disable operations for a specific device. For devices that create multiple HomeKit accessories (such as air quality monitors creating separate temperature and humidity sensors), users must use the parent Alexa device name in the disabledOperations configuration, not the individual sensor names. For example, if "My Sensor" creates "My Sensor temperature" and "My Sensor humidity", the user should configure `"deviceName": "My Sensor"` (not "My Sensor temperature"). Full config example:

  ```json
  {
    "disabledOperations": [
      {
        "deviceName": "My Light",
        "operations": "setBrightness, setColor, setColorTemperature"
      }
    ]
  }
  ```

## [2.4.0] - 2025-11-23

### Changed

- Added Node major version 24 to supported engines
- Upgraded alexa-remote2 to version 8.0.4

## [2.3.0] - 2025-04-12

### Changed

- Added Node major version 22 to supported engines

## [2.2.1] - 2024-08-13

### Changed

- Prepare for Homebridge v2

## [2.2.0] - 2024-07-16

### Added

- Color and color temperature support for lightbulbs.

### Changed

- Accessories pull information from a different API now (GraphQL) to address rate limiting and timeouts.

### Removed

- Controlling media for voice enabled Alexa devices.
- Background refresh. This feature is no longer needed because devices update on demand.

### Fixed

- Cyclical dependency on devices managed by homebridge-alexa plugin.

## [2.1.5] - 2024-06-16

### Changed

- Modified user agent to match Alexa app on iPhone. This seems to resolve the too many requests errors reported in GitHub #129.

## [2.1.4] - 2024-02-16

### Added

- Unsupported device types that can be turned on and turned off are now supported as switches.
- Added a setting to exclude devices. This only applies when the include devices setting, also called `devices`, is empty.

### Changed

- Removed unnecessary alexa-remote2 HTTP calls during plugin startup.

## [2.1.3] - 2024-02-09

### Changed

- Upgraded alexa-remote2 from v6.1.2 to v7.0.3

### Fixed

- Display proper HVAC operation for thermostats

## [2.1.2] - 2024-01-15

### Added

- Guidelines for contributing to this plugin.
- Debug logging for HAP errors raised by this plugin intentionally.

### Fixed

- Resolved a secondary issue with Fan accessories preventing them from being turned on or off.

## [2.1.1] - 2024-01-15

### Added

- Thermostat current state is now supported to show if the HVAC heating/cooling is running.

### Fixed

- Resolved an issue with Fan accessories preventing them from being turned on or off.

## [2.1.0] - 2024-01-03

### Added

- Humidity for thermostats that support it
- Simple game console support (on/off only)

### Fixed

- Improved how thermostat temperatures are updated when thermostat mode is auto

## [2.0.8] - 2024-01-01

### Added

- Simple fan support (on/off only)
- Simple air freshener support (on/off only)
- Increased debug logging for device capabilities on plugin startup to help with troubleshooting and supporting new device types.

## [2.0.7] - 2024-01-01

### Fixed

- Another attempt to fix bug introduced in 2.0.4 for set thermostat mode.

## [2.0.6] - 2023-12-29

### Added

- Alexa Echo devices with temperature sensors now report temperature to HomeKit.

## [2.0.5] - 2023-12-27

### Fixed

- Fixed a bug introduced in 2.0.4 for set thermostat mode.

## [2.0.4] - 2023-12-08

### Added

- Support for set thermostat mode.
- Support for vacuum cleaners.

## [2.0.3] - 2023-11-28

### Added

- Added missing Amazon domains `amazon.in` and `amazon.nl`.

## [2.0.2] - 2023-10-19

### Changed

- Switches that support changing brightness will now appear in HomeKit as light bulbs so that brightness can be controlled from HomeKit.

## [2.0.1] - 2023-10-11

### Changed

- Increased Alexa API timeouts for requests to get device list and get device states.

## [2.0.0] - 2023-10-07

### Added

- Logging for Alexa login process when debug enabled

### Changed

- Upgrade dependencies: alexa-remote2@6.1.2. Node.js 16 is now the minimum required Node.js version.

## [1.0.3] - 2023-09-25

### Added

- Support for smart locks. Only tested with Schlage Encode so far.

## [1.0.2] - 2023-09-16

### Added

- When plugin debug setting is enabled, all device names and types connected to the current Alexa account will be printed in the Homebridge logs.

## [1.0.1] - 2023-09-13

### Changed

- A minimum `device state cache lifetime (cacheTTL)` is now enforced when `refresh device states automatically in the background (backgroundRefresh)` setting is enabled. Automatic refresh will occur every 60 seconds or less frequently as configured. This is to avoid flooding Amazon with request which could result in Homebridge issues and/or Alexa account issues.

## [1.0.0] - 2023-09-13

### Added

- Support for air quality monitors. Includes overall air quality, particulate matter density, VOC density, Carbon Monoxide levels, humidity, and temperature. Only tested with Amazon Air Quality Monitor as of now.

### Changed

- Automatically remove stored Alexa authentication cookie if a `401 Unauthenticated` error occurs on startup. You may need to restart Homebridge to retry the login step.
- Remove `http://` or `https://` from `clientHost` setting if found since these will cause login issues.

## [0.2.1] - 2023-09-11

### Added

- Support for switches. Currently, changing the power and brightness are supported.

## [0.2.0] - 2023-09-08

### Added

- Support Echo smart speaker and smart display devices. Currently, Echo support includes play, pause, next track, previous track, and changing volume. See [Echo device features](https://github.com/joeyhage/homebridge-alexa-smarthome#echo-devices) for instructions.

## [0.1.2] - 2023-09-06

### Fixed

- Thermostats now show correct temperatures when thermostat mode is set to 'AUTO'.

## [0.1.1] - 2023-09-01

### Changed

- Device state cache duration and background refresh can be customized to improve plugin performance and help with 'This plugin slows down Homebridge' messages in the Homebridge logs.

## [0.1.0] - 2023-08-30

### Added

- Support thermostat devices. This includes viewing the current temperature, the set temperature(s), and the mode (OFF, AUTO, COOL, HEAT). Changing the set temperature(s) is also supported.

## [0.0.19] - 2023-08-30

### Fixed

- Handle bad response from Alexa get devices api.

## [0.0.18] - 2023-08-29

### Fixed

- Only create Homebridge accessories for Alexa devices with valid identifiers.

## [0.0.17] - 2023-08-26

### Fixed

- Fixed bug introduced in v0.0.16 with device status caching causing incorrect state to appear in HomeKit.

## [0.0.16] - 2023-08-25

### Added

- Device states are now cached for 30 seconds to reduce unnecessary requests to the Alexa API.

### Changed

- Homebridge Accessory identifiers are generated differently now. Previously, an accessory would not update if a plug was changed to be a light in the Alexa app. This may cause existing devices to be removed and re-added which may break any existing HomeKit automations for those devices.

## [0.0.15] - 2023-08-23

### Added

- Support for outlets i.e. smart plugs.

[unreleased]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.5.1...HEAD
[2.5.1]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.2.1...v2.3.0
[2.2.1]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.1.5...v2.2.0
[2.1.5]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.1.4...v2.1.5
[2.1.4]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.1.3...v2.1.4
[2.1.3]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.1.2...v2.1.3
[2.1.2]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.0.8...v2.1.0
[2.0.8]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.0.7...v2.0.8
[2.0.7]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.0.6...v2.0.7
[2.0.6]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.0.5...v2.0.6
[2.0.5]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.0.4...v2.0.5
[2.0.4]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v1.0.3...v2.0.0
[1.0.3]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v0.2.1...v1.0.0
[0.2.1]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v0.0.19...v0.1.0
[0.0.19]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v0.0.18...v0.0.19
[0.0.18]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v0.0.17...v0.0.18
[0.0.17]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v0.0.16...v0.0.17
[0.0.16]: https://github.com/joeyhage/homebridge-alexa-smarthome/compare/v0.0.15...v0.0.16
[0.0.15]: https://github.com/joeyhage/homebridge-alexa-smarthome/releases/tag/v0.0.15
