#include "UpdateCheck.h"
#include "Utils.h"
#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace MineCordUpdater {

int CheckForUpdatesImpl(
    const std::wstring& serverUrl,
    const std::wstring& currentVersion,
    const std::wstring& platform,
    const std::wstring& arch,
    const std::wstring& channel,
    UpdateInfo* info
) {
    if (!info) return UPDATER_ERROR_INVALID_ARG;

    // Build the URL
    std::wstring url = serverUrl;
    if (!url.empty() && url.back() != L'/') url += L'/';
    url += L"api/updater/check?";
    url += L"platform=" + platform;
    url += L"&arch=" + arch;
    url += L"&channel=" + channel;

    // Convert to UTF-8 for WinHTTP
    std::string urlUtf8 = WideToUtf8(url);

    HINTERNET hSession = WinHttpOpen(L"MineCordUpdater/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) return UPDATER_ERROR_NETWORK;

    URL_COMPONENTS urlComp = {0};
    urlComp.dwStructSize = sizeof(urlComp);
    urlComp.dwSchemeLength = (DWORD)-1;
    urlComp.dwHostNameLength = (DWORD)-1;
    urlComp.dwUrlPathLength = (DWORD)-1;
    urlComp.dwExtraInfoLength = (DWORD)-1;

    std::wstring urlWide(url);
    if (!WinHttpCrackUrl(urlWide.c_str(), static_cast<DWORD>(urlWide.length()), ICU_DECODE, &urlComp)) {
        WinHttpCloseHandle(hSession);
        return UPDATER_ERROR_INVALID_RESPONSE;
    }

    std::wstring scheme(urlWide.substr(0, urlComp.nScheme));
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
        return UPDATER_ERROR_NETWORK;
    }

    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"GET", path.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, isSecure ? WINHTTP_FLAG_SECURE : 0);
    if (!hRequest) {
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return UPDATER_ERROR_NETWORK;
    }

    if (!WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0)) {
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return UPDATER_ERROR_NETWORK;
    }

    if (!WinHttpReceiveResponse(hRequest, nullptr)) {
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return UPDATER_ERROR_NETWORK;
    }

    DWORD statusCode = 0;
    DWORD statusSize = sizeof(DWORD);
    WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &statusSize, WINHTTP_HEADER_NAME_BY_INDEX);
    if (statusCode != 200) {
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return UPDATER_ERROR_INVALID_RESPONSE;
    }

    // Read response
    std::string response;
    DWORD bytesRead = 0;
    BYTE buffer[8192];
    while (WinHttpReadData(hRequest, buffer, sizeof(buffer), &bytesRead) && bytesRead > 0) {
        response.append(reinterpret_cast<char*>(buffer), bytesRead);
    }

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);

    // Parse JSON response
    try {
        json responseJson = json::parse(response.c_str());
        
        if (responseJson.contains("update") && responseJson["update"].is_object()) {
            json update = responseJson["update"];
            
            // Populate UpdateInfo
            UpdateInfo* info = new UpdateInfo();
            
            if (update.contains("version")) {
                std::string ver = update["version"].get<std::string>();
                info->version = Utf8ToWide(ver);
            }
            
            if (update.contains("url") || update.contains("downloadUrl")) {
                std::string url = update.value("url", "");
                if (url.empty()) {
                    url = update.value("downloadUrl", "");
                }
                if (!url.empty()) {
                    info->downloadUrl = Utf8ToWide(url);
                }
            }
            
            if (update.contains("notes")) {
                info->releaseNotes = Utf8ToWide(update["notes"].get<std::string>());
            }
            
            if (update.contains("critical")) {
                info->critical = update["critical"].get<int>();
            }
            
            // Store the signature (Ed25519 signature in base64)
            if (update.contains("signature")) {
                std::string sig = update["signature"].get<std::string>();
                if (!sig.empty()) {
                    info->minisigBase64 = Utf8ToWide(sig);
                }
            }
            
            // Store SHA-256 hash for verification
            if (update.contains("sha256Hash")) {
                std::string hash = update["sha256Hash"].get<std::string>();
                if (!hash.empty()) {
                    info->sha256Hash = Utf8ToWide(hash);
                }
            }
            
            return UPDATER_OK;
        } else {
            return UPDATER_ERROR_NO_UPDATE;
        }
    } catch (const std::exception&) {
        return UPDATER_ERROR_INVALID_RESPONSE;
    }

    return UPDATER_ERROR_NO_UPDATE;
}

} // namespace MineCordUpdater