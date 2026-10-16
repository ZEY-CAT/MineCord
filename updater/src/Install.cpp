#include "Install.h"
#include "Utils.h"
#include "Verify.h"
#include <shlobj.h>
#include <shellapi.h>

namespace MineCordUpdater {

int InstallUpdateImpl(
    const std::wstring& installerPath,
    const std::wstring& installDir,
    const std::wstring& signatureBase64,
    const std::wstring& expectedHash
) {
    // Validate inputs
    if (!fs::exists(installerPath)) {
        SetUpdaterLastError(L"Installer file not found");
        return UPDATER_ERROR_INVALID_ARG;
    }
    
    if (!fs::exists(installDir)) {
        SetUpdaterLastError(L"Install directory not found");
        return UPDATER_ERROR_INVALID_ARG;
    }

    if (signatureBase64.empty()) {
        SetUpdaterLastError(L"Missing signature for installer verification");
        return UPDATER_ERROR_VERIFY_FAILED;
    }

    if (expectedHash.empty()) {
        SetUpdaterLastError(L"Missing SHA-256 hash for installer verification");
        return UPDATER_ERROR_VERIFY_FAILED;
    }

    // 1. CRYPTOGRAPHIC VERIFICATION - Must pass before any installation
    // Verify SHA-256 hash of the installer
    if (!VerifyFileHash(installerPath, expectedHash)) {
        SetUpdaterLastError(L"Installer hash verification failed");
        return UPDATER_ERROR_VERIFY_FAILED;
    }

    // Verify Ed25519 signature of the installer
    if (!VerifyMinisignSignature(installerPath, signatureBase64, L"")) {
        SetUpdaterLastError(L"Installer signature verification failed");
        return UPDATER_ERROR_VERIFY_FAILED;
    }

    // 2. Find the application executable to update
    std::wstring exePath = FindApplicationExe(installDir);
    if (exePath.empty()) {
        SetUpdaterLastError(L"Application executable not found in install directory");
        return UPDATER_ERROR_INSTALL_FAILED;
    }

    // 3. Check if file is locked
    if (IsFileLocked(exePath)) {
        SetUpdaterLastError(L"Application is running. Please close MineCord before updating.");
        return UPDATER_ERROR_FILE_LOCKED;
    }

    // 4. Check if we need elevation
    bool needsElevation = IsInProgramFiles(exePath) && !IsRunningAsAdmin();
    
    // 5. Backup the current executable
    std::optional<std::wstring> backupPath = BackupFile(exePath);
    if (!backupPath) {
        SetUpdaterLastError(L"Failed to backup current executable");
        return UPDATER_ERROR_INSTALL_FAILED;
    }

    bool success = false;
    
    try {
        // If we need elevation, run the installer with elevation
        if (needsElevation) {
            std::wstring args = L"/S /D=" + exePath;
            if (!RunElevated(installerPath, args)) {
                // Restore backup on failure
                RestoreFile(*backupPath, exePath);
                SetUpdaterLastError(L"Elevation required but failed or cancelled");
                return UPDATER_ERROR_PERMISSION_DENIED;
            }
        } else {
            // Run installer silently
            std::wstring args = L"/S /D=" + exePath;
            int exitCode = 0;
            if (!ExecuteCommand(installerPath, args, exitCode) || exitCode != 0) {
                // Restore backup on failure
                RestoreFile(*backupPath, exePath);
                SetUpdaterLastError(L"Installer failed with exit code");
                return UPDATER_ERROR_INSTALL_FAILED;
            }
        }

        // 6. Verify the update was applied
        if (!VerifyInstallation(exePath)) {
            // Restore backup
            RestoreFile(*backupPath, exePath);
            SetUpdaterLastError(L"Update verification failed");
            return UPDATER_ERROR_INSTALL_FAILED;
        }

        success = true;
    } catch (const std::exception& e) {
        SetUpdaterLastError(std::wstring(L"Exception during install: ") + Utf8ToWide(e.what()));
        return UPDATER_ERROR_INSTALL_FAILED;
    }

    if (success) {
        // Clean up backup
        std::wstring backupPath = exePath + L".bak";
        DeleteFileW(backupPath.c_str());
        return UPDATER_OK;
    }

    return UPDATER_ERROR_INSTALL_FAILED;
}

std::wstring FindApplicationExe(const std::wstring& installDir) {
    // Look for MineCord.exe in the install directory
    for (const auto& entry : fs::directory_iterator(installDir)) {
        if (entry.is_regular_file()) {
            std::wstring filename = entry.path().filename().wstring();
            if (filename == L"MINECORD.exe" || filename == L"MineCord.exe" || 
                filename == L"minecord.exe") {
                return entry.path().wstring();
            }
        }
    }
    return L"";
}

bool VerifyInstallation(const std::wstring& exePath) {
    if (!fs::exists(exePath)) return false;
    
    // Check file size is reasonable
    auto fileSize = fs::file_size(exePath);
    if (fileSize < 1024 * 1024) { // Less than 1MB is suspicious
        return false;
    }
    
    // Try to read the PE header to verify it's a valid executable
    std::ifstream file(exePath, std::ios::binary);
    if (!file) return false;
    
    char dosHeader[2];
    file.read(dosHeader, 2);
    if (dosHeader[0] != 'M' || dosHeader[1] != 'Z') {
        return false; // Not a valid PE file
    }
    
    return true;
}

bool VerifyInstaller(
    const std::wstring& installerPath,
    const std::wstring& signatureBase64,
    const std::wstring& expectedHash
) {
    // Verify SHA-256 hash
    if (!VerifyFileHash(installerPath, expectedHash)) {
        return false;
    }
    
    // Verify Ed25519 signature
    if (!VerifyMinisignSignature(installerPath, signatureBase64, L"")) {
        return false;
    }
    
    return true;
}

} // namespace MineCordUpdater