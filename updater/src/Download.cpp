#include "Download.h"
#include "Utils.h"

namespace MineCordUpdater {

int DownloadUpdateImpl(
    const std::wstring& downloadUrl,
    const std::wstring& destPath,
    int (UPDATER_CALL *progressCb)(uint64_t, uint64_t, void*),
    void* userData
) {
    if (downloadUrl.empty() || destPath.empty()) {
        return UPDATER_ERROR_INVALID_ARG;
    }

    // Ensure destination directory exists
    fs::path destFs(destPath);
    fs::create_directories(destFs.parent_path());

    // Download the file - wrap the C callback in a std::function
    auto progressCbWrapper = [progressCb, userData](uint64_t downloaded, uint64_t total) -> bool {
        if (progressCb) {
            return progressCb(downloaded, total, userData) != 0;
        }
        return true;
    };

    bool success = DownloadFile(downloadUrl, destPath, progressCbWrapper);
    if (!success) {
        return UPDATER_ERROR_DOWNLOAD_FAILED;
    }

    return UPDATER_OK;
}

} // namespace MineCordUpdater