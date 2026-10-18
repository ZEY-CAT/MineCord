const koffi = require('koffi');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');

/**
 * MineCordUpdater DLL Bridge
 * Provides a safe JavaScript interface to the MineCordUpdater.dll
 * C ABI: __stdcall, wchar_t* (UTF-16) strings, UpdateInfo** out-param
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
     * Priority order:
     * 1. Installed shared location: %ProgramFiles%\MineCord\MineCordUpdater.dll
     * 2. Electron packaged resources (fallback for existing installs)
     * 3. Development locations
     * @returns {Promise<void>}
     */
    async load() {
        if (this.loaded) return;

        // Try to find the DLL in priority order
        const possiblePaths = [
            // 1. Shared installed location (Windows)
            ...(process.platform === 'win32' ? [
                path.join(process.env.ProgramFiles || 'C:\\Program Files', 'MineCord', 'MineCordUpdater.dll'),
                path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'MineCord', 'MineCordUpdater.dll'),
            ] : []),
            // 2. Electron packaged resources
            path.join(process.resourcesPath || process.cwd(), 'MineCordUpdater.dll'),
            // 3. Development location
            path.join(__dirname, '..', 'MineCordUpdater.dll'),
            // 4. Build output location
            path.join(__dirname, '..', 'updater', 'build', 'Release', 'MineCordUpdater.dll'),
            // 5. Project root
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
            const message = 'MineCordUpdater.dll not found. Please install the MineCord Updater first by running MineCordUpdaterSetup.exe (available from the MINECORD releases page). The shared updater installs to %ProgramFiles%\\MineCord\\MineCordUpdater.dll';
            console.warn(message);
            throw new Error(message);
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

        // Define the UpdateInfo struct (matches C++ std::wstring layout: pointer, length, capacity)
        // On x64: 3 pointers (24 bytes) + int (4 bytes) + padding (4 bytes) = 32 bytes per wstring
        // But we only need to read the pointer field for wstring since Koffi can read wstring from pointer
        // The C++ struct is:
        //   std::wstring version;      // 3 pointers
        //   std::wstring downloadUrl;  // 3 pointers
        //   std::wstring sha256Hash;   // 3 pointers
        //   std::wstring minisigBase64;// 3 pointers
        //   std::wstring releaseNotes; // 3 pointers
        //   int critical;              // 4 bytes + 4 padding
        // Total: 5 * 24 + 8 = 128 bytes on x64
        // We define it as opaque pointer and read fields via Koffi's wstring from the internal pointers
        
        // Use opaque pointer type for UpdateInfo - we'll read fields manually
        const UpdateInfo = lib.struct('UpdateInfo', {
            // std::wstring internal layout: pointer, size, capacity
            _version_ptr: 'pointer',
            _version_size: 'size_t',
            _version_cap: 'size_t',
            _downloadUrl_ptr: 'pointer',
            _downloadUrl_size: 'size_t',
            _downloadUrl_cap: 'size_t',
            _sha256Hash_ptr: 'pointer',
            _sha256Hash_size: 'size_t',
            _sha256Hash_cap: 'size_t',
            _minisigBase64_ptr: 'pointer',
            _minisigBase64_size: 'size_t',
            _minisigBase64_cap: 'size_t',
            _releaseNotes_ptr: 'pointer',
            _releaseNotes_size: 'size_t',
            _releaseNotes_cap: 'size_t',
            critical: 'int32',
            // padding to align
            _pad: 'int32'
        });

        // Define the ProgressCallback type (matches C: int __stdcall(uint64_t, uint64_t, void*))
        const ProgressCallback = koffi.proto('int __stdcall(uint64_t, uint64_t, void*)');

        // Define the API functions with correct C ABI types
        // All string parameters are const wchar_t* (UTF-16) = 'wstring' in Koffi
        // Return values: const wchar_t* = 'wstring'
        // UpdateInfo** = 'pointer' (pointer to pointer)
        // UpdateInfo* = 'pointer' (single pointer)
        // Callback: function pointer = 'pointer'
        
        // GetUpdaterVersion: const wchar_t* UPDATER_CALL GetUpdaterVersion()
        const GetUpdaterVersion = lib.func('GetUpdaterVersion', 'wstring', []);
        
        // GetUpdaterLastError: const wchar_t* UPDATER_CALL GetUpdaterLastError()
        const GetUpdaterLastError = lib.func('GetUpdaterLastError', 'wstring', []);
        
        // CheckForUpdates: int UPDATER_CALL CheckForUpdates(const wchar_t*, const wchar_t*, const wchar_t*, const wchar_t*, const wchar_t*, UpdateInfo**)
        const CheckForUpdates = lib.func('CheckForUpdates', 'int', [
            'wstring',  // serverUrl
            'wstring',  // currentVersion
            'wstring',  // platform
            'wstring',  // arch
            'wstring',  // channel
            'pointer'   // UpdateInfo** (pointer to pointer)
        ]);
        
        // DownloadUpdate: int UPDATER_CALL DownloadUpdate(const wchar_t*, const wchar_t*, int (UPDATER_CALL*)(uint64_t, uint64_t, void*), void*)
        const DownloadUpdate = lib.func('DownloadUpdate', 'int', [
            'wstring',   // downloadUrl
            'wstring',   // destPath
            'pointer',   // progressCb (function pointer)
            'pointer'    // userData
        ]);
        
        // InstallUpdate: int UPDATER_CALL InstallUpdate(const wchar_t*, const wchar_t*, const wchar_t*, const wchar_t*)
        const InstallUpdate = lib.func('InstallUpdate', 'int', [
            'wstring',  // installerPath
            'wstring',  // installDir
            'wstring',  // signatureBase64
            'wstring'   // expectedHash
        ]);
        
        // FreeUpdateInfo: void UPDATER_CALL FreeUpdateInfo(UpdateInfo*)
        const FreeUpdateInfo = lib.func('FreeUpdateInfo', 'void', ['pointer']);
        
        // VerifyMinisignSignature: int UPDATER_CALL VerifyMinisignSignature(const wchar_t*, const wchar_t*, const wchar_t*)
        const VerifyMinisignSignature = lib.func('VerifyMinisignSignature', 'int', [
            'wstring',  // filePath
            'wstring',  // signatureBase64
            'wstring'   // publicKeyBase64
        ]);

        // Store function references
        this._GetUpdaterVersion = GetUpdaterVersion;
        this._GetUpdaterLastError = GetUpdaterLastError;
        this._CheckForUpdates = CheckForUpdates;
        this._DownloadUpdate = DownloadUpdate;
        this._InstallUpdate = InstallUpdate;
        this._FreeUpdateInfo = FreeUpdateInfo;
        this._VerifyMinisignSignature = VerifyMinisignSignature;
        this._UpdateInfo = UpdateInfo;
        this._ProgressCallback = ProgressCallback;
    }

    // Helper to read wstring from std::wstring internal pointer
    _readWString(ptrObj, ptrField) {
        const ptr = ptrObj[ptrField];
        if (!ptr || ptr.isNull()) return '';
        return ptr.readWString();
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

        // Allocate pointer-to-pointer (void**) for UpdateInfo** out parameter
        const outInfoPtr = koffi.alloc('pointer', 1);
        
        const result = this._CheckForUpdates(
            serverUrl,
            currentVersion,
            platform,
            arch,
            channel,
            outInfoPtr
        );

        if (result !== 0) {
            const error = this._GetUpdaterLastError();
            if (result === -3) { // UPDATER_ERROR_NO_UPDATE
                return null;
            }
            throw new Error(`Update check failed (${result}): ${error}`);
        }

        // Dereference the pointer to get UpdateInfo*
        const infoPtr = outInfoPtr.deref();
        if (!infoPtr || infoPtr.isNull()) {
            throw new Error('Update check succeeded but returned null info pointer');
        }

        // Read the update info from the C++ std::wstring fields
        const updateInfo = {
            version: this._readWString(infoPtr, '_version_ptr'),
            downloadUrl: this._readWString(infoPtr, '_downloadUrl_ptr'),
            sha256Hash: this._readWString(infoPtr, '_sha256Hash_ptr'),
            minisigBase64: this._readWString(infoPtr, '_minisigBase64_ptr'),
            releaseNotes: this._readWString(infoPtr, '_releaseNotes_ptr'),
            critical: infoPtr.critical
        };

        // Free the allocated memory (pass UpdateInfo*, not UpdateInfo**)
        this._FreeUpdateInfo(infoPtr);

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

        const result = this._VerifyMinisignSignature(
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
            progressCbPtr = this.lib.alloc(this._ProgressCallback, progressCbWrapper);
        }

        const result = this._DownloadUpdate(
            downloadUrl,
            destPath,
            progressCbPtr,
            null
        );

        if (result !== 0) {
            const error = this._GetUpdaterLastError();
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

        const result = this._InstallUpdate(installerPath, installDir, signatureBase64, expectedHash);

        if (result !== 0) {
            const error = this._GetUpdaterLastError();
            throw new Error(`Install failed (${result}): ${error}`);
        }
    }

    /**
     * Get the updater DLL version
     * @returns {string}
     */
    getVersion() {
        if (!this.loaded) throw new Error('Updater not loaded');
        return this._GetUpdaterVersion();
    }

    /**
     * Get the last error message
     * @returns {string|null}
     */
    getLastError() {
        if (!this.loaded) return null;
        const error = this._GetUpdaterLastError();
        return error || null;
    }
}

// Export singleton instance
module.exports = new MineCordUpdater();