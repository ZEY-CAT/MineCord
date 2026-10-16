#include "MineCordUpdater.h"
#include "Internal.h"
#include "Utils.h"
#include "UpdateCheck.h"
#include "Download.h"
#include "Install.h"
#include "Verify.h"

#include <string>

extern "C" {

using namespace MineCordUpdater;

UPDATER_API int UPDATER_CALL CheckForUpdates(
    const wchar_t* serverUrl,
    const wchar_t* currentVersion,
    const wchar_t* platform,
    const wchar_t* arch,
    const wchar_t* channel,
    UpdateInfo** outInfo
) {
    if (!serverUrl || !currentVersion || !platform || !arch || !channel || !outInfo) {
        SetUpdaterLastError(L"Invalid arguments: null pointer");
        return UPDATER_ERROR_INVALID_ARG;
    }

    *outInfo = nullptr;

    try {
        std::wstring serverUrlStr(serverUrl);
        std::wstring currentVersionStr(currentVersion);
        std::wstring platformStr(platform);
        std::wstring archStr(arch);
        std::wstring channelStr(channel);

        // Validate platform
        if (platformStr != L"windows" && platformStr != L"macos" && platformStr != L"linux") {
            SetUpdaterLastError(L"Invalid platform: must be windows, macos, or linux");
            return UPDATER_ERROR_INVALID_ARG;
        }

        // Validate architecture
        if (archStr != L"x64" && archStr != L"arm64") {
            SetUpdaterLastError(L"Invalid architecture: must be x64 or arm64");
            return UPDATER_ERROR_INVALID_ARG;
        }

        // Validate channel
        if (channelStr != L"stable" && channelStr != L"beta" && channelStr != L"alpha") {
            SetUpdaterLastError(L"Invalid channel: must be stable, beta, or alpha");
            return UPDATER_ERROR_INVALID_ARG;
        }

        // Call the update check implementation
        UpdateInfo* info = new UpdateInfo();
        int result = CheckForUpdatesImpl(
            serverUrlStr, currentVersionStr, platformStr, archStr, channelStr, info
        );

        if (result != UPDATER_OK) {
            delete info;
            return result;
        }

        *outInfo = info;
        return UPDATER_OK;
    } catch (const std::exception& e) {
        SetUpdaterLastError(std::wstring(L"Exception: ") + Utf8ToWide(e.what()));
        return UPDATER_ERROR_UNKNOWN;
    } catch (...) {
        SetUpdaterLastError(L"Unknown exception");
        return UPDATER_ERROR_UNKNOWN;
    }
}

UPDATER_API int UPDATER_CALL DownloadUpdate(
    const wchar_t* downloadUrl,
    const wchar_t* destPath,
    int (UPDATER_CALL *progressCb)(uint64_t, uint64_t, void*),
    void* userData
) {
    if (!downloadUrl || !destPath) {
        SetUpdaterLastError(L"Invalid arguments: null pointer");
        return UPDATER_ERROR_INVALID_ARG;
    }

    try {
        std::wstring urlStr(downloadUrl);
        std::wstring destStr(destPath);

        int result = DownloadUpdateImpl(urlStr, destStr, progressCb, userData);
        return result;
    } catch (const std::exception& e) {
        SetUpdaterLastError(std::wstring(L"Exception: ") + Utf8ToWide(e.what()));
        return UPDATER_ERROR_UNKNOWN;
    } catch (...) {
        SetUpdaterLastError(L"Unknown exception");
        return UPDATER_ERROR_UNKNOWN;
    }
}

UPDATER_API int UPDATER_CALL InstallUpdate(
    const wchar_t* installerPath,
    const wchar_t* installDir,
    const wchar_t* signatureBase64,
    const wchar_t* expectedHash
) {
    if (!installerPath || !installDir) {
        SetUpdaterLastError(L"Invalid arguments: null pointer");
        return UPDATER_ERROR_INVALID_ARG;
    }

    if (!signatureBase64 || !expectedHash) {
        SetUpdaterLastError(L"Missing signature or hash for verification");
        return UPDATER_ERROR_VERIFY_FAILED;
    }

    try {
        std::wstring installerStr(installerPath);
        std::wstring dirStr(installDir);
        std::wstring sigStr(signatureBase64);
        std::wstring hashStr(expectedHash);

        int result = InstallUpdateImpl(installerStr, dirStr, sigStr, hashStr);
        return result;
    } catch (const std::exception& e) {
        SetUpdaterLastError(std::wstring(L"Exception: ") + Utf8ToWide(e.what()));
        return UPDATER_ERROR_UNKNOWN;
    } catch (...) {
        SetUpdaterLastError(L"Unknown exception");
        return UPDATER_ERROR_UNKNOWN;
    }
}

UPDATER_API void UPDATER_CALL FreeUpdateInfo(UpdateInfo* info) {
    if (info) {
        delete info;
    }
}

UPDATER_API const wchar_t* UPDATER_CALL GetUpdaterLastError() {
    const std::wstring& err = MineCordUpdater::GetUpdaterLastError();
    return err.empty() ? nullptr : err.c_str();
}

UPDATER_API const wchar_t* UPDATER_CALL GetUpdaterVersion() {
    static const wchar_t* version = L"1.0.0";
    return version;
}

UPDATER_API int UPDATER_CALL VerifyMinisignSignature(
    const wchar_t* filePath,
    const wchar_t* signatureBase64,
    const wchar_t* publicKeyBase64
) {
    if (!filePath || !signatureBase64) {
        SetUpdaterLastError(L"Invalid arguments: null pointer");
        return UPDATER_ERROR_INVALID_ARG;
    }

    try {
        std::wstring filePathStr(filePath);
        std::wstring sigStr(signatureBase64);
        
        bool result = MineCordUpdater::VerifyMinisignSignature(filePathStr, sigStr, publicKeyBase64 ? publicKeyBase64 : L"");
        return result ? UPDATER_OK : UPDATER_ERROR_VERIFY_FAILED;
    } catch (const std::exception& e) {
        SetUpdaterLastError(std::wstring(L"Exception: ") + Utf8ToWide(e.what()));
        return UPDATER_ERROR_UNKNOWN;
    } catch (...) {
        SetUpdaterLastError(L"Unknown exception");
        return UPDATER_ERROR_UNKNOWN;
    }
}

} // extern "C"