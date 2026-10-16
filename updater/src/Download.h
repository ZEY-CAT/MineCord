#pragma once

#include "MineCordUpdater.h"

namespace MineCordUpdater {

int DownloadUpdateImpl(
    const std::wstring& downloadUrl,
    const std::wstring& destPath,
    int (UPDATER_CALL *progressCb)(uint64_t, uint64_t, void*),
    void* userData
);

} // namespace MineCordUpdater