#pragma once

#include <string>
#include <string_view>
#include <vector>
#include <optional>
#include <filesystem>
#include <functional>
#include <mutex>
#include <windows.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <versionhelpers.h>
#include <sstream>
#include <iomanip>
#include <fstream>
#include <memory>

namespace fs = std::filesystem;

namespace MineCordUpdater {

// Convert UTF-8 to wide string
inline std::wstring Utf8ToWide(const std::string& utf8) {
    if (utf8.empty()) return L"";
    int size = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, nullptr, 0);
    std::wstring result(size, 0);
    MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, &result[0], size);
    if (!result.empty() && result.back() == L'\0') result.pop_back();
    return result;
}

// Convert wide to UTF-8
inline std::string WideToUtf8(const std::wstring& wide) {
    if (wide.empty()) return "";
    int size = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string result(size, 0);
    WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), -1, &result[0], size, nullptr, nullptr);
    if (!result.empty() && result.back() == '\0') result.pop_back();
    return result;
}

// Convert wchar_t* to std::wstring
inline std::wstring WStrToWString(const wchar_t* str) {
    return str ? std::wstring(str) : L"";
}

// Compute SHA-256 hash of a file
std::optional<std::string> ComputeFileSHA256(const std::wstring& filePath);

// Compute SHA-256 hash of data
std::string ComputeSHA256(const void* data, size_t size);

// Base64 decode helper
std::vector<uint8_t> Base64Decode(const std::string& input);

// Download file with progress callback
using ProgressCallback = std::function<bool(uint64_t downloaded, uint64_t total)>;

bool DownloadFile(
    const std::wstring& url,
    const std::wstring& destPath,
    const std::function<bool(uint64_t, uint64_t)>& progressCb = nullptr
);

// Verify file hash
bool VerifyFileHash(const std::wstring& filePath, const std::wstring& expectedHash);

// Backup a file (returns backup path)
std::optional<std::wstring> BackupFile(const std::wstring& filePath);

// Restore a file from backup
bool RestoreFile(const std::wstring& backupPath, const std::wstring& targetPath);

// Check if file is locked
bool IsFileLocked(const std::wstring& filePath);

// Get installation directory
std::wstring GetInstallDirectory();

// Get temporary directory for downloads
std::wstring GetTempDownloadDir();

// Check if running as admin
bool IsRunningAsAdmin();

// Request elevation and run command
bool RunElevated(const std::wstring& exePath, const std::wstring& args);

// Get installation directory from registry or default
std::wstring GetInstallDirectoryFromRegistry();

// Check if running in Program Files
bool IsInProgramFiles(const std::wstring& path);

// Get available disk space
bool HasSufficientSpace(const std::wstring& path, uint64_t requiredBytes);

// Format bytes for display
std::wstring FormatBytes(uint64_t bytes);

// Execute command and wait
bool ExecuteCommand(const std::wstring& command, const std::wstring& args, int& exitCode);

// Set last error for the updater (avoid conflict with Windows SetLastError)
void SetUpdaterLastError(const std::wstring& error);

// Get last error for the updater
const std::wstring& GetUpdaterLastError();

} // namespace MineCordUpdater