#pragma once

#include "MineCordUpdater.h"

namespace MineCordUpdater {

int InstallUpdateImpl(
    const std::wstring& installerPath,
    const std::wstring& installDir,
    const std::wstring& signatureBase64,
    const std::wstring& expectedHash
);

std::wstring FindApplicationExe(const std::wstring& installDir);

bool VerifyInstallation(const std::wstring& exePath);

bool VerifyInstaller(
    const std::wstring& installerPath,
    const std::wstring& signatureBase64,
    const std::wstring& expectedHash
);

} // namespace MineCordUpdater