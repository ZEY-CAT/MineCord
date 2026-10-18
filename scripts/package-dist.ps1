<#>
.SYNOPSIS
    Packages MineCord Electron and Tauri apps into ZIP archives for distribution.

.DESCRIPTION
    This script creates distribution ZIP files for both Electron (Full) and Tauri (Lite) editions.
    It ensures MineCordUpdater.dll is NOT included (shared DLL is installed separately).
    Each ZIP includes a README.txt with installation instructions.
#>

param(
    [string]$Version = "1.0.2",
    [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"

Write-Host "=== MineCord Distribution Packager ===" -ForegroundColor Cyan
Write-Host "Version: $Version" -ForegroundColor Yellow
Write-Host "Output Directory: $OutputDir" -ForegroundColor Yellow

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# Function to create README content
function Create-Readme {
    param(
        [string]$Edition,
        [string]$Description,
        [string[]]$Features,
        [string[]]$ExcludedFeatures
    )
    
    $readme = @"
MINECORD $Edition EDITION v$Version
================================

$Description

INSTALLATION
============

1. FIRST: Install the shared updater (required for automatic updates)
   Download and run: MineCordUpdaterSetup.exe
   This installs MineCordUpdater.dll to %ProgramFiles%\MineCord\

2. LAUNCH THE APPLICATION
   Extract this ZIP to a folder of your choice.
   Run MINECORD.exe to start the application.

REQUIREMENTS
============

- Windows 10/11 (x64)
- WebView2 Runtime (included with Windows 11, auto-installed on Windows 10)
- .NET Framework not required

SHARED UPDATER
==============

Both MineCord editions share a single native updater DLL installed at:
  %ProgramFiles%\MineCord\MineCordUpdater.dll

The MineCordUpdaterSetup.exe installer (downloaded separately) handles
installation with proper UAC elevation and safe upgrade handling.

If the updater DLL is missing, the application will show a helpful
error message with a link to download the installer.

FEATURES INCLUDED
=================
"@
    $readme += $Features | ForEach-Object { "  - $_" } -join "`n"
    
    if ($ExcludedFeatures.Count -gt 0) {
        $readme += "`n`nFEATURES EXCLUDED (Lite Edition Only)`n===================================`n"
        $readme += $ExcludedFeatures | ForEach-Object { "  - $_" } -join "`n"
    }
    
    $readme += @"

SUPPORT
=======

GitHub: https://github.com/ZEY-CAT/MineCord
Issues: https://github.com/ZEY-CAT/MineCord/issues

LICENSE
=======

MIT License - See LICENSE file for details.
"@
    
    return $readme
}

# Package Electron Full Edition
function Package-Electron {
    param($Version, $OutputDir)
    
    Write-Host "`n=== Packaging Electron Full Edition ===" -ForegroundColor Green
    
    $electronUnpacked = "dist/win-unpacked"
    $zipName = "MineCord-Electron-Full-v${Version}-Windows-x64.zip"
    $zipPath = Join-Path $OutputDir $zipName
    
    if (-not (Test-Path $electronUnpacked)) {
        Write-Error "Electron unpacked directory not found: $electronUnpacked"
        exit 1
    }
    
    # Verify no DLL is present
    $dllPath = Join-Path $electronUnpacked "resources/MineCordUpdater.dll"
    if (Test-Path $dllPath) {
        Write-Error "ERROR: MineCordUpdater.dll found in Electron output - should not be bundled!"
        exit 1
    }
    Write-Host "OK: MineCordUpdater.dll NOT bundled in Electron package" -ForegroundColor Green
    
    # Create README
    $features = @(
        "Full Electron-based application (~120 MB)",
        "Complete voice calling (private & group calls)",
        "WebRTC voice with TURN relay support",
        "Shop, cosmetics, inventory & onboarding",
        "Account merging with archive preservation",
        "Admin/owner tools (role management, audit logs)",
        "Eaglercraft browser extension integration",
        "Minecraft Java/Bedrock account linking",
        "Game activity display (Minecraft, Eaglercraft)",
        "Desktop notifications & push notifications",
        "Full settings & customization",
        "Account merging with deduplication"
    )
    
    $excluded = @()
    
    $readme = Create-Readme -Edition "ELECTRON FULL" `
        -Description "Full-featured Electron edition with all MineCord features including voice, shop, admin tools, and advanced account management." `
        -Features $features `
        -ExcludedFeatures $excluded
    
    $readmePath = Join-Path $electronUnpacked "README.txt"
    Set-Content -Path $readmePath -Value $readme -Encoding UTF8
    Write-Host "Created README.txt" -ForegroundColor Green
    
    # Create ZIP
    Write-Host "Creating ZIP: $zipName" -ForegroundColor Yellow
    Compress-Archive -Path (Join-Path $electronUnpacked "*") -DestinationPath $zipPath -Force
    
    # Verify ZIP
    $zipSize = (Get-Item $zipPath).Length
    Write-Host "Created: $zipPath ($([math]::Round($zipSize/1MB, 1)) MB)" -ForegroundColor Green
    
    return $zipPath
}

# Package Tauri Lite Edition
function Package-TauriLite {
    param($Version, $OutputDir)
    
    Write-Host "`n=== Packaging Tauri Lite Edition ===" -ForegroundColor Green
    
    # Tauri build output is typically in src-tauri/target/release/bundle/
    # For Windows, it creates NSIS installer and potentially zip/portable
    $tauriBundleDir = "src-tauri/target/release/bundle"
    
    if (-not (Test-Path $tauriBundleDir)) {
        Write-Error "Tauri bundle directory not found: $tauriBundleDir"
        exit 1
    }
    
    # Find the NSIS installer or portable output
    $nsisInstaller = Get-ChildItem -Recurse -Path $tauriBundleDir -Filter "*.exe" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*bundle*nsis*" } | Select-Object -First 1
    
    if (-not $nsisInstaller) {
        Write-Error "Tauri NSIS installer not found in $tauriBundleDir"
        exit 1
    }
    
    Write-Host "Found Tauri installer: $($nsisInstaller.FullName)" -ForegroundColor Green
    
    # For Tauri, we need to extract the installer to get the app files, then re-zip
    # Or we can use the portable target if configured
    # Let's check if there's a portable/zip output
    $zipOutput = Get-ChildItem -Recurse -Path $tauriBundleDir -Filter "*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
    
    $zipName = "MineCord-Tauri-Lite-v${Version}-Windows-x64.zip"
    $zipPath = Join-Path $OutputDir $zipName
    
    if ($zipOutput) {
        Write-Host "Found existing Tauri ZIP: $($zipOutput.FullName)" -ForegroundColor Green
        Copy-Item $zipOutput.FullName $zipPath -Force
    } else {
        # Need to create zip from NSIS installer output
        # Extract installer to temp, then re-zip the app files
        $tempDir = Join-Path $env:TEMP "MineCordTauriLite_${Version}"
        if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        
        Write-Host "Extracting Tauri installer to create ZIP..." -ForegroundColor Yellow
        
        # Use 7zip to extract NSIS installer
        $sevenZip = "C:\Program Files\7-Zip\7z.exe"
        if (-not (Test-Path $sevenZip)) {
            $sevenZip = "C:\Program Files (x86)\7-Zip\7z.exe"
        }
        
        if (-not (Test-Path $sevenZip)) {
            Write-Error "7-Zip not found. Cannot extract NSIS installer."
            exit 1
        }
        
        & $sevenZip x $nsisInstaller.FullName -o$tempDir -y | Out-Null
        
        # Find the app directory in extracted files
        $appDir = Get-ChildItem -Recurse -Path $tempDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*MineCord*" -or $_.Name -eq "app" -or $_.Name -eq "MINECORD" } | Select-Object -First 1
        
        if (-not $appDir) {
            # Try to find MINECORD.exe
            $exeFile = Get-ChildItem -Recurse -Path $tempDir -Filter "MINECORD.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($exeFile) {
                $appDir = $exeFile.Directory
            }
        }
        
        if (-not $appDir) {
            Write-Error "Could not find Tauri app directory in extracted installer"
            exit 1
        }
        
        Write-Host "Found app directory: $($appDir.FullName)" -ForegroundColor Green
        
        # Verify no DLL
        $dllPath = Join-Path $appDir.FullName "MineCordUpdater.dll"
        if (Test-Path $dllPath) {
            Write-Error "ERROR: MineCordUpdater.dll found in Tauri output - should not be bundled!"
            exit 1
        }
        Write-Host "OK: MineCordUpdater.dll NOT bundled in Tauri package" -ForegroundColor Green
        
        # Create README
        $features = @(
            "Lightweight Tauri/WebView2 application (~10 MB)",
            "Accounts, profiles & authentication",
            "Friends, DMs, servers & channels",
            "Text chat with full history",
            "Minecraft Java/Bedrock account linking",
            "Game activity display (Minecraft, Eaglercraft)",
            "Desktop notifications & push notifications",
            "Lightweight WebView2-based (~10 MB vs ~120 MB)"
        )
        
        $excluded = @(
            "Voice calling (private & group calls)",
            "WebRTC voice with TURN relay",
            "Shop, cosmetics, inventory & onboarding",
            "Account merging with archive preservation",
            "Admin/owner tools (role management, audit logs)",
            "Eaglercraft browser extension integration",
            "Full settings & customization",
            "Account merging with deduplication"
        )
        
        $readme = Create-Readme -Edition "TAURI LITE" `
            -Description "Lightweight Tauri/WebView2 edition with core chat features. Excludes voice, shop, admin tools, and advanced account management." `
            -Features $features `
            -ExcludedFeatures $excluded
        
        $readmePath = Join-Path $appDir.FullName "README.txt"
        Set-Content -Path $readmePath -Value $readme -Encoding UTF8
        Write-Host "Created README.txt" -ForegroundColor Green
        
        # Create ZIP
        Write-Host "Creating ZIP: $zipName" -ForegroundColor Yellow
        Compress-Archive -Path (Join-Path $appDir.FullName "*") -DestinationPath $zipPath -Force
        
        # Cleanup
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    # Verify ZIP
    $zipSize = (Get-Item $zipPath).Length
    Write-Host "Created: $zipPath ($([math]::Round($zipSize/1MB, 1)) MB)" -ForegroundColor Green
    
    return $zipPath
}

# Main
try {
    # Generate edition configs
    Write-Host "Generating edition configs..." -ForegroundColor Yellow
    & node scripts/generate-edition.js electron
    & node scripts/generate-edition.js tauri-lite
    
    # Package Electron Full Edition
    $electronZip = Package-Electron -Version $Version -OutputDir $OutputDir
    
    # Package Tauri Lite Edition
    $tauriZip = Package-TauriLite -Version $Version -OutputDir $OutputDir
    
    Write-Host "`n=== PACKAGING COMPLETE ===" -ForegroundColor Cyan
    Write-Host "Electron Full: $electronZip" -ForegroundColor Green
    Write-Host "Tauri Lite:    $tauriZip" -ForegroundColor Green
    Write-Host "Updater:       dist/MineCordUpdaterSetup.exe" -ForegroundColor Green
    
    # Final verification
    Write-Host "`n=== VERIFICATION ===" -ForegroundColor Cyan
    foreach ($zip in @($electronZip, $tauriZip)) {
        $size = (Get-Item $zip).Length
        Write-Host "$($zip) - $([math]::Round($size/1MB, 1)) MB" -ForegroundColor Yellow
        
        # Verify no DLL in zip
        $tempDir = Join-Path $env:TEMP "verify_$([guid]::NewGuid())"
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        try {
            $sevenZip = "C:\Program Files\7-Zip\7z.exe"
            if (-not (Test-Path $sevenZip)) { $sevenZip = "C:\Program Files (x86)\7-Zip\7z.exe" }
            & $sevenZip x $zip -o$tempDir -y | Out-Null
            $dllInZip = Get-ChildItem -Recurse -Path $tempDir -Filter "MineCordUpdater.dll" -ErrorAction SilentlyContinue
            if ($dllInZip) {
                Write-Error "FAIL: MineCordUpdater.dll found in $zip"
            } else {
                Write-Host "OK: No MineCordUpdater.dll in $zip" -ForegroundColor Green
            }
        } finally {
            Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    
} catch {
    Write-Error "Packaging failed: $_"
    exit 1
}