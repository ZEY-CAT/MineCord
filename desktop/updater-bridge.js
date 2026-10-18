const koffi = require('koffi');
const path = require('path');
const fs = require('fs');

/**
 * MineCordUpdater DLL Bridge
 * Provides a safe JavaScript interface to the MineCordUpdater.dll
 */

class MineCordUpdater {
    constructor() {
        this.lib = null;
        this.loaded = false;
        this.dllPath = null;
        
        // Pinned minisign public key (base64, 32-byte Ed25519 public key) - production key
        // Generated with: node -e "const crypto = require('crypto'); const { publicKey } = crypto.generateKeyPairSync('ed25519', { publicKeyEncoding: { format: 'pem', type: 'spki' } }); const jwk = crypto.createPublicKey({ key: publicKey, format: 'pem', type: 'spki' }).export({ format: 'jwk' }); console.log(jwk.x.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - jwk.x.length % 4) % 4));"
        // REPLACE THIS WITH ACTUAL PRODUCTION PUBLIC KEY DURING DEPLOYMENT
        // Current value is a TEST KEY PLACEHOLDER - NOT FOR PRODUCTION USE
        this.PINNED_MINISIGN_PUBLIC_KEY = '9fbByVDf7DgyNEmzLzECdJLiG+/lQyZQ1FD8INpt7M4=';
    }

    /**
     * Load the MineCordUpdater.dll
     * @returns {Promise<void>}
     */
    async load() {
        if (this.loaded) return;

        // Try to find the DLL
        const possiblePaths = [
            // Installed location
            path.join(process.resourcesPath || process.cwd(), 'MineCordUpdater.dll'),
            // Development location
            path.join(__dirname, '..', 'MineCordUpdater.dll'),
            // Build output location
            path.join(__dirname, '..', 'updater', 'build', 'Release', 'MineCordUpdater.dll'),
            // Project root
            path.join(__dirname, '..', '..', 'MineCordUpdater.dll'),
        ];

        let dllPath = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                dllPath = p;
                break;
            }
        }

        if (!dllPath) {
            throw new Error('MineCordUpdater.dll not found in any expected location');
        }

        this.dllPath = dllPath;
        console.log(`Loading MineCordUpdater.dll from: ${dllPath}`);

        try {
            this.lib = koffi.load(dllPath);
            this._defineSymbols();
            this.loaded = true;
            console.log('MineCordUpdater.dll loaded successfully');
        } catch (error) {
            throw new Error(`Failed to load MineCordUpdater.dll: ${error.message}`);
        }
    }

    _defineSymbols() {
        const lib = this.lib;

        // Define the UpdateInfo struct
        const UpdateInfo = lib.struct('UpdateInfo', {
            version: 'string',
            downloadUrl: 'string',
            sha256Hash: 'string',
            minisigBase64: 'string',
            releaseNotes: 'string',
            critical: 'int'
        });

        // Define the ProgressCallback type
        const ProgressCallback = koffi.proto('int __stdcall(uint64_t, uint64_t, void*)');

        // Define the API functions
        lib.func('CheckForUpdates', 'int', [
            'string',     // serverUrl
            'string',     // currentVersion
            'string',     // platform
            'string',     // arch
            'string',     // channel
            'UpdateInfo*' // outInfo
        ]);

        lib.func('DownloadUpdate', 'int', [
            'string',           // downloadUrl
            'string',           // destPath
            'pointer',          // progressCb (pointer to callback)
            'pointer'           // userData
        ]);

        lib.func('InstallUpdate', 'int', [
            'string', // installerPath
            'string', // installDir
            'string', // signatureBase64
            'string'  // expectedHash
        ]);

        lib.func('FreeUpdateInfo', 'void', ['UpdateInfo*']);
        lib.func('GetUpdaterLastError', 'string', []);
        lib.func('GetUpdaterVersion', 'string', []);

        this.UpdateInfo = UpdateInfo;
        this.ProgressCallback = ProgressCallback;
    }

    /**
     * Check for updates from the server
     * @param {Object} options - Update check options
     * @param {string} options.serverUrl - Base URL of the update server
     * @param {string} options.currentVersion - Current version string
     * @param {string} options.platform - Target platform (windows, macos, linux)
     * @param {string} options.arch - Target architecture (x64, arm64)
     * @param {string} options.channel - Update channel (stable, beta, alpha)
     * @returns {Promise<Object>} Update info or null if no update
     */
    async checkForUpdates({ serverUrl, currentVersion, platform = 'windows', arch = 'x64', channel = 'stable' }) {
        if (!this.loaded) await this.load();

        const outInfo = koffi.alloc(this.UpdateInfo);
        
        const result = this.lib.CheckForUpdates(
            serverUrl,
            currentVersion,
            platform,
            arch,
            channel,
            outInfo
        );

        if (result !== 0) {
            const error = this.lib.GetUpdaterLastError();
            if (result === -3) { // UPDATER_ERROR_NO_UPDATE
                return null;
            }
            throw new Error(`Update check failed (${result}): ${error}`);
        }

        // Read the update info
        const updateInfo = {
            version: outInfo.version.readString(),
            downloadUrl: outInfo.downloadUrl.readString(),
            sha256Hash: outInfo.sha256Hash.readString(),
            minisigBase64: outInfo.minisigBase64.readString(),
            releaseNotes: outInfo.releaseNotes.readString(),
            critical: outInfo.critical
        };

        // Free the allocated memory
        this.lib.FreeUpdateInfo(outInfo);

        // Verify the Ed25519 signature using the pinned public key via the native DLL
        if (updateInfo.minisigBase64 && updateInfo.sha256Hash && updateInfo.downloadUrl) {
            const verified = await this.verifySignature(
                updateInfo.downloadUrl,
                updateInfo.sha256Hash,
                updateInfo.minisigBase64
            );
            if (!verified) {
                throw new Error('Signature verification failed: invalid or untrusted signature');
            }
        } else if (updateInfo.minisigBase64) {
            throw new Error('Signature verification failed: missing SHA-256 hash or download URL for verification');
        }

        return updateInfo;
    }

    /**
     * Verify an Ed25519 signature using the pinned public key via the native DLL
     * @param {string} downloadUrl - URL to download the artifact for verification
     * @param {string} sha256Hash - SHA-256 hash of the artifact (base64 or hex)
     * @param {string} minisigBase64 - Base64-encoded Ed25519 signature (minisign format)
     * @returns {Promise<boolean>} True if signature is valid
     */
    async verifySignature(downloadUrl, sha256Hash, minisigBase64) {
        if (!this.loaded) await this.load();

        // The native DLL expects:
        // - filePath: path to the file to verify
        // - signatureBase64: base64-encoded Ed25519 signature (raw r||s format)
        // - publicKeyBase64: base64-encoded public key (ignored, uses pinned key)
        // We need to download the file to a temporary location and verify it.
        
        const { spawnSync } = require('child_process');
        const path = require('path');
        const os = require('os');
        const fs = require('fs');
        const crypto = require('crypto');

        try {
            // Download the file to a temporary location for verification
            const tempDir = os.tmpdir();
            const tempFile = path.join(os.tmpdir(), `verify_${Date.now()}_${Math.random().toString(36).slice(2)}`);
            
            if (!downloadUrl) {
                throw new Error('No download URL available for verification');
            }
            
            await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(tempFile);
                const https = require('https');
                https.get(downloadUrl, (response) => {
                    if (response.statusCode !== 200) {
                        reject(new Error(`Download failed: ${response.statusCode}`));
                        return;
                    }
                    response.pipe(file);
                    file.on('finish', () => file.close(resolve));
                }).on('error', (err) => {
                    fs.unlinkSync(tempFile);
                    reject(err);
                });
            });

            // Verify using the native DLL
            const verified = await this.verifyFileWithDLL(tempFile, minisigBase64);
            
            // Cleanup
            try { fs.unlinkSync(tempFile); } catch {}
            
            return verified;
        } catch (error) {
            console.warn('Signature verification failed:', error.message);
            return false;
        }
    }

    /**
     * Verify a file against an Ed25519 signature using the native DLL
     * @param {string} filePath - Path to the file to verify
     * @param {string} signatureBase64 - Base64-encoded Ed25519 signature (raw r||s format)
     * @returns {Promise<boolean>} True if signature is valid
     */
    async verifyFileWithDLL(filePath, signatureBase64) {
        if (!this.loaded) await this.load();

        const result = this.lib.VerifyMinisignSignature(
            filePath,
            signatureBase64,
            this.PINNED_MINISIGN_PUBLIC_KEY // Use pinned key, ignore server-provided
        );

        return result === 0; // UPDATER_OK = 0
    }

    /**
     * Download the update installer
     * @param {string} downloadUrl - URL to download from
     * @param {string} destPath - Destination file path
     * @param {function} progressCb - Progress callback (downloaded, total) => bool (return false to cancel)
     * @returns {Promise<void>}
     */
    async downloadUpdate(downloadUrl, destPath, progressCb = null) {
        if (!this.loaded) await this.load();

        let progressCbPtr = null;
        let progressCbWrapper = null;

        if (progressCb) {
            progressCbWrapper = (downloaded, total) => {
                try {
                    return progressCb(downloaded, total) ? 1 : 0;
                } catch {
                    return 0; // Cancel on error
                }
            };
            progressCbPtr = this.lib.alloc(this.ProgressCallback, progressCbWrapper);
        }

        const result = this.lib.DownloadUpdate(
            downloadUrl,
            destPath,
            progressCbPtr,
            null
        );

        if (result !== 0) {
            const error = this.lib.GetUpdaterLastError();
            throw new Error(`Download failed (${result}): ${error}`);
        }
    }

    /**
     * Install the update
     * @param {string} installerPath - Path to the downloaded installer
     * @param {string} installDir - Installation directory
     * @param {string} signatureBase64 - Base64-encoded Ed25519 signature of the installer
     * @param {string} expectedHash - SHA-256 hash of the installer (hex or base64)
     * @returns {Promise<void>}
     */
    async installUpdate(installerPath, installDir, signatureBase64, expectedHash) {
        if (!this.loaded) await this.load();

        if (!signatureBase64 || !expectedHash) {
            throw new Error('Install failed: signature and hash are required for verification');
        }

        const result = this.lib.InstallUpdate(installerPath, installDir, signatureBase64, expectedHash);

        if (result !== 0) {
            const error = this.lib.GetUpdaterLastError();
            throw new Error(`Install failed (${result}): ${error}`);
        }
    }

    /**
     * Get the updater DLL version
     * @returns {string}
     */
    getVersion() {
        if (!this.loaded) throw new Error('Updater not loaded');
        return this.lib.GetUpdaterVersion();
    }

    /**
     * Get the last error message
     * @returns {string|null}
     */
    getLastError() {
        if (!this.loaded) return null;
        const error = this.lib.GetUpdaterLastError();
        return error || null;
    }
}

// Export singleton instance
module.exports = new MineCordUpdater();