# MINECORD

MINECORD is a Discord-style chat client and self-hosted server for a small group. The Windows installer is only the Electron client. Everyone must sign into the same online MINECORD server; the installer never starts a private MINECORD server.

Minecraft is optional. Users can create MINECORD local accounts and use friends, DMs, servers, chat, and calls without owning Minecraft or connecting Microsoft. Microsoft/Minecraft linking is an optional profile connection in Settings; it is not part of registration or authorization for communication features.

## Shared multi-client architecture

The server and its persistent database are the single source of truth for every client. The web app uses the hosting origin, the Windows Electron client uses `MINECORD_SERVER_URL` or `desktop/config.json`, and the Tauri window is configured for the same hosted MINECORD origin. All use the same HTTP API, authenticated WebSocket service, and database. `GET /api/config` advertises the common `apiBaseUrl` and `websocketUrl` for clients that need runtime configuration. Do not deploy one backend or database per device.

The Tauri desktop configuration points both its development and packaged windows at `https://minecord-8vg2.onrender.com`. It does not bundle or start a Node backend or local account database. Its WebView uses the hosted site origin so same-origin API requests, the authenticated `mc_session` cookie, WebSocket upgrades, and hosted OAuth callbacks remain on the same service. Provider callback URLs and secrets stay configured on the server. Tauri packaging is not verified until it has been built and exercised on Windows; installing the Rust MSVC toolchain and Windows build prerequisites may be required.

The existing project ships the web app and Windows Electron client. Android and iOS/iPadOS clients are not currently packaged, but should consume this same server configuration and API/WebSocket protocol rather than introducing separate account or messaging storage. They must store the authenticated session securely on-device and send it with HTTP/WebSocket requests. Native app builds and their platform-specific OAuth redirects are separate future client work; they are not prerequisites for using MINECORD today.

## 1. Local development

Use Node.js 24 or newer (the app uses Node's built-in `node:sqlite` module).

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Open `http://localhost:3000` in a browser or run `npm run desktop` for the Electron client. The local server creates `server/minecord.sqlite`; it imports `server/data.json` only when no SQLite app state exists. Keep both files backed up and do not assume legacy records are disposable.

Run `npm test` for isolated account, server-permission, DM persistence, unread-cursor, and reconnect coverage. The test uses a temporary SQLite database and does not read or modify the local app database or legacy data file.

Run `npm run build` to validate the frontend scripts and asset references and stage the static web app in `dist\web`. The server uses this generated frontend when present and otherwise serves `public` directly. This is a static-site build; it does not build or package Electron.

Startup preserves the configured database and legacy JSON state. It does not clear existing accounts, servers, conversations, messages, sessions, OAuth links, or activity pairings. New local accounts start without servers; users can create a server or join one with a valid invitation.

Create a local account in the login screen. Passwords must be at least 12 characters and are stored as scrypt hashes. Local accounts are ordinary MINECORD accounts, not simulated OAuth identities. Minecraft ownership, a Microsoft app registration, and Minecraft linking are not required.

New accounts receive only servers they are members of; registration does not create or join a server. DM conversations are derived from accepted friends and persistent DM history, so a peer going offline does not hide the conversation. Unread DM cursors persist in the server state and advance only when the conversation is opened or a currently open conversation becomes visible.

## 2. Database setup and backups

SQLite is used by default. Set `DATABASE_URL` to a writable SQLite path, for example:

```env
DATABASE_URL=./server/minecord.sqlite
```

On Windows, a full path such as `DATABASE_URL=C:\MINECORD\data\minecord.sqlite` is also supported. Put the database on persistent storage and back it up before upgrades. For a consistent SQLite backup, stop the server first or use SQLite's online backup facility; retain the database and its WAL files together when copying a live instance. Do not delete `server/minecord.sqlite` or `server/data.json` during upgrades.

## 3. OAuth setup

OAuth is optional. Local accounts work without provider credentials. For a provider, configure the client ID, client secret, and exact callback URL on the MINECORD server; secrets never belong in the Electron client.

| Provider | Environment variables | Provider callback URL |
|---|---|---|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | `https://YOUR_DOMAIN/auth/google/callback` |
| Microsoft | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_CALLBACK_URL` | `https://YOUR_DOMAIN/auth/microsoft/callback` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` | `https://YOUR_DOMAIN/auth/github/callback` |

Register the callback exactly as shown with each identity provider. Google and GitHub callback URLs are derived from `APP_URL` in production, so an HTTPS `APP_URL` takes precedence over stale localhost callback overrides. In local development, those optional overrides remain available; otherwise callbacks use `${APP_URL}/auth/<provider>/callback`. When `APP_URL` is a local HTTP origin, OAuth started from a LAN/private address on the same port automatically returns to that initiating origin; a localhost callback override is ignored for a different LAN origin. Add any extra hostnames or origins with `OAUTH_ALLOWED_ORIGINS` (comma-separated) and register every callback URL used with the provider. Microsoft continues to use `MICROSOFT_CALLBACK_URL` when configured. OAuth state is stored as a one-use, expiring record in SQLite and bound to the initiating browser by a short-lived HttpOnly, SameSite=Lax cookie. The callback consumes state atomically before exchanging the authorization code on the server and creates an HttpOnly session cookie. State therefore survives a process restart only when the callback reaches a server using the same SQLite database. Do not run multiple instances with separate local SQLite files; use one shared persistent database/service instance. Set `APP_URL` to the public HTTPS origin in production. On Render, `RENDER_EXTERNAL_URL` is also used as a fallback when `APP_URL` is unset. Keep `.env` out of source control; `.gitignore` excludes it while allowing `.env.example`.

Signed-in users can link Google, Microsoft, and GitHub from **Settings → Linked sign-in accounts**. The provider must be configured on the server and use the same registered callback URL as sign-in. Linking requires a live MINECORD session and a one-use OAuth state tied to that account. MINECORD links by the provider's stable account ID, never by email; it will not merge an identity that belongs to another MINECORD account. Users must keep at least one sign-in method. Provider access tokens are exchanged server-side and are not stored.

### Roles and App Owner setup

New registrations start as **New Member** and move to **Member** only after the user completes onboarding and accepts the community guidelines. Existing accounts without a saved role are retained as Members during the additive migration. The six persistent role labels are New Member, Member, Developer, Moderator, Administrator, and App Owner. Only the configured App Owner can grant or revoke Developer, Moderator, and Administrator; the App Owner role cannot be assigned through an API request or UI. Role changes are audited, and the configured owner's identity is determined only by `APP_OWNER_USER_ID`, never by username.

Role checks are performed by the server. Developer currently provides a trusted account badge but no access to private data or role-management endpoints. Moderator/report management and Administrator platform-setting workflows are not enabled because this application does not yet include a report queue or general platform-settings console; the corresponding server permission boundaries are defined but are not exposed as placeholder endpoints. Role badges appear on profiles, friend/member views, and messages.

### Shop

The Shop is available from the main navigation and uses only server-priced cosmetics and **Demo Credits**, a test currency with no real-world value. The first shop visit grants a one-time demo balance; transactions, inventory, and equipped cosmetics are persisted in SQLite. Purchases require an authenticated Member (New Members cannot purchase), are idempotent, reject duplicate ownership, and cannot assign roles. No payments, subscriptions, or cash-out are implemented.

### Account merging

Open **Settings → Accounts** to merge two accounts. The destination account must be recently re-authenticated, then the source account must be independently verified with its local password or a linked Google, Microsoft, or GitHub identity. Matching email addresses are not proof. Review the preview and explicit conflict decisions before confirming. The destination username, role, and conflicting profile values win; linked provider identities, local credentials, supported messages, friends, server memberships, shop balances/inventory/transactions, and profile data are combined. Duplicate friendships and memberships are deduplicated. Messages between the two accounts are kept in a private merged-DM archive rather than becoming a self-conversation. The source username remains a sign-in alias when it had a local password; source roles are never transferred.

The merge is committed as one SQLite transaction, written to an audit record without authentication tokens, and invalidates existing sessions. A failed database transaction leaves the pre-merge state intact. The source account's activity pairing and connector token are revoked because those credentials cannot be safely transferred; pair the extension again after merging if needed. Do not merge while either account has active sessions you need to keep; sign in again after a successful merge.

To establish the App Owner, first create/sign in to the intended account, retrieve its opaque `id` from the authenticated `GET /api/auth/me` response, and set `APP_OWNER_USER_ID` to that exact ID in the server's private environment configuration. Restart/redeploy the server. Do not configure an owner by username: a username can be claimed and is not a safe identity for granting ownership. The configured account is the only App Owner; if the ID does not match an existing account, the server logs a warning and leaves role administration unavailable. Once active, the App Owner can assign the Developer role to an existing account such as `chungo_25` from Settings.

Microsoft sign-in uses the configured app registration and the exact `MICROSOFT_CALLBACK_URL`. To link a Minecraft Java profile, first sign in to MINECORD, open **Settings → Minecraft**, and choose **Link official Minecraft Java account**. Microsoft then authorizes the Xbox Live scope; MINECORD performs the Xbox Live, XSTS, and Minecraft Services exchanges on the server and stores only the verified Java profile name and UUID. OAuth/Xbox/Minecraft access tokens are discarded and are never sent to the frontend or stored. The linked profile can be removed from the same settings screen. The Microsoft app registration must allow personal Microsoft accounts and use the callback URL registered for this app. A Microsoft account without an eligible Minecraft Java profile cannot be linked through the Minecraft Java profile API.

## 4. Production server setup

1. Deploy this project to a persistent Node.js host with Node 24+.
2. Configure the host build command as `npm install && npm run build` and start command as `npm start`.
3. Copy `.env.example` to the host's secret/environment configuration and set `APP_URL=https://YOUR_DOMAIN`.
4. Set `DATABASE_URL` to a persistent SQLite file path.
5. Terminate HTTPS at the host or a reverse proxy and proxy both HTTP and WebSocket upgrades to the Node service. Preserve the `Upgrade` and `Connection` headers so browser/Electron WebSockets use WSS externally.
6. Keep the SQLite file on persistent storage and make regular backups.
7. Register OAuth callbacks at the public URLs above and set the matching secrets on the server only.

Render's default service filesystem is ephemeral. If using Render with SQLite, attach a persistent disk and set `DATABASE_URL` to a file beneath its mount path (for example, `/var/data/minecord.sqlite` for a disk mounted at `/var/data`). A repository deployment manifest does not configure or prove that a Render disk exists; verify it in the service's **Disks** settings before relying on persistence.

The app's built-in HTTP listener does not itself configure TLS certificates. Use a production TLS reverse proxy or a hosting platform that provides HTTPS and WebSocket forwarding. An HTTP tunnel provides neither TURN nor WebRTC media relay.

## 5. TURN setup for voice and video calls

Voice and video calls use Metered TURN when configured and fall back to Google STUN if not. STUN-only calls are best effort and may fail on restrictive networks. Set these values only in the server's private environment configuration:

```env
METERED_APP_NAME=minecord
METERED_SECRET_KEY=YOUR_PRIVATE_METERED_SECRET_KEY
```

`METERED_APP_NAME` defaults to `minecord`. The backend reads `METERED_SECRET_KEY`; it must never be committed, logged, or sent to a browser. The server creates an authenticated Metered credential with an exact 24-hour expiry when a signed-in account requests `/api/rtc-config`, then retrieves the provider's ICE array and stores it in SQLite per user. The provider credential is reused until it is near expiry. Metered documents that newly created credentials may need up to two minutes to propagate, so retry the first call if relay allocation fails. No credential is created for unauthenticated requests.

`GET /api/rtc-usage` reports current usage only for the signed-in account's own TURN credential. Metered usage queries use the server-side secret and the saved credential username; users cannot query another credential through this endpoint. API key and usage responses use `Cache-Control: no-store`.

For operators using their own coturn server instead, the existing optional fallback accepts `TURN_URL` and `TURN_SHARED_SECRET` and derives short-lived credentials locally. Do not use permanent `TURN_USERNAME` / `TURN_CREDENTIAL` values; they are intentionally not sent to clients. Metered takes precedence when `METERED_SECRET_KEY` is configured.

For a real relay test, call between two devices on separate networks. Inspect the selected candidate pair in browser WebRTC stats and verify that either the local or remote candidate type is `relay`. An ICE config response proves only that credential provisioning succeeded; it does not prove a relay was reachable or selected. Automated tests mock Metered's API and cannot establish real relay connectivity or audible microphone media.

The service does not change Metered billing or select a plan. If credential creation is rejected because the Metered account has no TURN access, check the account/provider dashboard yourself before enabling production usage.

Private calls can be started as voice or video from a DM. Group calls use the person-plus action, and **Add people** can invite more accepted, online friends to an active call; adding beyond two people upgrades the call to a group call. Invitations are separate from server invitations and only use the call signaling channel. Calls are capped by `MAX_CALL_PARTICIPANTS` (2-25, default 10) and unanswered calls time out after `CALL_RING_TIMEOUT_MS` (1000-120000 ms, default 45000). Microphone/camera permission failures leave a clear error state instead of a fake call, and ending a call closes peer connections, stops local media, clears the timer, and restores the previous screen.

For a real voice or video test, open the HTTPS MINECORD site on two separate devices/browsers, create or sign in to two accounts, add and accept the friendship, then either join the same server voice channel or start a DM voice/video call and accept it on the other device. Grant microphone (and camera) permission on both devices; check that participant status becomes `connected`, speak to verify actual two-way audio, verify remote video and local preview for video calls, and try mute, camera toggle, add people, deafen, leave, reconnect, and rejoin. The browser in-call status reports the selected route when WebRTC exposes it and may show a speaking indicator from inbound audio stats. Automated tests verify authorization, signaling, media state, invitation behavior, cleanup, and static UI contracts only; they do not prove microphone/camera access, audible media, or TURN relay connectivity.

## 6. Configure the packaged client server URL

Before packaging, edit `desktop/config.json` and set its `serverUrl` to the shared server, for example:

```json
{
  "serverUrl": "https://chat.YOUR_DOMAIN"
}
```

The packaged client uses this URL and never falls back to localhost. `MINECORD_SERVER_URL` may override it at runtime. An unpackaged development run uses `http://localhost:3000` by default.

## 7. Build the Windows EXE

On Windows, after configuring `desktop/config.json`:

```powershell
npm install
npm run build:desktop
```

The NSIS installer is written to `dist\MINECORD Setup <version>.exe`. It packages the Electron client and frontend, not the server or `.env` secrets. Electron checks GitHub Releases for updates when a packaged client starts. The repository's release publisher is configured in `package.json`; publish a versioned GitHub Release to make an update available. GitHub Release assets must be publicly downloadable by clients; private-repository releases need an authenticated update-distribution design. Do not publish a release until the new installer has been tested.

## 8–9. Send the installer to friends

Send friends the generated `dist\MINECORD Setup 1.0.0.exe`. They install and launch it, then create their own MINECORD local account or use one of the enabled OAuth providers. Every friend must be able to reach the same public HTTPS server; no one needs to host a separate local server. The production server URL is already in the packaged client's `desktop/config.json`.

## 10. Upgrade without losing messages

Deploy the new server code while retaining the same `DATABASE_URL` and persistent database file. Back up the SQLite database before deployment, stop the service for a file-copy backup, and do not remove the database volume as part of a release. Schema changes are applied with additive `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE` migrations. Releases must not clear existing accounts or messages.

## Game activity and privacy

- The Electron client independently checks only the known Minecraft Java (`javaw` with a Minecraft window title) and Bedrock (`Minecraft.Windows`) process identifiers on Windows. It never uploads process names or process lists. It does not infer player names or server/world details.
- Eaglercraft opened in a separate Chrome browser cannot be observed by the Electron client. The installer includes the Chrome adapter at `%LOCALAPPDATA%\Programs\MINECORD\resources\browser-extension` (or use the project's `browser-extension` folder for development). Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select that folder. Generate a code in MINECORD Settings, then use either the extension popup or its **Options** page to enter the MINECORD server URL and one-time code and approve the server-origin permission. The adapter supports the legacy Eaglercraft CDN page and `https://eaglercraft.com/play?version=26.2`; it reports activity only when a rendered game canvas is detected. It does not read the Eaglercraft username or server address, so it cannot safely offer Join Game links for this client.
- Game activity sharing can be turned off in MINECORD Settings. Turning it off clears current activity and revokes the Eaglercraft connector; pair the extension again if sharing is later re-enabled.
- Activity is visible only to accepted MINECORD friends and expires automatically if the client/extension stops sending heartbeats. Java/Bedrock username, world and server information are omitted because these detectors cannot reliably obtain them without a supported game integration.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No (default `3000`) | HTTP server port |
| `APP_URL` | Production | Public app origin; use HTTPS in production |
| `DATABASE_URL` | No (default `server/minecord.sqlite`) | Persistent SQLite path |
| `APP_OWNER_USER_ID` | Optional | Exact existing MINECORD user ID assigned the App Owner role |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional, as a pair | Google OAuth credentials |
| `GOOGLE_CALLBACK_URL` | Optional | Google callback override |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Optional, as a pair | Microsoft OAuth credentials |
| `MICROSOFT_CALLBACK_URL` | Optional | Microsoft sign-in and Minecraft-link callback; defaults to `${APP_URL}/auth/microsoft/callback` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional, as a pair | GitHub OAuth credentials |
| `GITHUB_CALLBACK_URL` | Optional | GitHub callback override |
| `OAUTH_ALLOWED_ORIGINS` | Optional | Comma-separated extra origins allowed to initiate OAuth, such as a LAN hostname |
| `STUN_URL` | Optional | Additional comma-separated STUN/STUNS URLs |
| `MAX_CALL_PARTICIPANTS` | Optional (default `10`) | Maximum people in one call; clamped to 2-25 |
| `CALL_RING_TIMEOUT_MS` | Optional (default `45000`) | Unanswered call timeout in milliseconds; clamped to 1000-120000 |
| `TURN_URL`, `TURN_SHARED_SECRET` | Optional, both | Existing self-hosted coturn relay fallback |
| `METERED_APP_NAME` | Optional (default `minecord`) | Metered application name for server-side TURN REST calls |
| `METERED_SECRET_KEY` | Optional | Private Metered API secret; used only on the server to provision credentials and query usage |
| `MINECORD_SERVER_URL` | Optional | Electron runtime URL override; edit `desktop/config.json` before packaging |
