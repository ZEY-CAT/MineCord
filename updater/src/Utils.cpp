#include "Utils.h"
#include <vector>
#include <sstream>
#include <iostream>
#include <bcrypt.h>
#include <winhttp.h>
#include <shellapi.h>
#include <versionhelpers.h>
#include <shlobj.h>

#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "version.lib")

namespace MineCordUpdater {

// Global error message for the updater (avoid conflict with Windows SetLastError)
static std::wstring g_updaterLastError;
static std::mutex g_updaterErrorMutex;

void SetUpdaterLastError(const std::wstring& error) {
    std::lock_guard<std::mutex> lock(g_updaterErrorMutex);
    g_updaterLastError = error;
}

const std::wstring& GetUpdaterLastError() {
    std::lock_guard<std::mutex> lock(g_updaterErrorMutex);
    return g_updaterLastError;
}

std::optional<std::string> ComputeFileSHA256(const std::wstring& filePath) {
    HANDLE hFile = CreateFileW(filePath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
    if (hFile == INVALID_HANDLE_VALUE) {
        return std::nullopt;
    }

    BCRYPT_ALG_HANDLE hAlg = nullptr;
    if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) {
        CloseHandle(hFile);
        return std::nullopt;
    }

    BCRYPT_HASH_HANDLE hHash = nullptr;
    if (BCryptCreateHash(hAlg, &hHash, nullptr, 0, nullptr, 0, 0) != 0) {
        BCryptCloseAlgorithmProvider(hAlg, 0);
        CloseHandle(hFile);
        return std::nullopt;
    }

    constexpr size_t BUFFER_SIZE = 64 * 1024;
    std::vector<BYTE> buffer(BUFFER_SIZE);
    DWORD bytesRead = 0;
    BOOL readResult = FALSE;

    while ((readResult = ReadFile(hFile, buffer.data(), static_cast<DWORD>(buffer.size()), &bytesRead, nullptr)) && bytesRead > 0) {
        if (BCryptHashData(hHash, buffer.data(), static_cast<ULONG>(bytesRead), 0) != 0) {
            break;
        }
    }

    std::string hashResult;
    if (readResult) {
        DWORD hashSize = 0;
        DWORD cbData = 0;
        if (BCryptGetProperty(hHash, BCRYPT_HASH_LENGTH, (PUCHAR)&hashSize, sizeof(DWORD), &cbData, 0) == 0) {
            std::vector<BYTE> hash(hashSize);
            if (BCryptFinishHash(hHash, hash.data(), hashSize, 0) == 0) {
                std::ostringstream oss;
                for (BYTE b : hash) {
                    oss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(b);
                }
                CloseHandle(hFile);
                BCryptDestroyHash(hHash);
                BCryptCloseAlgorithmProvider(hAlg, 0);
                return oss.str();
            }
        }
    }

    if (hHash) BCryptDestroyHash(hHash);
    if (hAlg) BCryptCloseAlgorithmProvider(hAlg, 0);
    CloseHandle(hFile);
    return std::nullopt;
}

std::string ComputeSHA256(const void* data, size_t size) {
    BCRYPT_ALG_HANDLE hAlg = nullptr;
    if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) {
        return "";
    }

    BCRYPT_HASH_HANDLE hHash = nullptr;
    if (BCryptCreateHash(hAlg, &hHash, nullptr, 0, nullptr, 0, 0) != 0) {
        BCryptCloseAlgorithmProvider(hAlg, 0);
        return "";
    }

    std::string result;
    if (BCryptHashData(hHash, static_cast<PUCHAR>(const_cast<void*>(data)), static_cast<ULONG>(size), 0) == 0) {
        DWORD hashSize = 0;
        DWORD cbData = 0;
        if (BCryptGetProperty(hHash, BCRYPT_HASH_LENGTH, (PUCHAR)&hashSize, sizeof(DWORD), &cbData, 0) == 0) {
            std::vector<BYTE> hash(hashSize);
            if (BCryptFinishHash(hHash, hash.data(), hashSize, 0) == 0) {
                std::ostringstream oss;
                for (BYTE b : hash) {
                    oss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(b);
                }
                result = oss.str();
            }
        }
    }

    BCryptDestroyHash(hHash);
    BCryptCloseAlgorithmProvider(hAlg, 0);
    return result;
}

bool DownloadFile(
    const std::wstring& url,
    const std::wstring& destPath,
    const std::function<bool(uint64_t, uint64_t)>& progressCb
) {
    HINTERNET hSession = WinHttpOpen(L"MineCordUpdater/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) return false;

    URL_COMPONENTS urlComp = {0};
    urlComp.dwStructSize = sizeof(urlComp);
    urlComp.dwSchemeLength = (DWORD)-1;
    urlComp.dwHostNameLength = (DWORD)-1;
    urlComp.dwUrlPathLength = (DWORD)-1;
    urlComp.dwExtraInfoLength = (DWORD)-1;

    std::wstring urlStr(url);
    if (!WinHttpCrackUrl(urlStr.c_str(), static_cast<DWORD>(urlStr.length()), ICU_DECODE, &urlComp)) {
        WinHttpCloseHandle(hSession);
        return false;
    }

    std::wstring scheme(urlStr.substr(0, urlComp.nScheme));
    std::wstring host(urlComp.lpszHostName, urlComp.dwHostNameLength);
    std::wstring path(urlComp.lpszUrlPath, urlComp.dwUrlPathLength);
    if (urlComp.dwExtraInfoLength > 0) {
        path += std::wstring(urlComp.lpszExtraInfo, urlComp.dwExtraInfoLength);
    }

    INTERNET_PORT port = urlComp.nPort;
    BOOL isSecure = (scheme == L"https");

    HINTERNET hConnect = WinHttpConnect(hSession, host.c_str(), port, 0);
    if (!hConnect) {
        WinHttpCloseHandle(hSession);
        return false;
    }

    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"GET", path.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, isSecure ? WINHTTP_FLAG_SECURE : 0);
    if (!hRequest) {
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    if (!WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0)) {
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    if (!WinHttpReceiveResponse(hRequest, nullptr)) {
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    DWORD statusCode = 0;
    DWORD statusSize = sizeof(DWORD);
    WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &statusSize, WINHTTP_NO_HEADER_INDEX);
    if (statusCode != 200) {
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    HANDLE hFile = CreateFileW(destPath.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (hFile == INVALID_HANDLE_VALUE) {
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    DWORD totalSize = 0;
    DWORD contentLength = 0;
    DWORD clSize = sizeof(DWORD);
    WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &contentLength, &clSize, WINHTTP_HEADER_NAME_BY_INDEX);

    DWORD downloaded = 0;
    BYTE buffer[8192];
    DWORD bytesRead = 0;
    BOOL readResult = TRUE;

    while (readResult && (readResult = WinHttpReadData(hRequest, buffer, sizeof(buffer), &bytesRead)) && bytesRead > 0) {
        DWORD written = 0;
        if (!WriteFile(hFile, buffer, bytesRead, &written, nullptr) || written != bytesRead) {
            readResult = FALSE;
            break;
        }
        downloaded += written;

        if (progressCb) {
            uint64_t total = contentLength > 0 ? contentLength : 0;
            if (!progressCb(downloaded, total)) {
                readResult = FALSE;
                break;
            }
        }
    }

    CloseHandle(hFile);
    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);

    return readResult == TRUE;
}

bool VerifyFileHash(const std::wstring& filePath, const std::wstring& expectedHash) {
    auto actualHash = ComputeFileSHA256(filePath);
    if (!actualHash) return false;
    return WideToUtf8(expectedHash) == *actualHash;
}

std::optional<std::wstring> BackupFile(const std::wstring& filePath) {
    std::wstring backupPath = filePath + L".bak";
    int counter = 1;
    while (GetFileAttributesW(backupPath.c_str()) != INVALID_FILE_ATTRIBUTES) {
        backupPath = filePath + L".bak." + std::to_wstring(counter++);
    }

    if (CopyFileW(filePath.c_str(), backupPath.c_str(), FALSE)) {
        return backupPath;
    }
    return std::nullopt;
}

bool RestoreFile(const std::wstring& backupPath, const std::wstring& targetPath) {
    if (!DeleteFileW(targetPath.c_str())) {
        DWORD err = GetLastError();
        if (err != ERROR_FILE_NOT_FOUND) return false;
    }
    return CopyFileW(backupPath.c_str(), targetPath.c_str(), FALSE);
}

bool IsFileLocked(const std::wstring& filePath) {
    HANDLE hFile = CreateFileW(
        filePath.c_str(),
        GENERIC_READ | GENERIC_WRITE,
        0,  // No sharing
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr
    );

    if (hFile == INVALID_HANDLE_VALUE) {
        DWORD err = GetLastError();
        return err == ERROR_SHARING_VIOLATION || err == ERROR_LOCK_VIOLATION;
    }
    CloseHandle(hFile);
    return false;
}

std::wstring GetInstallDirectory() {
    wchar_t path[MAX_PATH];
    if (GetModuleFileNameW(nullptr, path, MAX_PATH)) {
        PathRemoveFileSpecW(path);
        return std::wstring(path);
    }
    return L"";
}

std::wstring GetTempDownloadDir() {
    wchar_t tempPath[MAX_PATH];
    if (GetTempPathW(MAX_PATH, tempPath)) {
        std::wstring dir = tempPath;
        dir += L"MineCordUpdater\\";
        CreateDirectoryW(dir.c_str(), nullptr);
        return dir;
    }
    return L"";
}

bool IsRunningAsAdmin() {
    BOOL isAdmin = FALSE;
    HANDLE hToken = nullptr;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken)) {
        TOKEN_ELEVATION elevation;
        DWORD size = 0;
        if (GetTokenInformation(hToken, TokenElevation, &elevation, sizeof(elevation), &size)) {
            isAdmin = elevation.TokenIsElevated;
        }
        CloseHandle(hToken);
    }
    return isAdmin != FALSE;
}

bool RunElevated(const std::wstring& exePath, const std::wstring& args) {
    SHELLEXECUTEINFOW sei = {0};
    sei.cbSize = sizeof(sei);
    sei.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI;
    sei.lpVerb = L"runas";
    sei.lpFile = exePath.c_str();
    sei.lpParameters = args.c_str();
    sei.nShow = SW_SHOW;

    if (!ShellExecuteExW(&sei)) {
        return false;
    }

    WaitForSingleObject(sei.hProcess, INFINITE);
    DWORD exitCode = 0;
    GetExitCodeProcess(sei.hProcess, &exitCode);
    CloseHandle(sei.hProcess);
    return exitCode == 0;
}

std::wstring GetInstallDirectoryFromRegistry() {
    HKEY hKey;
    if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MineCord", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        wchar_t value[1024];
        DWORD size = sizeof(value);
        if (RegQueryValueExW(hKey, L"InstallLocation", nullptr, nullptr, (LPBYTE)value, &size) == ERROR_SUCCESS) {
            RegCloseKey(hKey);
            return std::wstring(value);
        }
        RegCloseKey(hKey);
    }
    return L"";
}

bool IsInProgramFiles(const std::wstring& path) {
    wchar_t programFiles[MAX_PATH];
    if (SHGetFolderPathW(nullptr, CSIDL_PROGRAM_FILES, nullptr, 0, programFiles) == S_OK) {
        std::wstring pf(path);
        std::wstring pfPath(programFiles);
        return _wcsnicmp(pf.c_str(), pfPath.c_str(), pfPath.length()) == 0;
    }
    return false;
}

bool HasSufficientSpace(const std::wstring& path, uint64_t requiredBytes) {
    ULARGE_INTEGER freeBytes;
    if (GetDiskFreeSpaceExW(path.c_str(), &freeBytes, nullptr, nullptr)) {
        return freeBytes.QuadPart >= requiredBytes;
    }
    return false;
}

std::wstring FormatBytes(uint64_t bytes) {
    const wchar_t* units[] = {L"B", L"KB", L"MB", L"GB"};
    int unit = 0;
    double size = static_cast<double>(bytes);
    while (size >= 1024.0 && unit < 3) {
        size /= 1024.0;
        unit++;
    }
    std::wostringstream oss;
    oss << std::fixed << std::setprecision(1) << size << L" " << units[unit];
    return oss.str();
}

// Base64 decode helper
std::vector<uint8_t> Base64Decode(const std::string& input) {
    static const char decodeTable[] = {
        62, -1, -1, -1, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, -1, -1, -1, -1,
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, -1, -1, -1, -1, -1, -1,
        26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, -1, -1, -1, -1, -1,
        26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, -1, -1, -1, -1, -1
    };

    std::vector<uint8_t> output;
    size_t len = input.length();
    size_t i = 0;
    
    while (i < len) {
        // Skip whitespace
        while (i < len && isspace(input[i])) i++;
        if (i >= len) break;
        
        uint32_t sextet[4] = {0, 0, 0, 0};
        int count = 0;
        for (; i < len && count < 4; i++) {
            char c = input[i];
            if (c == '=') break;
            if ((unsigned char)c < 128 && decodeTable[(unsigned char)c] != -1) {
                sextet[count++] = decodeTable[(unsigned char)c];
            }
        }
        if (count < 2) break;
        
        output.push_back(static_cast<uint8_t>((sextet[0] << 2) | (sextet[1] >> 4)));
        if (count > 2) output.push_back(static_cast<uint8_t>(((sextet[1] & 0x0F) << 4) | (sextet[2] >> 2)));
        if (count > 3) output.push_back(static_cast<uint8_t>(((sextet[2] & 0x0F) << 4) | sextet[3]));
    }
    return output;
}

bool ExecuteCommand(const std::wstring& command, const std::wstring& args, int& exitCode) {
    SHELLEXECUTEINFOW sei = {0};
    sei.cbSize = sizeof(sei);
    sei.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI;
    sei.lpVerb = L"open";
    sei.lpFile = command.c_str();
    sei.lpParameters = args.c_str();
    sei.nShow = SW_HIDE;

    if (!ShellExecuteExW(&sei)) {
        return false;
    }

    WaitForSingleObject(sei.hProcess, INFINITE);
    DWORD code = 0;
    GetExitCodeProcess(sei.hProcess, &code);
    CloseHandle(sei.hProcess);
    exitCode = static_cast<int>(code);
    return true;
}

} // namespace MineCordUpdater