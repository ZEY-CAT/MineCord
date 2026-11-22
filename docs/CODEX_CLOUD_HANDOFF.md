# MineCord Codex Cloud Handoff

Updated: 2026-11-19

## Migration status

- Repository: `ZEY-CAT/MineCord`, remote `origin` (`https://github.com/ZEY-CAT/MineCord.git`).
- Migration branch: `minecord-cloud-migration`, created from `origin/main` at `6cf140144cafe29ee5a97fb48f777c36111da567`.
- Initial migration implementation commit: `85b8b7f` (`Prepare MineCord cloud migration`).
- Latest source/test commit: `448f0167e18ca7dfebd90d61814b242f582b4645` (`Fix multiplayer chess synchronization`). The latest branch head may be a later handoff-only commit; verify the branch ref before continuing.
- Migration commits: `8f79406969fd8a34854e0363a289df8a6c12d86e` (handoff results), `5d652255968ed08c655a5673869f1c3fe54c41b8` (CI packaging fixes), `eb681661b7773d3fc2a2dc6711e57823af2514a6` (game authorization/macOS packaging fixes), and `448f0167e18ca7dfebd90d61814b242f582b4645` (multiplayer Chess fixes).
- Do not merge this branch into `main` until its diffs and the protected-data issue below are reviewed.
- Source migration review found no tracked application source missing from `origin/main` at the starting commit. This branch adds cloud instructions, safer CI triggers/permissions, a scoped test command, and a test-isolation fix. Existing local edits to `MISSION_PROGRESS.md` and `PROGRESS.md` and untracked scratch/build/private files are intentionally preserved and excluded.
- Before committing or pushing, inspect `git status`, `git diff`, and `git diff --cached`; stage explicit safe files only.

## Current product implementation

The source tree contains a shared web client and Node service with Electron and Tauri shells. The Android Tauri project is checked in and uses the hosted `/app` route. The Tauri shell does not bundle a second server or local account database.

The repository contains implementation for Google and Microsoft OAuth, native external-browser OAuth handoffs, account linking and merging, friend requests, DMs/groups, servers/channels/invites, online presence, notification handling, WebRTC voice/video calls, TURN configuration, the Companion Pet, the Eaglercraft activity adapter, an owner/developer portal, bans, updater tooling, and a PWA shell. See `README.md` and `tests/` for source locations and coverage.

Automated source and browser tests do not prove provider login with live credentials, physical camera/microphone use, two physical clients, signed production packaging, or production deployment of this branch.

## Verification record

- `npm test`: **144 passed, 0 failed, 0 cancelled, 0 skipped**; local duration 98.592 seconds. GitHub run `44645958142` on commit `448f0167e18ca7dfebd90d61814b242f582b4645` also reports **144 passed, 0 failed, 0 cancelled, 0 skipped**. The suite covers auth/deep links, account merging, social persistence, call signaling/configuration, Companion Pet, portal authorization, Minecraft/Eaglercraft activity, PWA behavior, Android bootstrap, updater packaging, and Chess multiplayer regressions. It does not verify provider credentials, physical media, production deployment, or packaged GUI behavior.
- `npm run build`: **passed** locally; built 33 frontend files into ignored `dist/web`. CI's Tauri Lite web job passed and built 32 edition-specific files.
- Focused server integration suite: `node --test tests/server.test.js` — **24 passed, 0 failed** with loopback access. Chess-specific tests: `node --test tests/chess-multiplayer.test.js` — **2 passed, 0 failed**.
- Dependency audit: `npm audit --omit=dev --audit-level=moderate` reported **0 production dependency vulnerabilities**. Full `npm audit --audit-level=moderate` reported six moderate advisories through the development-only Electron packaging chain, all rooted in `minimatch@10.2.6` nested under `app-builder-lib`. The lockfile's installed `electron-builder` is 26.18.1; npm's suggested clean fix requires a forced downgrade to 25.1.0. No forced dependency downgrade or unverified major override was applied.
- Cloud config checks: all three edited workflow YAML files parsed successfully with `js-yaml`; `bash -n scripts/setup-cloud.sh` passed under Git Bash. Environment versions are Node.js 24.16.0 and npm 11.13.0.
- Android Gradle configuration: `gradle.properties` sets a 2 GB heap, 768 MB metaspace cap, one worker, parallel disabled, and in-process Kotlin. Tauri requested `assembleUniversalDebug`, but the checked-in app Gradle file had no `universal` product flavor. The flavor was added with a regression test.
- Android debug build: the normal `npm run tauri -- android build --apk --ci` launcher failed SDK preflight because this host did not propagate the D: SDK/NDK variables to Tauri. Invoking the Tauri CLI directly through Node with `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and `NDK_HOME` explicitly set succeeded; Gradle `:app:assembleUniversalDebug` also succeeded. The APK is `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`, 27,211,681 bytes, SHA-256 `c5f19265787659e7c88c199b7abdbed02ba47b0e3b32eecd9ff28530e733400e`. `apksigner verify --verbose` passed with v2 signing. Package `com.minecord.app`, version 1.0.2 / versionCode 1001, debug-signed, ABIs arm64-v8a and x86_64. This is a debug artifact, not a release-signed package.
- Android emulator: `Medium_Phone_API_37.0` was booted without wiping data; an earlier `sys.boot_completed` probe returned `1`. This session recovered the ADB daemon by redirecting `TEMP`/`TMP` to `D:\Temp`, and `adb devices -l` listed `emulator-5554`. However, shell `getprop` timed out after 12 seconds and `adb install`/launch produced no output for about 61 seconds before interruption. The APK is **not verified installed or launched**, and no screen was verified. C: has 0 bytes free; no AVD data was wiped or recreated.
- GitHub Actions on latest source commit `448f0167e18ca7dfebd90d61814b242f582b4645`: Tauri run `44645958142` **passed** Windows Tauri, Linux Tauri, Android debug APK, web build/tests, macOS Intel, and macOS Apple Silicon; developer checks run `44645958224` **passed**. Workflow Release jobs were skipped (manual opt-in is required). Artifacts verified present: `mincord-android-debug` (artifact ID `14589685686`, 55,284,625-byte ZIP; contained APK 56,829,371 bytes, verified with APK Signature Scheme v2), `mincord-windows-tauri`, `mincord-linux`, `mincord-macos-x86_64-apple-darwin`, `mincord-macos-aarch64-apple-darwin`, and `mincord-web`.
- Updater CI run `44642868669` passed DLL build/signature checks, the updater installer, and Windows Electron packaging; artifacts `mincord-updater-dll`, `mincord-updater-installer`, and `mincord-windows-electron` were uploaded. A later package fix removed the DLL from Electron `extraResources` while retaining the runtime fallback for older bundles.
- Windows Tauri packaging: local `npm run tauri:build` reached native Rust compilation with normal filesystem access, but parallel compilation failed with allocation errors and `STATUS_STACK_BUFFER_OVERRUN`. A retry with `CARGO_BUILD_JOBS=1` failed allocating 2,096,640 bytes for `windows-sys`. No local package or GUI launch was verified. The first pushed CI did build and upload the Windows Tauri artifacts. The Tauri bundle warns that identifier `com.minecord.app` ends in `.app`; this existing cross-platform identifier was not changed.
- macOS/Linux: latest CI built and uploaded Linux, macOS Intel, and macOS Apple Silicon packages. Apple certificate import and notarization were skipped because signing credentials were unavailable; these are CI artifacts, not signed production releases.
- Windows Electron package: CI built and uploaded the package, but no local packaged GUI startup test was performed. Windows Tauri artifact build passed; the local Windows native build remains memory-constrained.
- Live Google/Microsoft OAuth: requires valid provider credentials and registered callbacks; not exercised.
- Physical camera/microphone and two independent clients: not exercised. Automated WebRTC signaling tests pass, but they do not prove physical media.
- Production read-only GET checks on 2026-11-19 returned HTTP **200** for `/app`, `/download`, `/health`, and `/api/config`. These are the currently deployed Render service responses; the migration branch has not been deployed.
- Protected data hash: local `server/data.json` remains `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`; it is tracked in the starting `origin/main` commit and inherited by this branch. GitHub reports repository visibility is **public**. No contents were read, and no migration commit changes or explicitly packages the file; GitHub Actions checks out the inherited repository tree. Treat the existing remote history as exposed. This is a release blocker: do not merge or deploy until the repository owner resolves visibility and history exposure safely. Force-pushing or rewriting history was not performed. The local `gh` CLI credential is invalid, and the connected GitHub API cannot change repository visibility.
- Local Android install attempt: ADB only starts when `TEMP`/`TMP` point to `D:\Temp` (the C: drive has 0 bytes free). `adb devices -l` lists `emulator-5554`, but `adb shell getprop sys.boot_completed` and the debug APK install/launch request timed out; no installed screen was verified. The existing AVD was not wiped or recreated.
- Multiplayer game audit: server now rejects unsupported game types, prevents unrelated users from declining another pair's invite, and rejects repeated accept actions. Chess black-turn mapping, authoritative client state, history parsing, local-only undo, coordinate bounds, promotion, and a server king-scan crash were fixed and tested. The Chess implementation still lacks full rules such as check/checkmate, castling, en passant, and server-authoritative clocks; do not describe multiplayer Chess as full-rule chess.

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

1. Resolve the public-repository/protected-history exposure through an owner-approved GitHub privacy and history remediation. Do not alter `server/data.json` or force-push as part of routine development.
2. Re-run Android install/startup on a responsive emulator after freeing host space; verify the rendered `/app` UI without wiping existing emulator state.
3. Exercise Google/Microsoft OAuth with provider credentials, calls between independent clients/devices, and camera/microphone permissions; verify TURN relay from a separate network.
4. Complete full-rule multiplayer Chess and a real-client pass for all four multiplayer games; do not overstate simplified chess support.
5. Verify the persistent Render disk/database location, native packaged GUI startup, and platform permissions. Obtain stable signing/notarization credentials before production release.
6. Keep production deployment and GitHub Releases restricted to a separately reviewed, verified `main` release.

## Local continuation update — 2026-11-22

- Implemented main MineCord account password change in Settings. Requires current password, 8–200-character new password, fresh scrypt salt/hash, `Cache-Control: no-store`, and transactional revocation of other sessions while preserving the active session. Added isolated database and HTTP tests.
- Completed the server-authoritative multiplayer Chess rules gap identified above: check safety, castling and rights, en passant, all four promotions, checkmate, stalemate, dead positions, repetition/move-count draw rules and claims, resignation, and result reporting. The UI exposes promotion choices, draw claims, and match results. Solo mode remains casual local Chess and is explicitly labeled accordingly.
- Latest verification: full checked-in test suite **156 passed, 0 failed, 0 cancelled, 0 skipped**; `npm run build` passed with 34 frontend assets; focused password/Chess/database/settings tests passed (23/23 before the final two Chess cases, then Chess suite 10/10). See `MISSION_PROGRESS.md` for the detailed verification record.
- The password HTTP test originally failed under restricted loopback with `EACCES`; rerunning with approved local-network test access succeeded. `TEMP`/`TMP` and npm cache were directed to D:; no files were deleted to make space.
- GitHub repository metadata currently confirms visibility **public** and admin permission for the connected GitHub identity, but the local `gh` token is invalid and the available connector has no visibility-setting operation. `server/data.json` remains present with the protected hash and was neither read nor modified. No history rewrite, commit, push, deployment, or release occurred. Do not push/merge until the owner remediates public-history exposure safely.
- Still unverified: live Google/Microsoft OAuth, real audio/video between independent clients and TURN relay, Render persistent-disk survival, Android emulator UI/performance, packaged GUI startup, stable signing/notarization, and Play Store compliance. These require the live provider, two real call devices/networks, hosting configuration, emulator/hardware, and platform credentials respectively.
