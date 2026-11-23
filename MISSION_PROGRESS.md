# MineCord mission progress

- Baseline: 87 tests pass, web build succeeds.
- Added Escape-to-close Settings.
- Added settings category selector with Account/Minecraft/Activity panels.
- Added settings search input with category switching.
- Added settings category persistence via localStorage.
- Added Eaglercraft extension download link and ZIP.
- Fixed Minecraft/Bedrock linking result to open Minecraft category.
- Added polished Settings card styling.
- Added gaming gradient background.
- Added Gamer UI toggle with localStorage persistence.
- Added first-login Gamer UI prompt.
- Fixed app to show login screen immediately while auth check runs.
- Added regression tests tests/ui-settings.test.js.
- Updater uses tauri-plugin-updater across targets; Windows-only libloading removed.
- Rust build/test passes; web build passes; full JS suite 98 pass.
- Validation workflow triggered: https://github.com/ZEY-CAT/MineCord/actions/runs/40756928990 (create_release=false). Results pending.
- Windows artifact launched and was responsive; no release published.
- CI run 40756928990 completed successfully across Windows, Linux, Android, Web, and both macOS targets.
- server/data.json SHA-256 unchanged.
- Remaining: signed updater credentials/endpoints, multi-platform native CI, full feature audit.

## Separate Developer Portal recovery and implementation — 2026-11-01

Recovered the existing `main` branch at `2ccefb96948e8b4d40b7a8197e0414fc5c205ea`. The worktree already contained substantial unrelated modified/untracked work. The staged deletion of `server/data.json` predates this portal work and was left untouched; its local file remains present.

### Work already present when this session resumed

- Separate `/dev` Express router, dedicated login sessions, scrypt password hashes, invitation redemption, owner controls, GitHub Device Flow, and server-side GitHub token handling.
- Path-allowlisted source browsing/search and per-developer workspace overlays outside the repository checkout; file edits did not alter repository files.
- Portal editor UI with tabs, highlighting, find/replace, diffs, and explicit save; GitHub branch/check/history views and selected-file branch/PR workflow.
- Initial portal regression tests, an ignored `DEV-LOGINS.json` setup file, interactive owner bootstrap script, and a read-only GitHub Actions test/build workflow.

### Completed and hardened in this session

- Kept `/dev` separate from MineCord navigation and added explicit user-facing links to GitHub, Codespaces, and Copilot. Codespace creation link requires a confirmation because GitHub may incur charges.
- Hardened login timing for unknown usernames and retained server-side session, approval, and same-origin checks.
- Changed the owner vault API to expose key names only. Owners can set/replace or remove entries, but saved values are never returned to browser JavaScript; developers are denied vault APIs. This deliberately prioritizes the requirement not to expose secret values to browser code, so owners cannot reveal a saved value in the portal.
- Updated the portal, regression test, and README for write-only vault behavior, invitation/account management, GitHub base-branch behavior, and setup limitations.

### Files created or modified for the Developer Portal

- Created: `server/dev-portal.js`, `server/developer-hub.js`, `public/dev-portal.html`, `public/dev-portal.css`, `public/dev-portal.js`, `scripts/bootstrap-dev-owner.js`, `tests/dev-portal.test.js`, `tests/developer-hub.test.js`, `.github/workflows/developer-checks.yml`, and ignored local `DEV-LOGINS.json`.
- Modified: `server/server.js`, `.gitignore`, `README.md`, and this progress report.
- `DEV-LOGINS.json` is not tracked. No credentials were added to it in this work.

### Verification

- Focused portal/source tests: `node --test tests/dev-portal.test.js tests/developer-hub.test.js` — **15 passed, 0 failed**.
- Full suite: `npm test` — **113 passed, 0 failed**. The existing OpenCode Bridge test logs a Git error because its fixture directory is not a Git repository, but the test itself exits successfully.
- Production web build: `npm run build` — **succeeded**; `dist\web\dev-portal.html` and `dist\web\dev-portal.js` were verified present.
- `node --check` passed for the portal server, browser script, and portal tests.
- Production route probe: GET `https://minecord-8vg2.onrender.com/dev` timed out after 10 seconds with no response (`curl` status 000); live availability is **not verified**. No deployment was performed.
- `server/data.json` SHA-256: `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`, matching the expected value. Its pre-existing staged deletion was not changed. No database, environment file, signing key, release, or production setting was modified.

### Access and remaining limitations

- Local portal URL: `http://localhost:3000/dev`; intended production URL: `https://minecord-8vg2.onrender.com/dev`.
- Create the initial owner locally using `node scripts/bootstrap-dev-owner.js <portal-username>` in an interactive terminal; the script prompts without echoing the password. The owner creates single-use invitations and can revoke accounts under **Owner controls**. Provision `DEV-LOGINS.json` privately on the host before enabling portal sign-in.
- Workspaces default to the operating-system temporary directory. Set `MINECORD_DEVELOPER_WORKSPACE_ROOT` only to a protected persistent mount if workspace retention is needed; Render persistence was not verified.
- The portal selects a GitHub base branch and can explicitly create/push a new feature branch and open a PR for selected files; it does not check out/switch the editor workspace to remote branch contents. GitHub operations were tested with mocks only. Remote OAuth, pushes, PRs, and Actions have not been verified.
- Codespaces and Copilot are links to GitHub workflows, not embedded integrations; the portal does not create or resume Codespaces. The portal does not execute edited code on the production server. GitHub Actions runs tests/build on configured branch/PR events.
- Vault storage is plaintext in the ignored `DEV-LOGINS.json` (host filesystem permissions and private backups are required); it is not encrypted at rest and does not edit production environment variables. The vault is write-only from the portal UI/API to ensure stored values are not returned to browser code.
- No commit, push, deployment, release, production configuration change, or Git tracking/index operation was performed.

## False server-invitation authentication message — 2026-11-01

- Fixed the authenticated app startup path: it previously hid the login form, connected to MineCord, then unconditionally set “Sign in or create an account to accept this server invitation.” and reopened the login modal—even when there was no invitation.
- The app now validates `?invite=` against the server preview API before treating it as an active invitation. Invalid, expired, malformed, or unverifiable invitation state is removed from the URL; unauthenticated users see the appropriate invitation error, while signed-in users continue into the app and see an invitation-specific alert. Valid invitations continue through local login, registration, and OAuth back to acceptance.
- Added `tests/auth-invitation-flow.test.js` for local login, registration, OAuth return, valid invitations, expired/malformed invitations, and stale-link cleanup.
- Focused invitation/OAuth checks passed (16 tests). Final `npm test`: **118 passed, 0 failed**.
- Final `npm run build` succeeded. The build validates all inline scripts and copies the production web assets. No deployment was performed.
- The only remaining exact user-facing invitation prompt is shown for an authenticated invitation that passed server-side preview, or for a user signing in with a still-valid invitation URL.

## Developer Portal AI and account-management continuation — 2026-11-01

Resumed from the interrupted AI-assistant implementation. At that stopping point, the server-side AI router, encrypted vault helpers, and AI panel markup/styles existed, but the browser event handling was incomplete, the OpenAI streaming flow had not been exercised, and no AI regression tests or setup documentation existed.

### Implemented

- Wired the `/dev` AI panel to provider status/preferences, isolated conversation listing/creation/deletion, OpenAI streaming, project-file and selected-code context, test/build output, code-block copy and JSON formatting, and proposal diff review.
- Added explicit proposal rejection. Applying a proposal requires explicit confirmation, is restricted to that developer's isolated workspace, and rejects stale file content. AI never runs commands or commits/pushes/merges/deploys.
- Finished the backend OpenAI Responses API integration, including server-only encrypted key retrieval, `store:false`, SSE parsing, bounded responses/timeouts, sanitized provider errors, and per-developer request limits. API tests mock provider replies; no real key/model was used.
- Kept GitHub Copilot accurately identified as an external GitHub/Codespaces workflow. No embedded Copilot runtime or per-developer official CLI authentication is configured; OpenAI is not mislabeled as Copilot.
- Added AES-256-GCM vault encryption using a separately provisioned 32-byte `MINECORD_DEV_VAULT_KEY`; existing legacy values are migrated only when that key is configured. Saved values are never returned to portal JavaScript. No local or production credentials were inspected or changed for this work.
- Extended the shared secret scanner to recognize OpenAI-style keys and block secret-like credentials in AI prompts; historical conversation entries matching the scanner are excluded from future provider context.
- Enabled multiple portal owners. An owner may promote or demote an existing invited account only after re-entering the current owner password; the last owner and the current owner's own role cannot be removed through this UI/API.
- Added authenticated password changes; password policy is now 8–200 characters for portal invitations, password changes, and owner bootstrap. Existing password hashes are preserved until each user changes their password. Other sessions for the account are invalidated.
- The ignored local portal account metadata confirms `ZEY-CAT` already has the owner role. Tests use an isolated temporary `DEV-LOGINS.json`; they do not modify the local file.

### Files changed in this continuation

- `server/dev-portal-ai.js`
- `server/dev-portal.js`
- `server/developer-hub.js`
- `public/dev-portal.js`
- `public/dev-portal.html`
- `public/dev-portal.css`
- `tests/dev-portal.test.js`
- `README.md`
- `MISSION_PROGRESS.md`

### Verification and remaining blockers

- Focused portal/source tests: `node --test tests/dev-portal.test.js tests/developer-hub.test.js` — **18 passed, 0 failed**.
- Full suite: `npm test` — **121 passed, 0 failed**. The pre-existing OpenCode Bridge fixture prints a Git “not a repository” diagnostic, but its test passes.
- Production web build: `npm run build` — **succeeded**. Verified `dist/web/dev-portal.html`, `dev-portal.js`, and `dev-portal.css` contain the separate portal and AI panel assets. The route itself is also exercised by portal HTTP tests.
- AI provider behavior was verified with mocked OpenAI responses, including auth failures, streaming, owner-only configuration, conversation isolation, context filtering, patch application/rejection, and stale patch handling. **Real OpenAI access is unverified** because no live provider credential was configured. `MINECORD_DEV_VAULT_KEY` is not present in the current shell; provision it privately on the host before saving encrypted credentials.
- GitHub Copilot remains an explicitly external workflow. Live provider integration, production `/dev` availability, Render persistent storage, and production credential provisioning remain unverified. No deployment was performed.
- `server/data.json` remains present locally with SHA-256 `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`, matching the protected expected hash. Its pre-existing staged deletion remains unchanged. The repository is still dirty with the earlier unrelated changes and untracked files; no commit, push, deployment, release, or destructive Git operation occurred.

### Portal account and credential instructions

- Local entry point: `http://localhost:3000/dev`; intended production entry point: `https://minecord-8vg2.onrender.com/dev`. Production access was not live-probed or deployed.
- The existing local owner is `ZEY-CAT`. Invite the second owner as a developer, then an owner signs in, opens **Owner controls**, chooses **Make owner**, and re-enters their portal password. The same control can return that account to developer access; a final owner cannot be demoted.
- Users can change their separate portal password from **Account → Change portal password**. The enforced policy is 8–200 characters; other portal sessions are signed out.
- Back up the private `DEV-LOGINS.json`, provision a random 64-character hexadecimal `MINECORD_DEV_VAULT_KEY` as a private host environment secret, and retain the key securely. Losing it prevents recovery of encrypted values. The owner can then enter an OpenAI key and choose a model in the AI configuration panel. Neither the key nor secret values are returned to browser APIs.

## Developer Portal follow-up — 2026-11-02

- Changed Developer Portal invitations, password changes, and initial-owner bootstrap to accept passwords from 8 to 200 characters. Scrypt remains in use; existing users' stored hashes were not modified or reset.
- Kept the existing local `ZEY-CAT` account as owner and added a server-side invariant preventing any owner from demoting that account. Additional invited developer accounts can be promoted/demoted only by a portal owner who re-enters their current password; owner-only APIs continue to authorize based on the server-side account role. At least one owner must remain.
- The private local `DEV-LOGINS.json` account metadata currently contains only the `ZEY-CAT` owner; no second developer account corresponding to the user's brother is present to promote. No username was guessed and no account was added. Once the correct existing developer account is available in the portal config, an owner can select it from the account list and choose **Make owner**.
- Updated password and encrypted OpenAI credential setup documentation. The OpenAI key is configured only after `MINECORD_DEV_VAULT_KEY` is provisioned privately; API key values remain encrypted at rest and server-side. Tests cover missing provider credentials and sanitized invalid-key responses using mocked provider responses; no real key or production setting was used.
- Focused portal/source tests: `node --test tests/dev-portal.test.js tests/developer-hub.test.js` — **18 passed, 0 failed**.
- Full `npm test` — **121 passed, 0 failed**. The pre-existing OpenCode Bridge test prints a Git “not a repository” diagnostic from its fixture, but passes.
- Production `npm run build` — **succeeded**; the web build staged 27 frontend assets.
- Regression coverage confirms 8-character invite registration and password change succeed, 7-character values fail, multiple invited owners can be promoted/demoted with password confirmation, server APIs enforce owner access, and `ZEY-CAT` cannot be demoted. OpenAI missing-key and invalid-key behavior was exercised with mocked provider responses and sanitized errors; no external credential was used.
- Post-test `server/data.json` SHA-256: `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`, matching the expected value. Its pre-existing staged deletion remains unchanged. Existing accounts/password hashes were not reset; the private production configuration and settings were not changed. No commit, push, deployment, release, or destructive Git action occurred.
- Remaining: the local ignored portal config currently has no second developer account to promote, so no brother account was guessed or created. An owner can promote the correct existing account after it is present in the portal account list. A real OpenAI provider key/model and production/Render configuration remain unverified and require private operator provisioning.

## Project-wide audit continuation — 2026-11-02

- Fixed an owner-controls UI mismatch: the account list no longer offers “Make developer” for the protected `ZEY-CAT` owner, an action the backend correctly rejects.
- Expanded Developer Portal password regression coverage to verify the inclusive 8–200-character boundary on invitation redemption and password changes; 7/201-character inputs are rejected, and 8/200-character passwords are accepted. Scrypt and existing credentials remain unchanged.
- Added local HTTP smoke coverage for `/app`, `/download`, and the separate `/dev` portal route without making external release API calls.
- Focused regression command: `node --test tests/dev-portal.test.js tests/developer-hub.test.js tests/server.test.js` — **42 passed, 0 failed**.
- Full `npm test` — **122 passed, 0 failed**. The pre-existing OpenCode Bridge test still prints its Git fixture diagnostic; it passes.
- `npm run build` — **succeeded**, building 27 static frontend assets. `node --check` passed for modified JavaScript; `git diff --check -- tests/server.test.js` reported no whitespace errors.
- The test suite exercises mocked OAuth and AI behavior, invitation/account flows, account merging, server permissions and persistence, direct/group messaging, calls and signaling, game synchronization, presence, TURN configuration, updater signatures, Developer Portal access/vault/workspaces, and static routes. These tests do not establish live OAuth/provider access or real two-way browser audio.
- A read-only security review reported **no confirmed vulnerabilities in the reviewed changes**. It noted that secret scanning is pattern-based and that deployment secrets, private configuration, database contents, and signing-key contents were not inspected. No secrets were printed or sent to external providers.
- `/download` page routing passed the local smoke test; live GitHub release metadata/assets were not contacted. No browser E2E configuration or dedicated lint/type-check script is present in the inspected package scripts. Production OAuth, WebRTC media, OpenAI credentials, Copilot embedding, Render persistence, and live release downloads remain unverified.
- `server/data.json` SHA-256 after verification: `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`, matching the protected expected hash. `git status --short -- server/data.json` still reports the pre-existing staged deletion (`D  server/data.json`); the local file was not modified and the index was not changed.
- Existing modified and untracked files were preserved. No commit, push, deployment, release, production configuration change, or destructive Git operation occurred.

## Final pre-deployment verification — 2026-11-07

### Changes made

- Aligned main MineCord local-account registration with the requested 8–200-character password policy. The backend still uses scrypt; the login/registration field now says `8+` and retains its 200-character maximum. Existing account hashes and OAuth flows were not changed.
- Added registration regression checks for rejecting 7 and 201 characters and accepting 8 and 200 characters. The `/app` smoke test checks the updated label.
- Added optional `MINECORD_DEV_LOGINS_PATH` support to the server and owner-bootstrap script. This lets operators keep portal accounts, invitations, and encrypted vault entries on a persistent mount rather than the ephemeral checkout filesystem; the existing repository-root default is unchanged. README now documents using a persistent path with `DATABASE_URL` and `MINECORD_DEVELOPER_WORKSPACE_ROOT`.
- The existing route smoke test also verifies the server can authenticate the portal owner from the configured external login-file path.

### Verification

- Focused application/portal tests: `node --test tests/server.test.js tests/dev-portal.test.js tests/developer-hub.test.js` — **42 passed, 0 failed**.
- Focused stale-invitation tests: `node --test tests/auth-invitation-flow.test.js` — **5 passed, 0 failed**.
- Full `npm test` — **122 passed, 0 failed**. The pre-existing OpenCode Bridge fixture still emits a Git “not a repository” diagnostic, but its test passes.
- Final `npm run build` — **succeeded**, producing 27 static frontend assets. JavaScript syntax checks and `git diff --check` passed; Git emitted only its existing LF-to-CRLF working-copy notices.
- Local test coverage exercises auth and account permissions, OAuth-state handling with mocks, friendship/DM and server persistence, calls/signaling, multiplayer game synchronization, TURN configuration, Developer Portal isolation/vault/AI flows, and route responses. It does not prove real microphone/camera media, two-way audio, live OAuth exchanges, or live OpenAI requests.

### Live read-only checks

- Production `GET /health` succeeded and reported commit `2ccefb96948e8b4d40b7a8197e0414fc5c205ea9`. One initial health request timed out; a subsequent request succeeded. The local changes in this section are not deployed.
- Production `GET /api/config` reported the HTTPS production origin and `google`, `microsoft`, `github`, and `localAuth` availability flags as true. These flags only show that provider credentials are configured; actual sign-in, callback registration, and credentials were not tested or exposed.
- Production `GET /api/downloads` reported the existing public **v1.0.2** release with nine uploaded assets. Read-only HEAD checks returned HTTP 200 for the published Android APK, Windows setup EXE/portable ZIP, macOS Intel/Apple Silicon DMGs and ZIPs, Linux AppImage/DEB/RPM, and web ZIP. No release was created, modified, or published.
- The source and available service responses do not prove a Render persistent disk exists. MineCord's application state and sessions use SQLite at `DATABASE_URL`; restart survival depends on retaining that exact database path on a mounted persistent disk. Portal config and workspaces also need persistent paths. Configure `MINECORD_DEV_LOGINS_PATH=/var/data/DEV-LOGINS.json`, `MINECORD_DEVELOPER_WORKSPACE_ROOT=/var/data/dev-workspaces`, and `DATABASE_URL=/var/data/minecord.sqlite` only after confirming the actual mount and preserving/restoring the existing files. No Render dashboard setting or disk was inspected or changed.

### Manual checks before production deployment

1. In two separate browser profiles/devices, sign in with two test accounts, send and accept a friend request, exchange DMs in both directions, reload both clients, and confirm friendship and message history persist.
2. Between those two accounts, make and accept a voice call; grant microphone permission on both sides and verify each person can hear the other. Test mute/unmute, deafen, hang up, reconnect, and call again. A signaling “connected” status alone is not proof of audio.
3. If calls fail on restrictive networks, inspect `RTCPeerConnection.getStats()` on both devices and verify the selected candidate pair uses a `relay` candidate. Either provision Metered (`METERED_APP_NAME` and private `METERED_SECRET_KEY`) or a reachable coturn relay (`TURN_URL` and `TURN_SHARED_SECRET`); test from separate networks. STUN-only Google fallback is best effort. Do not treat successful ICE config retrieval as proof of relayed media.
4. Manually complete Google, Microsoft, and GitHub sign-in and account-link flows on the public HTTPS domain. Confirm the exact registered callbacks: `/auth/google/callback`, `/auth/microsoft/callback`, `/auth/github/callback`. Verify the provider accounts and redirect destinations without sharing client secrets.
5. In Render, verify the mounted disk, production `DATABASE_URL`, private `DEV-LOGINS.json` location, and workspace path before deploying. Back up the current DB and portal file securely; retain the same `MINECORD_DEV_VAULT_KEY` for existing encrypted vault entries.
6. For live OpenAI verification, back up the portal config; generate one random 32-byte key locally, set it only as the private `MINECORD_DEV_VAULT_KEY` environment secret, and keep a protected backup. After deploying code with `MINECORD_DEV_LOGINS_PATH` set to the persistent file, an owner enters the OpenAI API key through the write-only owner configuration UI and chooses the model. Confirm the provider availability response and a small test conversation; never place either key in source, shell logs, prompts, or developer-facing responses. Do not rotate the vault key while encrypted values exist without a planned migration.

### Remaining deployment blockers and safety

- Render disk/mount configuration and survival across an actual service restart remain unverified. Portal persistence requires setting the new path variable; its default intentionally remains the local root file.
- Real two-way audio/TURN relay, OAuth callbacks, OpenAI, and owner-managed portal provisioning still require manual credentials and live testing. No second owner account was assumed or created.
- `server/data.json` SHA-256 after work: `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`, matching the protected expected hash. The existing staged deletion remains untouched; the local file was not modified.
- All pre-existing staged, modified, and untracked work was preserved. No commit, push, deployment, Render restart/configuration change, release publication, or destructive Git operation occurred.

## Windows development and deployment-readiness audit — 2026-11-07

### Confirmed fixes and verification

- Fixed main `/app` password input compatibility: its shared sign-in/registration field no longer caps input at 200 characters. Registration still checks the inclusive 8–200-character range in the browser and server; login remains able to submit longer legacy passwords. Scrypt verification and existing hashes are unchanged.
- Added a regression assertion that the shared password field has no `maxlength`, plus a 201-character legacy-password sign-in submission case. The existing registration tests cover rejection below 8 and above 200, acceptance at 8 and 200, and ordinary login.
- Focused tests: `node --test tests/auth-invitation-flow.test.js tests/server.test.js` — **30 passed, 0 failed**.
- Full `npm test` — **123 passed, 0 failed**. The pre-existing OpenCode Bridge test still prints its fixture's “not a git repository” diagnostic and passes.
- `npm run build` — **succeeded**, producing 27 static frontend assets. `node --check` passed for the key server, portal, call, and auth-test scripts. `git diff --check` passed; Git printed only LF-to-CRLF working-copy notices.
- Production read-only checks: `/health` returned HTTP 200 and commit `2ccefb96948e8b4d40b7a8197e0414fc5c205ea9`; `/api/downloads` returned HTTP 200 for release `v1.0.2` and nine assets. HEAD requests to all nine listed assets returned HTTP 200. This confirms URL availability, not ZIP contents, checksums, installation, or runtime behavior.
- No local native platform package was built. No software was installed, no credential values were inspected, and no production setting was changed.

### Project and Windows toolchain inventory

Project requirements confirmed from `package.json`, Rust/Android manifests, workflows, and build scripts:

- Web/server development and tests: Node.js **>=24**, npm, and Git. The project uses Node's built-in SQLite module; no standalone database server is required. The web build is `npm run build`.
- Electron desktop: the npm dependencies already present, Node 24+, and platform-specific packaging tools. Windows Electron outputs x64 NSIS, portable, and ZIP packages; its updater DLL is an additional resource built by `scripts/build-updater.ps1`.
- Tauri desktop: Node 24+, Rust **1.90** (manifest minimum), Cargo, and target-specific native toolchains. Windows requires MSVC/Windows SDK and WebView2; macOS builds must run on macOS; Linux needs its configured WebKitGTK/OpenSSL/appindicator development libraries. The workflow builds macOS Intel/Apple Silicon, Linux, Windows, Android, and web on matching hosted runners.
- The Windows updater DLL script uses CMake, Ninja, MSVC and optionally NSIS for its standalone installer. Android CI initializes the generated project, uses Gradle wrapper **8.5**, Android Gradle Plugin **8.5.2**, Kotlin **1.9.24**, JDK **17**, compile/target SDK **34**, min SDK **24**, and NDK **27.0.12077973**. No separate Gradle installation is needed.
- Browser automation is not configured as a project dependency; no Playwright/Puppeteer package was found. Browsers are available for manual testing. Python is useful for repository scripts but is not required for the normal web build/test. .NET is not a MineCord build requirement.

| Software / capability | Observed state | Purpose / priority |
|---|---|---|
| Windows 11 Pro x64, build 10.0.26200 | Installed | Host OS |
| Node.js 24.16.0 / npm 11.13.0 | Installed; meets project engine | Required web/server/tests |
| Git 2.56.0 / GitHub CLI 2.102.0 | Installed | Git required; `gh` optional |
| Rust/Cargo 1.90.0; only `x86_64-pc-windows-msvc` target installed | Installed | Required for local Tauri Windows; other targets absent |
| VS Build Tools 2022 17.14.41; MSVC 19.44.35229; Windows SDK 10.0.26100 | Installed; C++ tools verified from VS developer environment | Required for local native Windows builds |
| WebView2 Runtime 157.0.4341.42 | Installed | Tauri Windows runtime/build support |
| CMake 4.4.4 | Installed | Updater DLL build |
| Ninja | Missing from PATH | Required by updater build script; local Windows packaging blocker |
| NSIS (`makensis`) | Not found | Required for local NSIS installers; local package blocker |
| JDK 21.0.12 (Temurin) at `JAVA_HOME`; `javac` on PATH is JDK 25.0.4 | Installed | Android-capable Java; CI specifically uses JDK 17 |
| `java.exe` on PATH | Oracle Java 8 shim | PATH/JAVA_HOME mismatch; use `%JAVA_HOME%\\bin` first when running Gradle |
| Android Studio, Android SDK/platform tools/Build Tools/NDK | Not found | Required for local Android build; not required for web development |
| Gradle | No global command | Not required; project Gradle 8.5 wrapper is present |
| Python 3.15.2; GitHub Desktop 3.6.10; Google Drive 133.0.2.0; OBS 31.1.2; WinRAR 7.23 | Installed | Personal/optional tools; Python can run helper scripts |
| Chrome 156.0.8078.80; Edge/WebView2 157.0.4341.42; Firefox 159.0.1 | Installed | Manual browser testing |
| .NET SDK | None; .NET 8/9/10 runtimes present | Not required by MineCord |
| C: free space | About 8.27 GiB | Limited headroom for Android Studio + SDK/NDK/emulator |

`cl.exe` is not on the ordinary PATH, but works after invoking the installed Visual Studio developer environment. No Android Studio/SDK, `adb`, Ninja, NSIS, or browser automation dependency was found. Windows optional-feature status for virtualization was not confirmed; emulator use may need additional Windows virtualization setup and disk space.

### Ninite and official download checklist (do not install until approved)

The official Ninite catalog at <https://ninite.com/> currently lists Git, GitHub Desktop, Node.js 24, Python 3, JDK 17/21, Chrome, Firefox, Edge, OBS, WinRAR, and 7-Zip. Ninite is not a source for the missing Android Studio/SDK, Ninja, or NSIS requirements. Existing apps should not be reinstalled or upgraded just to use Ninite.

| Missing / optional software | Need and priority | Ninite | Official source | Admin / setup |
|---|---|---|---|---|
| Android Studio | **Required only for local Android builds** | No | <https://developer.android.com/studio> | Per-user install may work; SDK/NDK installed through SDK Manager into a writable user path. Emulator/virtualization setup can require admin. |
| Android SDK command-line tools, platform 34, Build Tools, NDK 27.0.12077973 | **Required for local Android builds** | No | <https://developer.android.com/studio#command-tools> and <https://developer.android.com/studio/intro/update#sdk-manager> | Install via Android Studio SDK Manager; set `ANDROID_HOME`/`ANDROID_SDK_ROOT` only after approval. |
| Ninja | **Required for the updater DLL script**; not needed for web/server/tests | No | <https://github.com/ninja-build/ninja/releases> | ZIP can be unpacked to a user-owned tools folder and added to user PATH; no machine-wide install necessarily needed. |
| NSIS | **Required for local NSIS installer packaging** | No | <https://nsis.sourceforge.io/Download> | Installer may request admin rights; current Tauri/Electron installer configurations include per-machine install behavior. |
| JDK 17 | Optional, for exact parity with Android CI; JDK 21 already exists and meets current AGP's Java 17 minimum | Yes | <https://adoptium.net/temurin/releases/?version=17> | Avoid duplicate install unless exact CI parity is required. Correct PATH/JAVA_HOME precedence first. |
| Playwright | Optional future browser automation; not a current dependency | No | <https://playwright.dev/docs/intro> | Add only if browser automation is approved; this audit did not install it. |

Other official sources (all corresponding software is already installed here): Node <https://nodejs.org/en/download>, Git <https://git-scm.com/download/win>, GitHub CLI <https://cli.github.com/>, GitHub Desktop <https://desktop.github.com/>, Rust <https://www.rust-lang.org/tools/install>, Visual Studio Build Tools <https://visualstudio.microsoft.com/downloads/>, Python <https://www.python.org/downloads/>, and CMake <https://cmake.org/download/>.

Recommended order if local builds are approved: (1) no installs for current web/server work; (2) resolve Java PATH/JAVA_HOME without installing another JDK; (3) install Ninja for updater DLL and NSIS for Windows installer packaging; (4) only if Android builds are needed, install Android Studio then SDK platform/build tools 34, NDK 27.0.12077973, and platform tools; (5) add browser automation only if requested. Do not install/upgrade anything before user approval.

### Application, persistence, voice, and release findings

- Authentication/account permissions, OAuth-state and callback logic, account merge/linking, friends, DMs and history, servers/channels/roles, presence, multiplayer game synchronization, call signaling, TURN config, and Developer Portal authorization/workspaces/vault have broad passing unit/integration coverage in `npm test`. OAuth and AI provider paths are mocked in tests; no live provider credential was tested. Main-app account password change is **not implemented** (Developer Portal password change is separate); no main-app password hashes were changed/reset.
- Main local-account registration is enforced at 8–200 characters in server and UI, remains scrypt-backed, and accepts existing hashes at login. Client sign-in has no new 200-character restriction. Existing OAuth callback routes are `/auth/google/callback`, `/auth/microsoft/callback`, and `/auth/github/callback`; production live provider callbacks still require manual sign-in tests. No OAuth secrets were viewed.
- WebRTC uses real `RTCPeerConnection` media tracks, queues ICE candidates until remote description, has Google STUN fallback, and accepts server-generated short-lived TURN REST credentials. `TURN_URL` plus private `TURN_SHARED_SECRET` (or Metered provider configuration) are required for relay service; permanent credentials are not sent to browsers. Client stats inspect the selected candidate pair and can show relay-vs-direct state. Signaling/ICE/unit tests do **not** establish two-way audio or remote audibility; manual testing remains required.
- Two-browser test: use two independent browser profiles/devices and two test accounts; send/accept friend request; exchange DMs in both directions; reload both and verify friend/message history. Start a private call, accept on the second browser, allow microphones, speak in both directions, and verify audible remote audio. Test mute/unmute, deafen/undeafen, end-call, disconnect/reconnect, and a fresh call. Repeat from separate networks. In browser WebRTC diagnostics, inspect `getStats()` selected candidate-pair `localCandidateId`/`remoteCandidateId`, candidate types, inbound/outbound audio bytes/packets, and ensure the selected pair is `relay` when testing TURN. “Connected” signaling alone is not success.
- SQLite is the application state/session store at `DATABASE_URL` (default `server/minecord.sqlite`) and uses WAL. Render's default filesystem is ephemeral; no dashboard disk was inspected. For a confirmed persistent disk mounted at `/var/data`, suggested settings are `DATABASE_URL=/var/data/minecord.sqlite`, `MINECORD_DEV_LOGINS_PATH=/var/data/DEV-LOGINS.json`, and, if workspaces should persist, `MINECORD_DEVELOPER_WORKSPACE_ROOT=/var/data/dev-workspaces`. The Developer Portal login/invitation/vault metadata is a separate private file, and workspaces otherwise default to OS temp. Preserve the existing `MINECORD_DEV_VAULT_KEY` for encrypted values; store the key only in private host secrets and retain a secure backup.
- OpenAI live test requires first provisioning a random 32-byte/64-hex `MINECORD_DEV_VAULT_KEY` privately, backing up the portal config, then entering the provider key in the owner-only write-only vault and selecting a model. Never paste either key into chat, source, logs, or prompts. Mocked tests do not prove live OpenAI.
- Server binds to `0.0.0.0` and `PORT`; `/health` is responding. Production `GET /api/downloads` advertises v1.0.2 and nine assets, and all asset HEAD requests returned 200. No asset was downloaded or unpacked, so package integrity/checksums are not independently confirmed. The web build output is `dist/web` (shown as `dist\\web` on this Windows machine).
- GitHub release CI uses hosted macOS runners for Intel and Apple Silicon, Ubuntu for Linux and Android, and Windows for Windows; local builds for these non-Windows platforms were not performed. Mac signing/notarization requires Apple Developer identity/certificate and private CI secrets. Android requires SDK/NDK/JDK and Rust Android targets; its CI can generate an ephemeral signing key if no Android signing keystore is configured, which is not suitable for stable upgrade identity across releases. Keep a persistent private keystore and associated credentials for production upgrades. Linux package dependencies are declared in `src-tauri/tauri.conf.json`.
- No browser-based E2E suite or separate lint/typecheck command is configured in `package.json`. Download link HTTP checks do not replace downloading/installing artifacts on each target OS.

### Data and Git safety

- `server/data.json` SHA-256 after verification: `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`, matching the protected expected hash. The existing staged deletion remains `D  server/data.json`; its index state was not changed and the local file remains intact.
- Branch remains `main` at `2ccefb9`. Existing dirty and untracked work was preserved. No database, environment file, portal credentials, vault, signing key, or release asset was changed. No software install, commit, push, deployment, Render modification/restart, release publication, or destructive Git command was performed.

## Android build and toolchain audit — 2026-11-07

### Installed environment verified

- Android SDK root exists at `C:\Users\zeysu\AppData\Local\Android\Sdk`.
- Android Platform Tools / ADB **37.0.1** are installed and runnable. Android Emulator is installed.
- Android platform **37.0** and Build Tools **36.0.0** are present. The AVD `Medium_Phone_API_37.0` is configured with an x86_64 Google Play system image, which exists on disk. `emulator -accel-check` reports WHPX acceleration is installed and usable. The emulator was not booted in this task.
- Android SDK Command-line Tools (`sdkmanager`) are absent; SDK environment variables are not set in the ordinary shell.
- Android platform **34** and the project-required NDK **27.0.12077973** are absent. Only Windows Rust target `x86_64-pc-windows-msvc` is installed; Android Rust targets, including `x86_64-linux-android`, are absent.
- JDK **21.0.12** is installed at the reported Temurin path. The Gradle wrapper downloaded Gradle **8.5** and verified it runs on JDK 21. Android CI explicitly uses JDK 17; the current local Gradle 8.5 supports Java 21. The ordinary `java` command still resolves to Oracle Java 8 unless `JAVA_HOME\bin` is first on PATH. The Android build attempt used the JDK 21 path explicitly for that process.
- The project pins Android Gradle Plugin **8.5.2**, Kotlin **1.9.24**, compile/target SDK **34**, min SDK **24**, and NDK **27.0.12077973**. The emulator image is API 37 and is separate from the build's required compile platform.

### Existing implementation and fixes

- MineCord already has one tracked Tauri Android project at `src-tauri/gen/android`; application ID is `com.minecord.app`. It is a Tauri WebView client configured to open the existing HTTPS MineCord service, not a second Android backend. The manifest has INTERNET/network-state and microphone/audio permissions, denies cleartext traffic, and the network-security config allows the production HTTPS host. `MainActivity` extends `TauriActivity` and requests runtime microphone permission.
- WebRTC video-call code requests camera media. Tauri's checked-in Wry Android WebChromeClient maps WebView video capture to Android `CAMERA`; the app manifest lacked the corresponding permission. Added `android.permission.CAMERA` without marking camera hardware mandatory, so devices without a camera can still install and use chat/voice features.
- Found generated Android Gradle `versionName "1.0.1"` while the package/Tauri version is **1.0.2**. Aligned the tracked Android version name to 1.0.2; application ID and versionCode 1001 remain aligned with Tauri configuration.
- Android CI previously deleted `src-tauri/gen/android` and regenerated it, discarding the tracked custom manifest, `MainActivity`, and network configuration instead of building/testing the actual project. Changed the workflow to verify and build the checked-in Android project. Added regression checks for application ID/version/versionCode, network/media permissions, HTTPS-only policy, and CI project preservation.
- Files changed: `src-tauri/gen/android/app/build.gradle`, `src-tauri/gen/android/app/src/main/AndroidManifest.xml`, `.github/workflows/tauri-build.yml`, and `tests/tauri-hosted-service.test.js`.

### Android build attempt and remaining setup

- Attempted the existing debug build with JDK 21 explicitly selected: `npm run tauri -- android build --apk --debug --target x86_64 --ci`.
- Build **did not produce an APK**. Tauri stopped before Rust/Gradle compilation with: **“Android NDK not found. Make sure the NDK is installed and the NDK_HOME environment variable is set.”**
- Required SDK Manager packages to install before retrying: Android SDK Platform **34** (`platforms;android-34`), Build Tools **34.0.0** (the Android Gradle Plugin 8.5 default; installed 36.0.0 is not the configured baseline), NDK **27.0.12077973**, and Android SDK Command-line Tools (`cmdline-tools;latest`). Set `ANDROID_HOME`/`ANDROID_SDK_ROOT` to the verified SDK path and `NDK_HOME` to the installed side-by-side NDK path for the build process.
- Then install the Rust target for the selected emulator ABI (`x86_64-linux-android`) and rebuild. For arm64 devices, also add `aarch64-linux-android`. Android Studio SDK Manager is the available official UI path; official package/setup documentation: <https://developer.android.com/studio/intro/update#sdk-manager> and <https://developer.android.com/studio#command-tools>. No Android components or Rust targets were installed in this task.
- Since no APK was generated, no emulator install, app launch, or UI/auth/navigation test was performed. The configured AVD image and acceleration are present, but boot/runtime remain unverified. After successful build, install the debug APK with `adb install -r <apk>` and manually check initial startup, login/OAuth redirects, navigation, microphone/camera prompts, and calls; production account and real media tests still require manual verification.
- Existing workflow release packaging may use a per-run generated signing key if Android signing secrets are unavailable. That produces an artifact signed for that build but does not preserve the same signing identity for subsequent app upgrades; use the existing privately stored persistent keystore for upgradeable releases. No signing configuration or key was inspected or changed.

### Regression and safety

- Focused Android/Tauri checks: `node --test tests/tauri-hosted-service.test.js` — **6 passed, 0 failed**.
- Full `npm test` — **126 passed, 0 failed**. The pre-existing OpenCode Bridge test still prints a Git “not a git repository” fixture diagnostic and passes.
- `npm run build` — **succeeded**, producing 27 static frontend assets. JavaScript syntax checks and `git diff --check` passed.
- Verified that no debug APK exists at `src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk`; the Tauri build aborted during Android environment validation, before APK compilation.
- `server/data.json` SHA-256 remained `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`; its pre-existing staged deletion was preserved. No databases, credentials, signing keys, production settings, or releases were changed. No commit, push, deployment, or release occurred.

## Account security and multiplayer Chess rules — 2026-11-22

### Implemented

- Added MineCord local-account password changes in Settings. The server requires the current password, enforces the 8–200 character policy, rejects reuse of the current password, generates a fresh scrypt salt/hash, preserves the current session, and revokes all other sessions atomically with the SQLite state write. OAuth-only accounts without a local password receive a clear conflict response. Password responses use `Cache-Control: no-store`.
- Added accessible current/new/confirm password fields, client-side validation, and status feedback. Passwords are not saved in browser storage.
- Completed server-authoritative multiplayer Chess legality for check safety, castling rights/path/threats, en passant, promotion, checkmate, stalemate, insufficient material, fifty/seventy-five-move rules, threefold/fivefold repetition, draw claims, and resignation. The client now presents draw claims and server adjudication results. Solo Chess remains a casual local implementation and does not claim full rules.

### Verification

- Focused account/Chess/UI/database command: `node --test tests/chess-multiplayer.test.js tests/password-change.test.js tests/database-transaction.test.js tests/ui-settings.test.js` — **23 passed, 0 failed**.
- Password HTTP integration: `node --test --test-name-pattern="local account password change" tests/server.test.js` — **1 passed, 0 failed**. This covers bad/current/reused passwords, persistence, current-session retention, other-session revocation, and old/new password sign-in.
- Full checked-in test command equivalent to `npm test`: `node --test --test-concurrency=2 "tests/**/*.test.js"` — **154 passed, 0 failed, 0 cancelled, 0 skipped**.
- `npm run build` — **succeeded**, producing 34 static frontend assets.
- JavaScript syntax checks and `git diff --check` passed. Test databases and temporary paths used `D:\Temp`; the repository's local account data was not used.
- Local loopback probes return `EACCES` in the restricted run. The approved test run enabled the needed local integration access; no system-wide setting was changed.

### Data protection and release status

- `server/data.json` SHA-256 remains `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`; its contents were not read or modified.
- GitHub repository metadata confirms `ZEY-CAT/MineCord` is public; existing progress notes confirm `server/data.json` is tracked in public history. This data exposure cannot be remediated by an ordinary source commit. The available GitHub connector has read-only repository metadata; local `gh` authentication reports an invalid token. No visibility change, history rewrite, commit, push, deployment, or release was performed. Do not publish further commits until the owner can make the repository private and determine a safe data/history response.
- C: had approximately 0.7 GiB free during this work; D: had approximately 6.0 GiB free. Node temp files were directed to D:. No files were deleted to recover space.
- Live OAuth providers, two independent physical call clients with real microphone/camera media, Render persistent-disk behavior, Android emulator UI/performance, packaged native GUI startup, platform signing, Play Store compliance, and production release behavior remain unverified.

### Final rerun after Chess UI completion — 2026-11-22

- Added a multiplayer promotion selector (queen/rook/bishop/knight), a draw-claim control, correct winner/draw display, and server-authoritative resignation. Added tests for castling through attack and stalemate.
- Focused Chess suite: `node --test tests/chess-multiplayer.test.js` — **10 passed, 0 failed**.
- Final full checked-in suite after all source changes: `node --test --test-concurrency=2 "tests/**/*.test.js"` — **156 passed, 0 failed, 0 cancelled, 0 skipped** (83.1 seconds).
- Final `npm run build` — succeeded, 34 static frontend files. Syntax checks for modified server/browser JavaScript and `git diff --check` passed. Only line-ending notices were emitted.
- Multiplayer Chess server rules are now implemented and covered; actual two-client UI play is still not a substitute for this unit/integration coverage and has not been manually exercised in two physical clients.

### Pushed branch and cross-platform CI — 2026-11-22

- Local commit `c4c3acf89db4b878e71bc3346af6aba112d2b70e` was pushed as a fast-forward to `origin/minecord-cloud-migration`; GitHub branch metadata confirms the exact SHA. No merge to `main`, history rewrite, force-push, deployment, or release occurred.
- GitHub Actions run `45055705279` on that SHA passed Windows Tauri, Linux Tauri, Android debug APK, web build/tests, macOS Intel, and macOS Apple Silicon. The release job was skipped (manual opt-in is required). Run `45055705303` developer checks passed.
- Uploaded workflow artifacts: `mincord-android-debug` (artifact ID `14767013241`, ZIP 55,284,440 bytes, SHA-256 `674e1ef70702dd06c3debfca5d26955ae534db68e698dde9a99dfbacc71a9b07`), `mincord-windows-tauri`, `mincord-linux`, `mincord-macos-x86_64-apple-darwin`, `mincord-macos-aarch64-apple-darwin`, and `mincord-web`. CI verified the Android APK at 56,829,207 bytes and `apksigner` reported APK Signature Scheme v2 valid. This remains a debug APK, not Play-signed.
- Current local full dependency audit: `npm audit --omit=dev --audit-level=moderate` found **0 production vulnerabilities**. `npm audit --audit-level=moderate` found **6 moderate development-only advisories** in `minimatch` below `electron-builder`; npm recommends a breaking `electron-builder@25.1.0` downgrade via `--force`. No forced downgrade was applied.
- Current host storage: C: 541,544,448 bytes free; D: 6,442,549,248 bytes free. Build/test temp and npm audit cache were directed to D:. No existing file or cache was deleted. ADB daemon startup in the restricted process failed on a socketpair (`fdevent_poll` invalid argument); elevated daemon startup succeeded, but `adb devices -l` lists no emulator. The known AVD is stored under the C: user profile, so it was not launched or modified with less than 0.6 GiB available. No APK install/UI/performance test ran.
- GitHub repo metadata still reports the repository is public, and `server/data.json` is tracked. The protected file remains local and unchanged at SHA-256 `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`; commit comparison shows no change to that path. Local `gh auth status` reports its saved token invalid; the connected GitHub tool offers metadata reads but no repository-visibility mutation. No history rewrite or visibility change was attempted. Treat public-history exposure as unresolved and block merge/release until the owner handles repository privacy and data exposure.

## Responsive application and extension UI refresh — 2026-11-22

- Added `public/app-theme.css` as a shared responsive visual layer for the existing MineCord app. It updates the forest/stone palette, controls, sidebars, cards, message composer, dialogs, and call surfaces without changing navigation or feature handlers. It adds touch sizing, small-screen dialog/composer adjustments, and reduced-motion support. The theme is shared by the WebView app in Tauri/Electron as well as the web app.
- Updated the Eaglercraft toolbar popup to use the same design as its Options page and retained the current pairing code flow, permission prompt, server-origin validation, and unpair behavior. `browser-extension/options.css` now supplies the shared options/popup theme.
- Added regression checks for the main app theme and extension popup accessibility/flow hooks.
- Focused UI and extension tests: `node --test tests/extension.test.js tests/ui-settings.test.js` — **15 passed, 0 failed**.
- Full suite after the changes: `npm test` — **158 passed, 0 failed, 0 cancelled, 0 skipped** (82.99 seconds).
- `npm run build` succeeded before the extension-only restyle and includes the new `app-theme.css` in `dist/web` (35 frontend files). Extension source is packaged into Windows desktop resources. The already checked-in public extension ZIP is a separate generated asset and was not regenerated or verified, so its downloadable contents still need a safe packaging/deployment path.
- This is a source-level UI refresh, not visual browser/device QA. Production deployment, packaged app rendering, and the downloaded extension archive were not exercised.

## Current-source Eaglercraft download — 2026-11-22

- Confirmed the existing `public/eaglercraft-extension.zip` contains the old popup markup and inline styling, so it did not match the maintained extension sources.
- Added `server/extension-archive.js`, a dependency-free ZIP assembler restricted to the seven reviewed extension files. The `/eaglercraft-extension.zip` route now assembles the archive from current source and sets attachment, content type, length, and no-cache headers. No generated ZIP was changed or committed.
- Added archive structure/content regression coverage and an isolated HTTP integration test for the download route.
- Extension tests: `node --test tests/extension.test.js` — **3 passed, 0 failed**. Download HTTP test with loopback access: `node --test --test-name-pattern="Eaglercraft extension download" tests/server.test.js` — **1 passed, 0 failed**.
- Final full suite after this change: `npm test` — **160 passed, 0 failed, 0 cancelled, 0 skipped** (91.8 seconds). `npm run build`, `node --check server/server.js`, and `node --check server/extension-archive.js` succeeded.
- `server/data.json` still hashes to `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F` and remains unstaged.
- This test verifies archive assembly and local HTTP serving only; Render deployment and a real browser installation of the downloaded extension have not been tested.

## Render SQLite persistence guard — 2026-11-22

- The server previously selected `server/minecord.sqlite` when `DATABASE_URL` was missing, even on Render where the project filesystem may be ephemeral. Added `server/database-config.js` and made the DB bootstrap fail fast when `RENDER_EXTERNAL_URL` is present unless `DATABASE_URL` is explicit, `MINECORD_PERSISTENT_DATA_DIR` is absolute, and the DB file path is contained within that declared root.
- Local development keeps its existing SQLite default. No automatic database copy, migration, reset, or data-file access was added. README documents the `/var/data` example and warns that code cannot prove the host actually mounted that disk.
- Added isolated tests for local fallback, Render startup rejection before DB creation, missing/relative root, outside-root path, valid SQLite URL, and non-SQLite URL rejection.
- Database config/transaction tests: `node --test tests/database-config.test.js tests/database-transaction.test.js` — **8 passed, 0 failed**. Syntax checks passed.
- Final full suite after the guard: `npm test` — **167 passed, 0 failed, 0 cancelled, 0 skipped** (84.6 seconds). `npm run build` succeeded (35 frontend files).
- Production disk mount, current production database location/backup, and persistence across a real Render redeploy remain unverified. Deployment must wait until the owner confirms the mounted path and preserves the existing database, then configures both `MINECORD_PERSISTENT_DATA_DIR` and `DATABASE_URL` to that same disk.

## Session handoff — 2026-11-22

- Local commits on `minecord-cloud-migration`: `98de161` (responsive app/Eaglercraft UI and source-generated extension download) and `36eaa9b` (Render persistent-storage startup guard). Both contain only explicitly reviewed feature/docs/tests paths. Local `origin/minecord-cloud-migration` tracking ref is `c4c3acf`; HEAD is two commits ahead. No push was attempted because the GitHub repository is still public with the protected local-data path in public history, and repository visibility controls are unavailable in this session. No history rewrite was attempted.
- `server/data.json` remains present, unstaged, and at required SHA-256 `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`.
- C: has 532,660,224 bytes free; D: has 6,426,365,952 bytes free. No files were deleted to recover space. Existing dirty progress/Android generated work and untracked files remain preserved.
- Current verification: `npm test` 167/167; `npm run build` success; targeted extension archive download HTTP check and database configuration checks pass.

## Mobile sign-in and platform icon polish — 2026-11-22

- Added original MineCord icon artwork and deterministic icon generation for PWA, favicon, Apple touch icon, Tauri desktop containers, and Android launcher densities. Added Android adaptive launcher resources and branded launch screen; updated labels and manifest metadata to launch `/app` with normal MineCord capitalization.
- Improved mobile login layout and separated browser sign-in/copy-link actions. Electron browser launch is restricted to the configured MineCord origin and `/app`; OAuth and Minecraft account-link flows request provider account selection while retaining existing browser-bound PKCE/session handling.
- Added regressions for icon dimensions/nonblank art, adaptive Android resources, capitalization, account chooser prompts, and login-button behavior. Updated existing route assertions to the new MineCord casing.
- `npm run build` succeeded with icon generation. Final `npm test` — **176 passed, 0 failed, 0 cancelled, 0 skipped** (146.15 seconds). Focused route and server integration tests passed.
- Protected `server/data.json` SHA-256 verified unchanged: `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`.
- No Android APK/install or visual device QA, live OAuth provider flow, production Render deployment, or physical-device testing was performed. Existing unrelated dirty/untracked files remain untouched. These changes remain local and uncommitted; pushing is still withheld while the public-history privacy issue is unresolved.
- Environment check: `adb devices -l` could not run because `adb` is not available on PATH, so no emulator/device is connected or testable from this shell.
- Commit follow-up: the reviewed feature files were staged explicitly and committed locally as `df67aae` (`Polish mobile sign-in and platform branding`). The commit excludes `server/data.json`, progress files, databases, generated builds, and unrelated dirty/untracked work. It has not been pushed.

## Android SDK and call reliability follow-up — 2026-11-22

- Located installed Android tooling without reinstalling Android Studio: `D:\Android\SDK`, `D:\MineCordAndroidSdkCodex`, and `C:\Users\zeysu\AppData\Local\Android\Sdk`. ADB was invoked directly from the existing SDK. The configured project SDK at `D:\MineCordAndroidSdkCodex` built the debug APK.
- `npm run tauri -- android build --debug --target x86_64 --apk --ci` initially regenerated checked-in Android project files and failed to produce a usable release package when the release task required a missing signing `storeFile`. The regenerated files were not adopted blindly; the pre-existing `RustWebViewClient.kt` script-injection guard and dynamic Cargo lockfile resolver in `tauri.settings.gradle` were restored. To avoid further regeneration, `:app:assembleUniversalDebug --offline` was then run directly and succeeded.
- Verified debug APK: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`, 26,118,273 bytes, SHA-256 `5FD7E165549EE22761802C95A11E59732D8A3B4A826ADC74C24CBB9EDCE96F07`; package `com.minecord.app`, version 1.0.2 (1001), launch activity `MainActivity`, INTERNET/CAMERA/RECORD_AUDIO/POST_NOTIFICATIONS declared, APK v2 signature valid. This is a debug-signed package and is not Play-ready.
- Startup/install verification is blocked: direct `D:\MineCordAndroidSdkCodex\platform-tools\adb.exe devices -l` starts successfully but lists no device. The existing API 37 AVD is under C: and emulator startup reports insufficient disk; C: had roughly 316 MiB free. A task-owned metadata-only AVD configuration clone on D: also could not start because the emulator requested more space than D: had available. The original AVD, userdata, and snapshots were not modified. No APK installation, visual startup, performance, or crash test ran.
- Reduced per-peer WebRTC statistics sampling in `public/index.html` from 1.2 seconds to 2 seconds, retaining event-driven connection-state updates and throttled ICE restart handling. Added a regression test in `tests/call-ui.test.js` for bounded sampling, reconnect status, and failed-connection restart behavior. Focused call and Android-bootstrap tests: **11 passed, 0 failed**. Full `npm test`: **177 passed, 0 failed, 0 cancelled, 0 skipped**. `npm run build` succeeded and generated 39 static frontend files.
- Protected local `server/data.json` SHA-256 remains `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`; its contents were not read. A read-only GitHub API check confirms the repository is public and the current `main` tree still tracks `server/data.json` (tree SHA `62508bfaacf6230f1903c9ec18d86a0fc13066db`). No repository setting or Git history was changed. Continue withholding pushes pending an owner-controlled privacy/history response.
- Still unverified: visible Android login/app startup, live Google/Microsoft OAuth, two-device microphone/camera calls, production Render persistent-disk behavior, real Eaglercraft extension pairing in a browser, and signed store/native releases. Existing unrelated working-tree changes and untracked files remain preserved.

## Eaglercraft pairing hardening and physical-device prep — 2026-11-22

- Tightened the extension service worker's pairing boundary: it now accepts only a clean HTTPS origin, or HTTP on `localhost`/`127.0.0.1`; credentials, path, query, fragment, remote HTTP, and non-HTTP(S) schemes are rejected. Pairing codes must match the server's base64url format and length. The popup now reports credential-bearing URLs instead of silently stripping userinfo.
- Added direct validation tests for accepted production/local origins and rejected credential/path/query/insecure URLs. `node --test tests/extension.test.js`: **4 passed, 0 failed**. `node --check` for the changed extension scripts and `git diff --check` passed. The server integration test confirms generated codes are single-use, expiry limited, connector tokens support presence, and disabling or unpairing revokes them.
- Added `ANDROID_DEVICE_TESTING.md` with safe physical-device install, launch/log capture, OAuth, call, persistence, and frame-stat steps. It avoids uninstall/clear-data/emulator-wipe commands and requires an authorized ADB device before install.
- Focused cross-feature suite with loopback enabled: **54 passed, 0 failed**. The unprivileged attempt could not fetch temporary loopback test servers; the same command with loopback access passed. Additional isolated tests passed for Eaglercraft server pairing and DM history across a full server restart using temporary SQLite.
- Full `npm test` after the extension change: **178 passed, 0 failed, 0 cancelled, 0 skipped** (80.8 seconds), with loopback access. `npm run build` succeeded and generated 39 static frontend files.
- Protected local `server/data.json` SHA-256 remains `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`; contents were not read. GitHub remains public and current `main` tracks the path; no push, deployment, release, visibility change, or history rewrite occurred.
- Outstanding real-world checks: no physical Android device is attached; OAuth provider accounts are not exercised live; WebRTC signaling tests do not prove actual two-device audio/video transmission; the browser extension has not been loaded into a real browser; production Render disk persistence remains unverified.
- Historical exposure check: GitHub's read-only commit-path API reports one public history commit for `server/data.json`: initial commit `21d88166174a46fd0449418904c97a621b7ace09` (2026-10-08). Only commit metadata and the current tree path/blob identifier were inspected; the file contents were not fetched. This confirms the path has been exposed in public repository history since the initial commit. No history rewrite was attempted.

## Multiplayer action validation and owner remediation plan — 2026-11-22

- Hardened the authoritative game-action boundary. Every game now rejects missing, scalar, or array actions before game-specific handling. Snake accepts only its four directions and known action types; Flappy rejects unknown controls; Paintball validates boolean movement inputs, finite numeric aim, and known actions. This prevents malformed client messages from throwing or contaminating shared match state.
- Added `tests/games-multiplayer.test.js` for invalid payloads, Snake direction validation, Flappy control handling, and Paintball input validation. Targeted Chess/game suite: **13 passed, 0 failed**. Full `npm test`: **181 passed, 0 failed, 0 cancelled, 0 skipped** (81.2 seconds), with loopback access. `npm run build` succeeded with 39 frontend files; modified game/test JavaScript syntax and whitespace checks passed.
- Added `PRIVACY_REMEDIATION_PLAN.md` with verified exposure facts, explicit owner decisions, safe containment/history options, conditions for any separately authorized rewrite, collaborator/cache limitations, and a Render persistent-disk verification gate. It contains no protected file contents.
- Read-only GitHub metadata confirms public `main` contains the protected path and path history points to public initial commit `21d88166174a46fd0449418904c97a621b7ace09` (2026-10-08). Current tree metadata only was inspected; file content was not fetched. No visibility change or history rewrite occurred.
- Current Render persistence cannot be verified through the checked-in `/health` endpoint: it reports service health/commit only, and the repository connector does not provide Render environment/disk access. The app guard validates declared paths but cannot prove a mounted disk or a current DB backup. No production deployment was attempted.
- Direct installed ADB check found no connected Android device. Emulator testing was not retried. `ANDROID_DEVICE_TESTING.md` documents safe install and test steps for when a physical device is available.
- Protected local `server/data.json` SHA-256 remains `D62F36F549121DBC60C981008BDE49EC40100A60E6C4C2504F86E5424853830F`; contents and local databases were not read or changed. Live OAuth providers, actual two-device media, real browser-extension installation, production Render persistence, and native physical-device behavior remain external verification tasks.

## Multiplayer game lifecycle completion — 2026-11-22

- Fixed multiplayer game session terminal-state delivery: Snake, Flappy, and Paintball now broadcast server-tick endings, winner, and reason to both participants. Simulation ticks no longer refresh `updatedAt`, so inactive games can expire instead of being kept alive indefinitely.
- Extended `tests/games-multiplayer.test.js` to verify both participants receive a terminal Snake state and idle simulation does not extend activity expiry. Targeted Chess/game suite: **14 passed, 0 failed**. Latest complete `npm test`: **182 passed, 0 failed, 0 cancelled, 0 skipped** (74.3 seconds), with loopback access. `node --check` and `git diff --check` pass for the game changes.
- Local commit: `cb46c1a` (`Broadcast multiplayer game endings`). It contains only `server/games-multiplayer.js` and `tests/games-multiplayer.test.js`.

## Private runtime-data migration — 2026-11-22 (in progress)

- Owner decision: the GitHub repository remains public. The owner explicitly authorized migration of local legacy runtime data while preserving its exact bytes and permissions. No history rewrite, force-push, repository visibility change, or deployment is authorized.
- Updated server configuration so SQLite, legacy import JSON, and Developer Portal account configuration resolve to absolute private paths outside the checkout. Render now requires an explicitly declared persistent disk root and database path. Startup logs no longer serialize friend/account relationship data.
- Added `npm run migrate:private-data`. It checks the expected legacy fingerprint without printing file contents, takes an online SQLite backup that includes committed WAL data, verifies integrity/table counts and byte hashes, refuses existing destinations, applies private directory ACLs, and only activates `.env` after verified copies exist.
- Added isolated migration tests, including committed WAL inclusion, source preservation, mismatch/overwrite refusal, and environment activation. `node --test tests/database-config.test.js tests/private-data-migration.test.js`: **11 passed, 0 failed**.
- Updated README, AGENTS.md, and privacy remediation plan for the public-repository decision and non-rewriting containment sequence. The checkout still has numerous pre-existing dirty/untracked files; none were cleaned or reset.
- Migration completed: active SQLite, legacy JSON, and Developer Portal config now reside in `D:\MinecordPrivateData` with restrictive Windows ACLs. The original JSON, SQLite main file and WAL/SHM sidecars, and Portal config were moved into the private `source-snapshot` rollback folder after the app started. The required JSON fingerprint matches in the snapshot; a separate byte-identical legacy copy and online SQLite backup remain in the migration backup.
- Verification: migrated server startup succeeded; `/health` returned HTTP 200 and `/app` returned HTTP 200 with the MineCord interface. The active app-state fingerprint matches the raw SQLite rollback snapshot, SQLite quick-check/integrity and table row counts match the verified online backup, and the private JSON fingerprint remains unchanged. The Git index now excludes `server/data.json`; `.gitignore` still ignores it. `tests/data-protection.test.js` asserts both conditions.
- Focused storage/Git tests: **12 passed, 0 failed** with approved filesystem access. A non-elevated startup was denied writing SQLite journals and a non-elevated loopback request was denied by the workspace boundary; the same app route checks passed in an approved elevated run. The initial private snapshot directory ACL update omitted the user ACE; this was immediately corrected before verification, and the final ACL grants only the current user, SYSTEM, and Administrators.
- Full suite after the migration and tracking guard: `npm test` **187 passed, 0 failed, 0 cancelled, 0 skipped** in 101.9 seconds. `npm run build` succeeded and emitted 39 frontend files. Git diff checks pass for privacy-owned source/docs; separate pre-existing generated Android files still contain whitespace warnings.
- Added a non-sensitive credential-assessment checklist to `PRIVACY_REMEDIATION_PLAN.md`: it lists candidate credential classes for an authorized owner to assess, clearly marks them unconfirmed, and prints no values.
- Privacy milestone committed and pushed to `minecord-cloud-migration`: `0c86e6595141937a40297e70a3bd89a7600a842c`. `git ls-remote` and fetch verified the remote ref at this SHA. The remote branch's current tree no longer contains `server/data.json`; its existing public history still does. No history rewrite, force-push, merge to `main`, or visibility change occurred.
- The local checkout still has unrelated pre-existing `PROGRESS.md`, generated Android, scratch, build, and SQLite fixture changes/untracked files. They were not staged, cleaned, or committed. Full suite and frontend build completed before the commit and remained unchanged after it.
- Do not deploy until an operator verifies the existing Render disk mount, database path, and a current private backup. Real OAuth, physical-device Android startup, two-device audio/video/TURN, and real browser-extension UI tests remain external checks; automated test coverage is not substituted for those checks.

## Video call camera renegotiation — 2026-11-22

- A camera enabled during an in-flight WebRTC offer now gets a follow-up offer when signaling is stable. Offers are serialized per peer and stale peer instances cannot send descriptions.
- Camera regression and existing call UI tests: 8 passed. Full npm test: 188 passed. Live two-device camera and TURN verification remains pending.
