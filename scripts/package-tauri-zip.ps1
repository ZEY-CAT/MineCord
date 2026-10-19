<#>
.SYNOPSIS
    Packages MineCord Tauri Lite Edition into a ZIP file.
#>

param(
    [string]$Version = "1.0.2"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Creating Tauri Lite Edition ZIP ===" -ForegroundColor Cyan

$zipName = "MineCord-Tauri-Lite-v${Version}-Windows-x64.zip"
$zipPath = "dist/${zipName}"

# Create dist directory
if (-not (Test-Path "dist")) {
    New-Item -ItemType Directory -Path "dist" -Force | Out-Null
}

# Find the built executable
$exePath = "src-tauri/target/release/minecord-desktop.exe"
if (-not (Test-Path $exePath)) {
    Write-Error "Tauri executable not found at $exePath"
    exit 1
}

Write-Host "Found Tauri executable: $exePath" -ForegroundColor Green

# Create temp directory for packaging
$tempDir = Join-Path $env:TEMP "MineCordTauriLite_${Version}"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

# Copy the executable
$appDir = Join-Path $tempDir "MineCord"
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item $exePath -Destination (Join-Path $appDir "MINECORD.exe") -Force

# Copy any additional files from the release directory (DLLs, etc.)
$releaseDir = "src-tauri/target/release"
$filesToCopy = Get-ChildItem -Path $releaseDir -File -ErrorAction SilentlyContinue | Where-Object { 
    $_.Extension -in @(".dll", ".dat", ".bin", ".pak", ".json") -and 
    $_.Name -notlike "*.pdb" -and
    $_.Name -ne "minecord-desktop.exe"
}
foreach ($file in $filesToCopy) {
    Copy-Item $file.FullName -Destination (Join-Path $appDir $file.Name) -Force
    Write-Host "Copied: $($file.Name)" -ForegroundColor Gray
}

# Check if there's a bundle/msi or bundle/nsis directory with additional resources
$bundleDir = "src-tauri/target/release/bundle"
if (Test-Path $bundleDir) {
    # Look for any additional resources in the bundle directories
    $bundleResources = Get-ChildItem -Path $bundleDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
        $_.Extension -in @(".dll", ".dat", ".bin", ".pak", ".json", ".ini") -and $_.Name -notlike "*.pdb"
    }
    foreach ($file in $bundleResources) {
        $destPath = Join-Path $appDir $file.Name
        if (-not (Test-Path $destPath)) {
            Copy-Item $file.FullName -Destination $destPath -Force
            Write-Host "Copied from bundle: $($file.Name)" -ForegroundColor Gray
        }
    }
}

# Verify no DLL
$dllPath = Join-Path $appDir "MineCordUpdater.dll"
if (Test-Path $dllPath) {
    Write-Error "ERROR: MineCordUpdater.dll found in Tauri output - should not be bundled!"
    exit 1
}
Write-Host "OK: MineCordUpdater.dll NOT bundled in Tauri package" -ForegroundColor Green

# Create README
$readmeLines = @(
    "MINECORD TAURI LITE EDITION v${Version}"
    "========================================"
    ""
    "Lightweight Tauri/WebView2 edition with core chat features. Excludes voice, shop, admin tools, and advanced account management."
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
    "- Lightweight Tauri/WebView2 application (~10 MB)"
    "- Accounts, profiles & authentication"
    "- Friends, DMs, servers & channels"
    "- Text chat with full history"
    "- Minecraft Java/Bedrock account linking"
    "- Game activity display (Minecraft, Eaglercraft)"
    "- Desktop notifications & push notifications"
    "- Lightweight WebView2-based (~10 MB vs ~120 MB)"
    ""
    "FEATURES EXCLUDED (Lite Edition Only)"
    "====================================="
    "- Voice calling (private & group calls)"
    "- WebRTC voice with TURN relay"
    "- Shop, cosmetics, inventory & onboarding"
    "- Account merging with archive preservation"
    "- Admin/owner tools (role management, audit logs)"
    "- Eaglercraft browser extension integration"
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
$readmePath = Join-Path $appDir "README.txt"
Set-Content -Path $readmePath -Value $readme -Encoding UTF8
Write-Host "Created README.txt" -ForegroundColor Green

# Create ZIP
Write-Host "Creating ZIP: ${zipName}" -ForegroundColor Yellow
Compress-Archive -Path (Join-Path $appDir "*") -DestinationPath "dist/${zipName}" -Force

# Cleanup
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

$zipSize = (Get-Item "dist/${zipName}").Length
Write-Host "Created: dist/${zipName} ($([math]::Round($zipSize/1MB, 1)) MB)" -ForegroundColor Green