#include "Verify.h"
#include "Utils.h"
#include <bcrypt.h>
#include <fstream>
#include <vector>
#include <string>
#include <filesystem>

#pragma comment(lib, "bcrypt.lib")

// BCRYPT_ED25519_ALGORITHM may not be defined in older Windows SDKs
#ifndef BCRYPT_ED25519_ALGORITHM
#define BCRYPT_ED25519_ALGORITHM L"ED25519"
#endif

namespace fs = std::filesystem;

namespace MineCordUpdater {

// Production minisign public key (base64 encoded, 32-byte Ed25519 public key)
// Generated with: node -e "const crypto = require('crypto'); const { publicKey } = crypto.generateKeyPairSync('ed25519', { publicKeyEncoding: { format: 'pem', type: 'spki' } }); const jwk = crypto.createPublicKey({ key: publicKey, format: 'pem', type: 'spki' }).export({ format: 'jwk' }); console.log(jwk.x.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - jwk.x.length % 4) % 4));"
// REPLACE THIS WITH ACTUAL PRODUCTION PUBLIC KEY DURING DEPLOYMENT
// Current value is a TEST KEY PLACEHOLDER - NOT FOR PRODUCTION USE
static const std::string PINNED_MINISIGN_PUBLIC_KEY_BASE64 = 
    "9fbByVDf7DgyNEmzLzECdJLiG+/lQyZQ1FD8INpt7M4=";

bool VerifyEd25519Signature(
    const std::vector<uint8_t>& message,
    const std::vector<uint8_t>& signature,
    const std::vector<uint8_t>& publicKey
) {
    if (publicKey.size() != ED25519_PUBLIC_KEY_SIZE || signature.size() != ED25519_SIGNATURE_SIZE) {
        return false;
    }

    BCRYPT_ALG_HANDLE hAlg = nullptr;
    if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_ED25519_ALGORITHM, nullptr, 0) != 0) {
        return false;
    }

    BCRYPT_KEY_HANDLE hKey = nullptr;
    if (BCryptImportKeyPair(hAlg, nullptr, BCRYPT_PUBLIC_KEY_BLOB, &hKey, 
                            const_cast<PUCHAR>(publicKey.data()), ED25519_PUBLIC_KEY_SIZE, 0) != 0) {
        BCryptCloseAlgorithmProvider(hAlg, 0);
        return false;
    }

    bool result = false;
    if (BCryptVerifySignature(hKey, nullptr, const_cast<PUCHAR>(message.data()), static_cast<ULONG>(message.size()),
                              const_cast<PUCHAR>(signature.data()), ED25519_SIGNATURE_SIZE, 0) == 0) {
        result = true;
    }

    BCryptDestroyKey(hKey);
    BCryptCloseAlgorithmProvider(hAlg, 0);
    return result;
}

bool VerifyMinisignSignature(
    const std::wstring& filePath,
    const std::wstring& signatureBase64,
    const std::wstring& publicKeyBase64
) {
    // Use pinned public key instead of server-provided key
    std::vector<uint8_t> publicKey = Base64Decode(PINNED_MINISIGN_PUBLIC_KEY_BASE64);
    if (publicKey.size() != ED25519_PUBLIC_KEY_SIZE) {
        return false;
    }

    // Decode base64 signature
    std::string sigUtf8 = WideToUtf8(signatureBase64);
    std::vector<uint8_t> signature = Base64Decode(sigUtf8);
    if (signature.size() != ED25519_SIGNATURE_SIZE) {
        return false;
    }

    // Read file content
    HANDLE hFile = CreateFileW(filePath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
    if (hFile == INVALID_HANDLE_VALUE) return false;
    
    LARGE_INTEGER fileSize;
    if (!GetFileSizeEx(hFile, &fileSize)) {
        CloseHandle(hFile);
        return false;
    }
    
    if (fileSize.QuadPart > SIZE_MAX) {
        CloseHandle(hFile);
        return false;
    }
    
    std::vector<uint8_t> fileData(static_cast<size_t>(fileSize.QuadPart));
    DWORD bytesRead = 0;
    if (!ReadFile(hFile, fileData.data(), static_cast<DWORD>(fileData.size()), &bytesRead, nullptr) || bytesRead != fileData.size()) {
        CloseHandle(hFile);
        return false;
    }
    CloseHandle(hFile);
    
    // Verify signature using Ed25519
    return VerifyEd25519Signature(fileData, signature, publicKey);
}

} // namespace MineCordUpdater