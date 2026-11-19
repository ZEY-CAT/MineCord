# MineCord Development Guide

## Architecture

- `public/` contains the web application, shared UI, notifications, PWA worker, companion pet, and WebRTC client.
- `server/server.js` hosts the Express application and WebSocket signaling. Feature services are split across `server/*.js`; `server/database.js` owns SQLite persistence.
- `desktop/` contains the Electron shell, native OAuth/deep-link handling, and activity integration.
- `src-tauri/` contains the Rust/Tauri shell, capabilities, desktop overlay bridge, and checked-in Android project under `src-tauri/gen/android/`.
- `browser-extension/` contains the Eaglercraft activity connector.
- `tests/` is the complete checked-in Node test suite. `npm test` intentionally targets this directory so unrelated local tools and scratch directories are not auto-discovered.
- `.github/workflows/` contains the test/web workflow, cross-platform Tauri workflow, and Windows updater workflow.

## Safe development commands

- Requires Node.js 24 or newer and npm. Run `bash scripts/setup-cloud.sh` in Linux cloud environments to verify Node and install exactly from `package-lock.json`.
- `npm test` runs the checked-in tests with two workers. Some integration tests start loopback HTTP/WebSocket servers; the execution environment must permit local loopback connections.
- `npm run build` creates the web build under ignored `dist/`.
- `npm run tauri:build` builds the Tauri desktop target supported by the current host and installed toolchain.
- Android CI uses `npm run tauri -- android build --apk --ci`; it requires Android Studio SDK/NDK, JDK 17, and Rust Android targets.
- Use `npm ci`, not `npm install`, for a clean lockfile-based dependency install.

## Data and secrets protection

- `server/data.json` is protected local user data. Never read its contents, modify it, regenerate it, restore it, copy it, stage it, commit it, upload it, or include it in an artifact. Its required SHA-256 is `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`.
- Keep `.env`, `.env.txt`, `DEV-LOGINS.json`, SQLite databases and sidecars, OAuth/API secrets, signing keys, emulator images, `node_modules/`, `dist/`, `build/`, and `src-tauri/target/` out of Git and release artifacts.
- Preserve all pre-existing tracked edits and untracked files. Never use `git reset --hard`, destructive `git clean`, or force-push. Stage explicit reviewed paths only.
- Use temporary isolated databases for tests. Do not let tests depend on a developer's local account database or credentials.

## Important feature locations

- OAuth, account linking/merging, owner authorization, bans, presence, messaging, and server APIs: `server/` and `public/index.html`.
- Native browser OAuth and return links: `public/native-oauth.js`, `desktop/main.js`, `desktop/preload.js`, and `src-tauri/`.
- WebRTC media and controls: `public/calls.js`; signaling and call membership: `server/server.js`.
- Companion UI/state/animations: `public/companion.js`, `public/companion.css`, `public/companion.html`; native Tauri overlay bridge: `src-tauri/src/lib.rs`. Android keeps the pet in the app and must not request Android's unrestricted overlay permission.
- Web push and PWA shell: `public/notifications.js` and `public/sw.js`.
- Minecraft activity adapter: `browser-extension/`, `desktop/activity-monitor.js`, and `server/games*.js`.
- Feature tests: matching files in `tests/`.

## Platform and release limitations

- Web and Windows builds are available in the repository. The Android Tauri project is checked in. iOS/iPadOS packaging is not currently configured or verified.
- Windows, macOS, Linux, Android, and web artifacts are configured in `.github/workflows/tauri-build.yml`. Pull requests to `main` and pushes to `minecord-cloud-migration` run the build jobs and upload workflow artifacts.
- GitHub Release jobs must remain manual, explicitly opted in, and restricted to `main`. Missing platform signing credentials must be reported; a CI artifact or debug APK is not a production release.
- A passing automated browser/unit test is not physical-device, real OAuth-provider, camera/microphone, app-store, or production-deployment verification.

## Completion reporting

- Inspect the actual checkout, branch, remotes, diffs, artifacts, and protected-data hash before making claims.
- Report exact test/build commands and outcomes. Distinguish source inspection, automated tests, CI artifacts, and real-device testing.
- Do not claim a feature, package, deployment, or release is complete unless its required verification actually ran. List remaining credentials, signing, hardware, and external-service blockers explicitly.
