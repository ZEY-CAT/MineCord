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

- Runtime databases, legacy imports, and Developer Portal configuration must live outside the checkout in private persistent storage. Never print or expose account, message, or credential contents. `server/data.json` is legacy private data: the owner has authorized a one-time verified migration preserving its exact bytes; do not otherwise inspect, regenerate, restore, stage, commit, upload, or include it in artifacts. Its required SHA-256 is `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`.
- Run `npm run migrate:private-data -- "<absolute-private-directory>"` only against the local checkout after stopping MineCord. The migration verifies the legacy fingerprint, makes a SQLite online backup including WAL state, checks row counts and integrity, creates byte-verified private copies, and activates the configured path only after verification. Keep its private rollback backup until startup and persistence are verified. Never deploy the local migration against Render.
- `.gitignore` does not untrack a file already in Git. Verify `server/data.json` is absent from the staged index before committing. A current-tree deletion does not erase public Git history; do not rewrite history, change repository visibility, or force-push without separate owner authorization.
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
