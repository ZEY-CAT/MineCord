#pragma once

#ifdef _WIN32
    #ifdef MINE_CORD_UPDATER_EXPORTS
        #define UPDATER_API __declspec(dllexport)
    #else
        #define UPDATER_API __declspec(dllimport)
    #endif
    #define UPDATER_CALL __stdcall
#else
    #define UPDATER_API
    #define UPDATER_CALL
#endif

#include <cstdint>
#include <cstddef>

// C++ internal definitions (visible to implementation files)
// Must be in global namespace to match the C opaque typedef
#ifdef __cplusplus
#include <string>

struct UpdateInfo {
    std::wstring version;
    std::wstring downloadUrl;
    std::wstring sha256Hash;
    std::wstring minisigBase64;
    std::wstring releaseNotes;
    int critical = 0;
};

namespace MineCordUpdater {

using ::UpdateInfo;

} // namespace MineCordUpdater
#endif

#ifdef __cplusplus
extern "C" {
#endif

// Opaque handle for update info (C-compatible)
// The C++ struct UpdateInfo is defined above and compatible with this opaque type
typedef struct UpdateInfo UpdateInfo;

// Callback for download progress
// Return non-zero to cancel download
typedef int (UPDATER_CALL *ProgressCallback)(
    uint64_t downloaded,
    uint64_t total,
    void* userData
);

// Update information structure (C-compatible)
typedef struct {
    const wchar_t* version;
    const wchar_t* downloadUrl;
    const wchar_t* sha256Hash;
    const wchar_t* minisigBase64;
    const wchar_t* releaseNotes;
    int critical;
} UpdateInfoData;

// Error codes
typedef enum {
    UPDATER_OK = 0,
    UPDATER_ERROR_NETWORK = -1,
    UPDATER_ERROR_INVALID_RESPONSE = -2,
    UPDATER_ERROR_NO_UPDATE = -3,
    UPDATER_ERROR_DOWNLOAD_FAILED = -4,
    UPDATER_ERROR_VERIFY_FAILED = -5,
    UPDATER_ERROR_INSTALL_FAILED = -6,
    UPDATER_ERROR_INVALID_ARG = -7,
    UPDATER_ERROR_CANCELLED = -8,
    UPDATER_ERROR_FILE_LOCKED = -9,
    UPDATER_ERROR_PERMISSION_DENIED = -10,
    UPDATER_ERROR_INSUFFICIENT_SPACE = -11,
    UPDATER_ERROR_UNKNOWN = -100
} UpdaterErrorCode;

/**
 * Check for updates from the server.
 *
 * @param serverUrl Base URL of the update server (e.g., "https://api.example.com")
 * @param currentVersion Current version string (e.g., "1.0.2")
 * @param platform Target platform: "windows", "macos", "linux"
 * @param arch Target architecture: "x64", "arm64"
 * @param channel Update channel: "stable", "beta", "alpha"
 * @param outInfo Pointer to receive UpdateInfo pointer (caller must call FreeUpdateInfo)
 * @return 0 on success, negative error code on failure
 */
UPDATER_API int UPDATER_CALL CheckForUpdates(
    const wchar_t* serverUrl,
    const wchar_t* currentVersion,
    const wchar_t* platform,
    const wchar_t* arch,
    const wchar_t* channel,
    UpdateInfo** outInfo
);

/**
 * Download the update installer to a temporary file.
 *
 * @param downloadUrl URL to download from
 * @param destPath Destination file path (must have write access)
 * @param progressCb Progress callback (can be NULL)
 * @param userData User data passed to callback
 * @return 0 on success, negative error code on failure
 */
UPDATER_API int UPDATER_CALL DownloadUpdate(
    const wchar_t* downloadUrl,
    const wchar_t* destPath,
    int (UPDATER_CALL *progressCb)(uint64_t, uint64_t, void*),
    void* userData
);

/**
 * Install the update by replacing the application executable.
 *
 * This function:
 * 1. Verifies the installer signature and hash (MANDATORY)
 * 2. Backs up the current executable
 * 3. Runs the installer with appropriate arguments for silent update
 * 3. Handles elevation if needed (requests UAC)
 * 4. Verifies the update was applied
 * 5. On failure, restores the backup
 *
 * @param installerPath Path to the downloaded installer
 * @param installDir Target installation directory
 * @param signatureBase64 Base64-encoded Ed25519 signature of the installer (required)
 * @param expectedHash SHA-256 hash of the installer (required, hex or base64)
 * @return 0 on success, negative error code on failure
 */
UPDATER_API int UPDATER_CALL InstallUpdate(
    const wchar_t* installerPath,
    const wchar_t* installDir,
    const wchar_t* signatureBase64,
    const wchar_t* expectedHash
);

/**
 * Free the UpdateInfo structure returned by CheckForUpdates.
 * Must be called to avoid memory leaks.
 */
UPDATER_API void UPDATER_CALL FreeUpdateInfo(UpdateInfo* info);

/**
 * Get the last error message as a wide string.
 * The returned string is owned by the DLL and valid until the next API call.
 *
 * @return Wide string error message, or NULL if no error
 */
UPDATER_API const wchar_t* UPDATER_CALL GetUpdaterLastError();

/**
 * Get the updater DLL version.
 *
 * @return Version string (e.g., "1.0.0")
 */
UPDATER_API const wchar_t* UPDATER_CALL GetUpdaterVersion();

/**
 * Verify an Ed25519 signature of a file using the pinned public key.
 *
 * @param filePath Path to the file to verify
 * @param signatureBase64 Base64-encoded Ed25519 signature (64 bytes, raw r||s format)
 * @param publicKeyBase64 Base64-encoded public key (ignored, uses pinned key)
 * @return 0 on success (valid signature), negative error code on failure
 */
UPDATER_API int UPDATER_CALL VerifyMinisignSignature(
    const wchar_t* filePath,
    const wchar_t* signatureBase64,
    const wchar_t* publicKeyBase64
);

#ifdef __cplusplus
}
#endif