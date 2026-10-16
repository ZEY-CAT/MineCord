#pragma once

#include "MineCordUpdater.h"
#include <vector>
#include <string>

namespace MineCordUpdater {

// Ed25519 constants
constexpr size_t ED25519_PUBLIC_KEY_SIZE = 32;
constexpr size_t ED25519_SIGNATURE_SIZE = 64;

bool VerifyEd25519Signature(
    const std::vector<uint8_t>& message,
    const std::vector<uint8_t>& signature,
    const std::vector<uint8_t>& publicKey
);

bool VerifyMinisignSignature(
    const std::wstring& filePath,
    const std::wstring& signatureBase64,
    const std::wstring& publicKeyBase64
);

bool VerifyFileHash(const std::wstring& filePath, const std::wstring& expectedHash);

bool VerifyInstaller(
    const std::wstring& installerPath,
    const std::wstring& signatureBase64,
    const std::wstring& expectedHash
);

std::wstring FindApplicationExe(const std::wstring& installDir);

bool VerifyInstallation(const std::wstring& exePath);

} // namespace MineCordUpdater