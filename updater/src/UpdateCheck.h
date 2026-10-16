#pragma once

#include "MineCordUpdater.h"

namespace MineCordUpdater {

int CheckForUpdatesImpl(
    const std::wstring& serverUrl,
    const std::wstring& currentVersion,
    const std::wstring& platform,
    const std::wstring& arch,
    const std::wstring& channel,
    UpdateInfo* info
);

} // namespace MineCordUpdater