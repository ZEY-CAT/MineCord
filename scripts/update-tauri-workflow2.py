with open('.github/workflows/tauri-build.yml', 'r', encoding='utf-8-sig') as f:
    content = f.read()

# Find and replace the inline PowerShell script for packaging Tauri ZIP
old_block = '''      - name: Package Tauri Lite Edition ZIP
        run: |
          Write-Host "=== Creating Tauri Lite Edition ZIP ==="
          $version = "${{ github.event.inputs.version || '1.0.2' }}"
          $zipName = "MineCord-Tauri-Lite-v${version}-Windows-x64.zip"
          $zipPath = "dist/${zipName}"
          
          # Create dist directory
          if (-not (Test-Path "dist")) {
            New-Item -ItemType Directory -Path "dist" -Force | Out-Null
          }
          
          # Find the NSIS installer
          $nsisInstaller = Get-ChildItem -Recurse -Path src-tauri/target -Filter "*.exe" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*bundle*nsis*" } | Select-Object -First 1
          
          if (-not $nsisInstaller) {
            Write-Error "Tauri NSIS installer not found"
            exit 1
          }
          
          Write-Host "Found Tauri installer: $($nsisInstaller.FullName)"
          
          # Use 7zip to extract NSIS installer
          $sevenZip = "C:\Program Files\7-Zip\7z.exe"
          if (-not (Test-Path $sevenZip)) {
            $sevenZip = "C:\Program Files (x86)\7-Zip\7z.exe"
          }
          
          if (-not (Test-Path $sevenZip)) {
            Write-Error "7-Zip not found. Cannot extract NSIS installer."
            exit 1
          }
          
          $tempDir = Join-Path $env:TEMP "MineCordTauriLite_${version}"
          if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
          New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
          
          Write-Host "Extracting Tauri installer to create ZIP..."
          & $sevenZip x $nsisInstaller.FullName -o$tempDir -y | Out-Null
          
          # Find the app directory in extracted files
          $appDir = Get-ChildItem -Recurse -Path $tempDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*MineCord*" -or $_.Name -eq "app" -or $_.Name -eq "MINECORD" } | Select-Object -First 1
          
          if (-not $appDir) {
            $exeFile = Get-ChildItem -Recurse -Path $tempDir -Filter "MINECORD.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($exeFile) {
              $appDir = $exeFile.Directory
            }
          }
          
          if (-not $appDir) {
            Write-Error "Could not find Tauri app directory in extracted installer"
            exit 1
          }
          
          Write-Host "Found app directory: $($appDir.FullName)"
          
          # Verify no DLL
          $dllPath = Join-Path $appDir.FullName "MineCordUpdater.dll"
          if (Test-Path $dllPath) {
            Write-Error "ERROR: MineCordUpdater.dll found in Tauri output - should not be bundled!"
            exit 1
          }
          Write-Host "OK: MineCordUpdater.dll NOT bundled in Tauri package"
          
          # Create README
          $readme = @"
MINECORD TAURI LITE EDITION v${version}
=======================================

Lightweight Tauri/WebView2 edition with core chat features. Excludes voice, shop, admin tools, and advanced account management.

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
- Lightweight Tauri/WebView2 application (~10 MB)
- Accounts, profiles & authentication
- Friends, DMs, servers & channels
- Text chat with full history
- Minecraft Java/Bedrock account linking
- Game activity display (Minecraft, Eaglercraft)
- Desktop notifications & push notifications
- Lightweight WebView2-based (~10 MB vs ~120 MB)

FEATURES EXCLUDED (Lite Edition Only)
=====================================
- Voice calling (private & group calls)
- WebRTC voice with TURN relay
- Shop, cosmetics, inventory & onboarding
- Account merging with archive preservation
- Admin/owner tools (role management, audit logs)
- Eaglercraft browser extension integration
- Full settings & customization
- Account merging with deduplication

SUPPORT
=======

GitHub: https://github.com/ZEY-CAT/MineCord
Issues: https://github.com/ZEY-CAT/MineCord/issues

LICENSE
=======

MIT License - See LICENSE file for details.
"@
            
          $readmePath = Join-Path $appDir.FullName "README.txt"
          Set-Content -Path $readmePath -Value $readme -Encoding UTF8
          Write-Host "Created README.txt"
          
          # Create ZIP
          Write-Host "Creating ZIP: ${zipName}"
          Compress-Archive -Path (Join-Path $appDir.FullName "*") -DestinationPath "dist/${zipName}" -Force
          
          # Cleanup
          Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
          
          $zipSize = (Get-Item "dist/${zipName}").Length
          Write-Host "Created: dist/${zipName} ($([math]::Round($zipSize/1MB, 1)) MB)"
        shell: pwsh'''

new_block = '''      - name: Package Tauri Lite Edition ZIP
        run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\package-tauri-zip.ps1 -Version "${{ github.event.inputs.version || '1.0.2' }}"'''

# Read the file
with open('.github/workflows/tauri-build.yml', 'r', encoding='utf-8-sig') as f:
    content = f.read()

# Replace the old block with the new one
if old_block in content:
    content = content.replace(old_block, new_block)
    with open('.github/workflows/tauri-build.yml', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Updated tauri-build.yml")
else:
    print("Old block not found!")
    # Print first 200 chars of old_block for debugging
    print("First 200 chars of old_block:")
    print(repr(old_block[:200]))