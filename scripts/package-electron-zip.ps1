<#>
.SYNOPSIS
    Packages MineCord Electron Full Edition into a ZIP file.
#>

param(
    [string]$Version = "1.0.2"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Creating Electron Full Edition ZIP ===" -ForegroundColor Cyan

$zipName = "MineCord-Electron-Full-v${Version}-Windows-x64.zip"
$zipPath = "dist/${zipName}"

# Create README
$readmeLines = @(
    "MINECORD ELECTRON FULL EDITION v${Version}"
    "========================================="
    ""
    "Full-featured Electron edition with all MineCord features including voice, shop, admin tools, and advanced account management."
    ""
    "INSTALLATION"
    "============"
    ""
    "1. FIRST: Install the shared updater (required for automatic updates)"
    "   Download and run: MineCordUpdaterSetup.exe"
    "   This installs MineCordUpdater.dll to %ProgramFiles%\MineCord\"
    ""
    "2. LAUNCH THE APPLICATION"
    "   Extract this ZIP to a folder of your choice."
    "   Run MINECORD.exe to start the application."
    ""
    "REQUIREMENTS"
    "============"
    ""
    "- Windows 10/11 (x64)"
    "- WebView2 Runtime (included with Windows 11, auto-installed on Windows 10)"
    "- .NET Framework not required"
    ""
    "SHARED UPDATER"
    "=============="
    ""
    "Both MineCord editions share a single native updater DLL installed at:"
    "  %ProgramFiles%\MineCord\MineCordUpdater.dll"
    ""
    "The MineCordUpdaterSetup.exe installer (downloaded separately) handles"
    "installation with proper UAC elevation and safe upgrade handling."
    ""
    "If the updater DLL is missing, the application will show a helpful"
    "error message with a link to download the installer."
    ""
    "FEATURES INCLUDED"
    "================="
    "- Full Electron-based application (~120 MB)"
    "- Complete voice calling (private & group calls)"
    "- WebRTC voice with TURN relay support"
    "- Shop, cosmetics, inventory & onboarding"
    "- Account merging with archive preservation"
    "- Admin/owner tools (role management, audit logs)"
    "- Eaglercraft browser extension integration"
    "- Minecraft Java/Bedrock account linking"
    "- Game activity display (Minecraft, Eaglercraft)"
    "- Desktop notifications & push notifications"
    "- Full settings & customization"
    "- Account merging with deduplication"
    ""
    "SUPPORT"
    "======="
    ""
    "GitHub: https://github.com/ZEY-CAT/MineCord"
    "Issues: https://github.com/ZEY-CAT/MineCord/issues"
    ""
    "LICENSE"
    "======="
    ""
    "MIT License - See LICENSE file for details."
)

$readme = $readmeLines -join "`r`n"
$readmePath = "dist/win-unpacked/README.txt"
Set-Content -Path $readmePath -Value $readme -Encoding UTF8
Write-Host "Created README.txt" -ForegroundColor Green

# Create ZIP
Write-Host "Creating ZIP: ${zipName}" -ForegroundColor Yellow
Compress-Archive -Path "dist/win-unpacked/*" -DestinationPath "dist/${zipName}" -Force

$zipSize = (Get-Item "dist/${zipName}").Length
Write-Host "Created: ${zipPath} ($([math]::Round($zipSize/1MB, 1)) MB)" -ForegroundColor Green