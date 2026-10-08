# MINECORD

MINECORD is a Discord-style chat client and self-hosted server for a small group. The Windows installer is only the Electron client. Everyone must sign into the same online MINECORD server; the installer never starts a private MINECORD server.

Minecraft is optional. Users can create MINECORD local accounts and use friends, DMs, servers, chat, and calls without owning Minecraft or connecting Microsoft. Microsoft/Minecraft linking is an optional profile connection in Settings; it is not part of registration or authorization for communication features.

## Shared multi-client architecture

The server and its persistent database are the single source of truth for every client. The web app uses the hosting origin, and the Windows Electron client uses `MINECORD_SERVER_URL` or `desktop/config.json`; both connect to the same HTTP API, authenticated WebSocket service, and database. `GET /api/config` advertises the common `apiBaseUrl` and `websocketUrl` for clients that need runtime configuration. Do not deploy one backend or database per device.

The existing project ships the web app and Windows Electron client. Android and iOS/iPadOS clients are not currently packaged, but should consume this same server configuration and API/WebSocket protocol rather than introducing separate account or messaging storage. They must store the authenticated session securely on-device and send it with HTTP/WebSocket requests. Native app builds and their platform-specific OAuth redirects are separate future client work; they are not prerequisites for using MINECORD today.

## 1. Local development

Use Node.js 24 or newer (the app uses Node's built-in `node:sqlite` module).

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Open `http://localhost:3000` in a browser or run `npm run desktop` for the Electron client. The local server creates `server/minecord.sqlite` and imports existing `server/data.json` the first time the database is initialized. The JSON file is kept unchanged as a migration source/backup.

Create a local account in the login screen. Passwords must be at least 12 characters and are stored as scrypt hashes. Local accounts are ordinary MINECORD accounts, not simulated OAuth identities. Minecraft ownership, a Microsoft app registration, and Minecraft linking are not required.

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

Register the callback exactly as shown with each identity provider. If a callback variable is omitted, MINECORD uses `${APP_URL}/auth/<provider>/callback`. OAuth uses a one-use state value, exchanges authorization codes on the server, and creates an HttpOnly session cookie. Set `APP_URL` to the public HTTPS origin in production. Keep `.env` out of source control; `.gitignore` excludes it while allowing `.env.example`.

Microsoft sign-in uses the configured app registration and the exact `MICROSOFT_CALLBACK_URL`. To link a Minecraft Java profile, first sign in to MINECORD, open **Settings → Minecraft**, and choose **Link official Minecraft Java account**. Microsoft then authorizes the Xbox Live scope; MINECORD performs the Xbox Live, XSTS, and Minecraft Services exchanges on the server and stores only the verified Java profile name and UUID. OAuth/Xbox/Minecraft access tokens are discarded and are never sent to the frontend or stored. The linked profile can be removed from the same settings screen. The Microsoft app registration must allow personal Microsoft accounts and use the callback URL registered for this app. A Microsoft account without an eligible Minecraft Java profile cannot be linked through the Minecraft Java profile API.

## 4. Production server setup

1. Deploy this project to a persistent Node.js host with Node 24+.
2. Copy `.env.example` to the host's secret/environment configuration and set `APP_URL=https://YOUR_DOMAIN`.
3. Set `DATABASE_URL` to a persistent SQLite file path.
4. Terminate HTTPS at the host or a reverse proxy and proxy both HTTP and WebSocket upgrades to the Node service. Preserve the `Upgrade` and `Connection` headers so browser/Electron WebSockets use WSS externally.
5. Keep the SQLite file on persistent storage and make regular backups.
6. Register OAuth callbacks at the public URLs above and set the matching secrets on the server only.

The app's built-in HTTP listener does not itself configure TLS certificates. Use a production TLS reverse proxy or a hosting platform that provides HTTPS and WebSocket forwarding. An HTTP tunnel provides neither TURN nor WebRTC media relay.

## 5. TURN setup for voice

STUN is configured by default. For networks that require a relay, operate a TURN service (for example, coturn), enable TLS/UDP as appropriate, and set all of:

```env
TURN_URL=turns:turn.YOUR_DOMAIN:5349
TURN_USERNAME=YOUR_TURN_USERNAME
TURN_CREDENTIAL=YOUR_TURN_CREDENTIAL
```

The server only advertises TURN when all three values are set. These credentials are not checked into source, but values supplied to browser WebRTC clients are visible to those clients; use short-lived, restricted TURN credentials for production instead of permanent administrator credentials. TURN relays media; an HTTP tunnel does not.

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

The NSIS installer is written to `dist\MINECORD Setup 1.0.0.exe`. It packages the Electron client and frontend, not the server or `.env` secrets.

## 8–9. Send the installer to friends

Send friends the generated `dist\MINECORD Setup 1.0.0.exe`. They install and launch it, then create their own MINECORD local account or use one of the enabled OAuth providers. Every friend must be able to reach the same public HTTPS server; no one needs to host a separate local server. The production server URL is already in the packaged client's `desktop/config.json`.

## 10. Upgrade without losing messages

Deploy the new server code while retaining the same `DATABASE_URL` and persistent database file. Back up the SQLite database before deployment, stop the service for a file-copy backup, and do not remove the database volume as part of a release. Schema changes are applied with additive `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE` migrations. Existing `server/data.json` content is imported only when the SQLite database has no saved state.

## Game activity and privacy

- The Electron client independently checks only the known Minecraft Java (`javaw` with a Minecraft window title) and Bedrock (`Minecraft.Windows`) process identifiers on Windows. It never uploads process names or process lists. It does not infer player names or server/world details.
- Eaglercraft opened in a separate Chrome browser cannot be observed by the Electron client. The installer includes the Chrome adapter at `%LOCALAPPDATA%\Programs\MINECORD\resources\browser-extension` (or use the project's `browser-extension` folder for development). Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select that folder. Generate a code in MINECORD Settings, open the extension popup, enter the same MINECORD server URL and code, then approve the server-origin permission. This adapter is scoped to the Eaglercraft URL supplied for this client/version and reports only whether its rendered game canvas is active. It does not read the Eaglercraft username or server address.
- Game activity sharing can be turned off in MINECORD Settings. Turning it off clears current activity and revokes the Eaglercraft connector; pair the extension again if sharing is later re-enabled.
- Activity is visible only to accepted MINECORD friends and expires automatically if the client/extension stops sending heartbeats. Java/Bedrock username, world and server information are omitted because these detectors cannot reliably obtain them without a supported game integration.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No (default `3000`) | HTTP server port |
| `APP_URL` | Production | Public app origin; use HTTPS in production |
| `DATABASE_URL` | No (default `server/minecord.sqlite`) | Persistent SQLite path |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional, as a pair | Google OAuth credentials |
| `GOOGLE_CALLBACK_URL` | Optional | Google callback override |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Optional, as a pair | Microsoft OAuth credentials |
| `MICROSOFT_CALLBACK_URL` | Optional | Microsoft sign-in and Minecraft-link callback; defaults to `${APP_URL}/auth/microsoft/callback` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Optional, as a pair | GitHub OAuth credentials |
| `GITHUB_CALLBACK_URL` | Optional | GitHub callback override |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | Optional, all three | TURN server advertised for voice |
| `MINECORD_SERVER_URL` | Optional | Electron runtime URL override; edit `desktop/config.json` before packaging |
