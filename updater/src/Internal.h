#pragma once

#include "MineCordUpdater.h"
#include "Utils.h"

namespace MineCordUpdater {

// Internal implementation functions
int CheckForUpdatesImpl(
    const std::wstring& serverUrl,
    const std::wstring& currentVersion,
    const std::wstring& platform,
    const std::wstring& arch,
    const std::wstring& channel,
    UpdateInfo* info
);

int DownloadUpdateImpl(
    const std::wstring& downloadUrl,
    const std::wstring& destPath,
    int (UPDATER_CALL *progressCb)(uint64_t, uint64_t, void*),
    void* userData
);

int InstallUpdateImpl(
    const std::wstring& installerPath,
    const std::wstring& installDir,
    const std::wstring& signatureBase64,
    const std::wstring& expectedHash
);

} // namespace MineCordUpdater