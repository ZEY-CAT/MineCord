# MineCord Updater Architecture

## Two Distinct Updater Paths

This project uses **two separate, independent updater implementations** for different platforms and distribution channels. They do not share code, keys, or verification logic.

---

## 1. Windows Native Updater (C++ DLL + Koffi Bridge)

**Platform**: Windows only (x64)

**Components**:
- `updater/src/` — C++ DLL (`MineCordUpdater.dll`)
- `desktop/updater-bridge.js` — Node.js/Koffi bridge
- `desktop/main.js` — Electron integration

**Verification Flow**:
1. `checkForUpdates()` calls `CheckForUpdates()` in DLL
2. Server returns manifest with `downloadUrl`, `sha256Hash`, `minisigBase64` (Ed25519 signature)
3. `verifySignature()` downloads artifact to temp file
4. DLL's `VerifyMinisignSignature()` verifies Ed25519 signature against **pinned public key** (hardcoded in `Verify.cpp`)
5. `InstallUpdate()` enforces hash + signature verification **before** installation
6. Fail-closed on any verification failure

**Key Properties**:
- **No external minisign binary required** — pure Windows BCrypt (BCRYPT_ED25519_ALGORITHM)
- **Pinned public key** — embedded in binary, ignores server-provided key
- **Signs artifact SHA-256 hash** — server signs `manifest.sha256Hash`
- **Used by**: Windows Electron build only

**Files**:
- `updater/src/Verify.cpp` — Ed25519 verification via BCrypt
- `updater/src/Install.cpp` — Install-time verification enforcement
- `desktop/updater-bridge.js` — JS bridge, verification orchestration
- `server/updater-routes.js` — `/sign` endpoint signs `sha256Hash`

---

## 2. Tauri Plugin Updater (Cross-Platform)

**Platforms**: Windows (Tauri), macOS, Linux, Android

**Implementation**: `tauri-plugin-updater` (Rust crate)

**Configuration** (`src-tauri/tauri.conf.json`):
```json
"plugins": {
  "updater": {
    "pubkey": "<MINISIGN_PUBLIC_KEY>",
    "endpoints": ["https://updates.example.com/{{target}}/{{current_version}}"]
  }
}
```

**Verification Flow**:
1. Tauri's built-in updater checks endpoint
2. Downloads `latest.json` manifest (minisign format)
3. Verifies minisign signature against **embedded public key** (`pubkey` in config)
4. Downloads and verifies artifact
5. Installs via platform-specific mechanism

**Key Properties**:
- **Uses minisign format** — compatible with `minisign` CLI
- **Public key in config** — not hardcoded in binary (can be overridden at build time)
- **Used by**: Tauri builds (Windows Tauri, macOS, Linux, Android)

**Files**:
- `src-tauri/tauri.conf.json` — updater plugin configuration
- `scripts/tauri-updater-config.js` — config resolution

---

## Key Distinctions

| Aspect | Windows Native DLL | Tauri Plugin Updater |
|--------|-------------------|---------------------|
| **Platform** | Windows only | Windows/macOS/Linux/Android |
| **Build Target** | Electron only | Tauri builds |
| **Language** | C++ (BCrypt) | Rust (minisign crate) |
| **Signature Format** | Raw Ed25519 (IEEE P1363) | minisign format |
| **Key Storage** | Hardcoded in binary | Config file (`tauri.conf.json`) |
| **Verification** | Custom BCrypt | minisign crate |
| **Signature Covers** | Artifact SHA-256 hash | Full artifact (minisign) |
| **Private Key** | Separate production key | minisign private key |

---

## Security Notes

1. **Keys are separate** — Windows DLL uses its own Ed25519 keypair; Tauri uses minisign keypair. They are NOT interchangeable.

2. **Pinned keys** — Both implementations pin the public key at build time:
   - DLL: hardcoded in `Verify.cpp`
   - Tauri: embedded in binary via `pubkey` config

3. **Server signing** — `/api/admin/updater/manifests/:file/sign` endpoint signs the **artifact SHA-256 hash** for the Windows DLL path. The Tauri path uses standard minisign signing.

4. **Production keys** — Current public keys in source are **TEST PLACEHOLDERS**. Replace during production deployment:
   - `updater/src/Verify.cpp` line 25
   - `desktop/updater-bridge.js` line 20
   - `src-tauri/tauri.conf.json` `pubkey` field

---

## Build Outputs

| Build | Updater Used |
|-------|--------------|
| `npm run build:desktop` (Electron) | Windows Native DLL |
| `npm run tauri:build` (Windows Tauri) | Tauri Plugin Updater |
| `npm run tauri:build` (macOS) | Tauri Plugin Updater |
| `npm run tauri:build` (Linux) | Tauri Plugin Updater |
| `npm run tauri:build` (Android) | Tauri Plugin Updater |

---

## Do Not Mix

- ❌ Do not use Tauri's `tauri-plugin-updater` for Electron builds
- ❌ Do not use Windows DLL for Tauri/macOS/Linux/Android
- ❌ Do not share private keys between the two systems
- ✅ Each path is independently secure when properly configured