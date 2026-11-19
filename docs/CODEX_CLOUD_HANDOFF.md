# MineCord Codex Cloud Handoff

Updated: 2026-11-19

## Migration status

- Repository: `ZEY-CAT/MineCord`, remote `origin` (`https://github.com/ZEY-CAT/MineCord.git`).
- Migration branch: `minecord-cloud-migration`, created from `origin/main` at `6cf140144cafe29ee5a97fb48f777c36111da567`.
- Initial migration implementation commit: `85b8b7f` (`Prepare MineCord cloud migration`). Check the branch ref for the latest commit after handoff finalization.
- Do not merge this branch into `main` until its diffs and CI results have been reviewed.
- Source migration review found no tracked application source missing from `origin/main` at the starting commit. This branch adds cloud instructions, safer CI triggers/permissions, a scoped test command, and a test-isolation fix. Existing local edits to `MISSION_PROGRESS.md` and `PROGRESS.md` and untracked scratch/build/private files are intentionally preserved and excluded.
- Before committing or pushing, inspect `git status`, `git diff`, and `git diff --cached`; stage explicit safe files only.

## Current product implementation

The source tree contains a shared web client and Node service with Electron and Tauri shells. The Android Tauri project is checked in and uses the hosted `/app` route. The Tauri shell does not bundle a second server or local account database.

The repository contains implementation for Google and Microsoft OAuth, native external-browser OAuth handoffs, account linking and merging, friend requests, DMs/groups, servers/channels/invites, online presence, notification handling, WebRTC voice/video calls, TURN configuration, the Companion Pet, the Eaglercraft activity adapter, an owner/developer portal, bans, updater tooling, and a PWA shell. See `README.md` and `tests/` for source locations and coverage.

Automated source and browser tests do not prove provider login with live credentials, physical camera/microphone use, two physical clients, signed production packaging, or production deployment of this branch.

## Verification record

- `npm test`: **141 passed, 0 failed, 0 cancelled, 0 skipped**; duration 82.408 seconds. This was the checked-in `tests/**/*.test.js` suite with loopback access. Coverage includes auth/deep links, account merging, social persistence, calls and signaling, the companion, portal authorization, Minecraft linking/activity, PWA behavior, and Android bootstrap configuration. It is automated verification, not live-provider or physical-device verification.
- `npm run build`: **passed**; built 33 frontend files into ignored `dist/web`.
- Dependency audit: `npm audit --omit=dev --audit-level=moderate` reported **0 production dependency vulnerabilities**. Full `npm audit --audit-level=moderate` reported six moderate advisories through the development-only Electron packaging chain, all rooted in `minimatch@10.2.6` nested under `app-builder-lib`. The lockfile's installed `electron-builder` is 26.18.1; npm's suggested clean fix requires a forced downgrade to 25.1.0. No forced dependency downgrade or unverified major override was applied.
- Cloud config checks: all three edited workflow YAML files parsed successfully with `js-yaml`; `bash -n scripts/setup-cloud.sh` passed under Git Bash. Environment versions are Node.js 24.16.0 and npm 11.13.0.
- Android Gradle configuration: `gradle.properties` sets a 2 GB heap, 768 MB metaspace cap, one worker, parallel disabled, and in-process Kotlin. Tauri requested `assembleUniversalDebug`, but the checked-in app Gradle file had no `universal` product flavor. The flavor was added with a regression test.
- Android debug build: the normal `npm run tauri -- android build --apk --ci` launcher failed SDK preflight because this host did not propagate the D: SDK/NDK variables to Tauri. Invoking the Tauri CLI directly through Node with `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and `NDK_HOME` explicitly set succeeded; Gradle `:app:assembleUniversalDebug` also succeeded. The APK is `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`, 27,211,681 bytes, SHA-256 `c5f19265787659e7c88c199b7abdbed02ba47b0e3b32eecd9ff28530e733400e`. `apksigner verify --verbose` passed with v2 signing. Package `com.minecord.app`, version 1.0.2 / versionCode 1001, debug-signed, ABIs arm64-v8a and x86_64. This is a debug artifact, not a release-signed package.
- Android emulator: `Medium_Phone_API_37.0` was launched without wiping data. Its default 4 GB guest allocation failed because Windows had only about 3.3 GB of commit headroom. A temporary QEMU `-m 2048` launch override brought the AVD online and `sys.boot_completed` returned `1`. Subsequent `adb install` and shell requests stalled for over two minutes; they were interrupted. The app was **not verified installed or launched**, and no screen was verified. Emulator startup/installation remains blocked by the current host/ADB responsiveness.
- Windows Tauri packaging: `npm run tauri:build` reached native Rust compilation when run with normal filesystem access, but parallel compilation failed with Rust allocation errors and `STATUS_STACK_BUFFER_OVERRUN`. A retry with `CARGO_BUILD_JOBS=1` failed allocating 2,096,640 bytes for `windows-sys`. No fresh Windows package or GUI launch was verified. The Tauri bundle also warns that identifier `com.minecord.app` ends in `.app`; this existing identifier was not changed because it is shared with platform package/deep-link configuration.
- macOS/Linux: workflows are configured, but no CI run has been observed for this migration branch yet.
- Live Google/Microsoft OAuth: requires valid provider credentials and registered callbacks; not exercised.
- Physical camera/microphone and two independent clients: not exercised. Automated WebRTC signaling tests pass, but they do not prove physical media.
- Production read-only GET checks on 2026-11-19 returned HTTP **200** for `/app`, `/download`, `/health`, and `/api/config`. These are the currently deployed Render service responses; the migration branch has not been deployed.
- Protected data hash: checked after the build and full test run as `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`. Verify once more before push. Never stage or upload that file.

## Cloud setup

1. Use Node.js 24+ and npm.
2. On Linux, install the system libraries required by the target. Tauri's current Linux, Android, and Rust prerequisites are documented at [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
3. Run `bash scripts/setup-cloud.sh` to install the exact `package-lock.json` dependency tree. Use `bash scripts/setup-cloud.sh --production` only for runtime-only server deployment.
4. Run `npm test` and `npm run build`.
5. For Tauri desktop builds, install the host toolchain and run `npm run tauri:build`. For Android, install Android SDK/NDK, JDK 17, and Rust Android targets, then use the Android workflow or `npm run tauri -- android build --apk --ci`.

No setup script writes credentials. Configure runtime secrets through the deployment platform or GitHub Secrets, never in the repository.

## Credentials and device checks

Potentially required environment/secret names include `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `TURN_URL`, `TURN_SHARED_SECRET`, `METERED_APP_NAME`, and `METERED_SECRET_KEY`. Keep values private. A release-quality Android update also requires a stable Android signing keystore; macOS distribution requires Apple Developer signing/notarization credentials; Windows signing requires the configured code-signing credentials. CI-generated or debug signing keys are not stable update keys.

Still required where unavailable: provider-controlled OAuth sign-in, an Android emulator/device with working graphics and microphone/camera, a second independent call client, platform signing credentials, and access to the existing Render service's deployment state.

## Recommended continuation order

1. Verify the protected hash, review the explicit migration diff, and push only the intended cloud/build changes to `minecord-cloud-migration`; leave local progress edits, user data, `.env*`, SQLite files, ignored build outputs, and scratch files untouched.
2. Review migration-branch GitHub Actions artifacts and address any CI-only failures.
3. Re-run a Windows package build on a host with sufficient memory, then verify packaged GUI startup.
4. Install the Android debug APK on a responsive emulator or device and verify the `/app` interface; exercise live OAuth and calls between independent devices.
5. Prepare stable platform signing and release metadata. Keep publishing manual and restricted to reviewed `main` commits.
