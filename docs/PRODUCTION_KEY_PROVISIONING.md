# MineCord Updater - Production Key Provisioning Guide

## Overview

The MineCord native updater uses Ed25519 signatures (compatible with minisign format) to verify update artifacts. The production public key is **pinned** in the client binary to prevent key substitution attacks.

**⚠️ CRITICAL**: The current public key in the source code is a **TEST KEY PLACEHOLDER** and **MUST BE REPLACED** with a real production key before any production release.

## Current Placeholder Keys

### Test Key (Used in Automated Tests Only)
- **Public Key (base64)**: `kxKYdXpXwSUX6ZEAPfVSKYE9kvQgBq3Lqr0LGqTxMWo=`
- **Private Key (PEM)**: Stored in `tests/updater-crypto-helpers.js`
- **Purpose**: Automated test suite verification only
- **Location**: `tests/updater-crypto-helpers.js`

### Production Key Placeholder (Current in Client)
- **Public Key (base64)**: `9fbByVDf7DgyNEmzLzECdJLiG+/lQyZQ1FD8INpt7M4=`
- **Location**: 
  - `updater/src/Verify.cpp` (line 24)
  - `desktop/updater-bridge.js` (line 19)
- **Status**: **PLACEHOLDER - NOT FOR PRODUCTION USE**

## Secure Production Key Provisioning Process

### Step 1: Generate Production Keypair (Offline, Air-Gapped Machine)

```bash
# On a dedicated, offline machine (no network access):
node -e "
const crypto = require('crypto');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' }
});

// Get raw public key (32 bytes, base64)
const pubKeyObj = crypto.createPublicKey({ key: publicKey, format: 'pem', type: 'spki' });
const jwk = pubKeyObj.export({ format: 'jwk' });
const rawPubKey = jwk.x.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - jwk.x.length % 4) % 4);

console.log('=== PRODUCTION PUBLIC KEY (base64) ===');
console.log(rawPubKey);
console.log('');
console.log('=== PRODUCTION PRIVATE KEY (PEM) - KEEP SECRET ===');
console.log(privateKey);
"
```

**Output Format**:
- **Public Key**: 44-character base64 string (32 bytes raw)
- **Private Key**: PKCS#8 PEM format

### Step 2: Secure Private Key Storage

1. **Immediately** write the private key to a hardware security module (HSM) or air-gapped secure storage
2. **Never** commit the private key to Git, store in CI/CD variables, or include in any build artifacts
3. Use the private key **only** for the signing process (see Step 3)

### Step 3: Update Client with Production Public Key

Replace the placeholder in TWO locations:

**File 1: `updater/src/Verify.cpp` (line ~24)**
```cpp
// REPLACE THIS WITH ACTUAL PRODUCTION PUBLIC KEY DURING DEPLOYMENT
static const std::string PINNED_MINISIGN_PUBLIC_KEY_BASE64 = 
    "YOUR_PRODUCTION_PUBLIC_KEY_HERE";
```

**File 2: `desktop/updater-bridge.js` (line ~19)**
```javascript
// REPLACE THIS WITH ACTUAL PRODUCTION PUBLIC KEY DURING DEPLOYMENT
this.PINNED_MINISIGN_PUBLIC_KEY = 'YOUR_PRODUCTION_PUBLIC_KEY_HERE';
```

### Step 4: Configure CI/CD Signing Pipeline

The signing process runs on the server via the `/api/admin/updater/manifests/:manifestFile/sign` endpoint:

```bash
# Server-side signing (requires Node.js >= 18):
# 1. Load private key from secure storage (HSM, Vault, etc.)
# 2. POST to /api/admin/updater/manifests/<file>/sign with { "privateKeyPath": "/path/to/private.key" }

# The private key must be in PKCS#8 PEM format:
-----BEGIN PRIVATE KEY-----
<base64-encoded-private-key>
-----END PRIVATE KEY-----
```

### Step 5: Verify Build and Sign

```bash
# 1. Build native DLL
npm run build:updater

# 2. Build Electron desktop app (includes DLL via extraResources)
npm run build:desktop

# 3. Verify DLL is in output
ls dist/win-unpacked/MineCordUpdater.dll

# 4. Create manifest with artifact hash and sign it
# (Use the admin UI or API to create manifest and sign)
```

## Verification Checklist

Before releasing to production:

- [ ] Production public key replaces placeholder in `updater/src/Verify.cpp`
- [ ] Production public key replaces placeholder in `desktop/updater-bridge.js`
- [ ] Private key stored securely (HSM/air-gapped), **not** in repo/CI
- [ ] Native DLL builds successfully: `npm run build:updater`
- [ ] Electron app builds with DLL: `npm run build:desktop`
- [ ] DLL present in `dist/win-unpacked/MineCordUpdater.dll`
- [ ] All tests pass: `npm test` (45 tests)
- [ ] Test signing/verification roundtrip works with production key
- [ ] `server/data.json` unchanged (test data only)

## Key Rotation Procedure

If a production key must be rotated:

1. Generate new keypair using Step 1
2. Update client public key (Step 3) - requires app update
3. Sign new artifacts with new private key
4. Old signatures remain valid until app is updated
5. Monitor for verification failures after rollout

## Security Notes

- **Ed25519** with IEEE P1363 encoding (64 bytes: r || s)
- **SHA-256** hash of artifact is signed (not the manifest JSON)
- **Windows BCrypt** used for verification (BCRYPT_ED25519_ALGORITHM)
- Minimum Windows version: 10 1809 (build 17763)
- No external `minisign` binary required on client machines

## Test Key Reference

For automated testing only - the test keypair in `tests/updater-crypto-helpers.js` is used by the 12 cryptographic tests in `tests/updater-crypto.test.js`. These tests verify:
- Valid signature verification
- Tampered artifact rejection
- Wrong public key rejection
- Invalid/malformed/truncated signature rejection
- Hash mismatch rejection
- Signature covering exact artifact hash

**Never use test keys for production.**