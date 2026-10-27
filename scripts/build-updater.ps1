param(
    [string]$Configuration = "Release",
    [switch]$BuildInstaller
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$updaterDir = Join-Path $projectRoot "updater"
$buildDir = Join-Path $updaterDir "build"
$outputDir = Join-Path $projectRoot "dist"

Write-Host "Building MineCordUpdater.dll..." -ForegroundColor Cyan

# Check for CMake
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    Write-Error "CMake not found. Please install CMake from https://cmake.org/download/"
    exit 1
}

# Check for Visual Studio
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vsWhere)) {
    Write-Error "Visual Studio not found. Please install Visual Studio 2022 with C++ workload."
    exit 1
}

# Create build directory
if (-not (Test-Path $buildDir)) {
    New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
}

# Configure with CMake (Ninja generator for CI compatibility)
Write-Host "Configuring with CMake..." -ForegroundColor Yellow
$cmakeArgs = @(
    "-B", $buildDir,
    "-S", $updaterDir,
    "-DCMAKE_BUILD_TYPE=$Configuration",
    "-G", "Ninja"
)

& cmake @cmakeArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "CMake configuration failed"
    exit 1
}

# Build
Write-Host "Building with Ninja..." -ForegroundColor Yellow
$buildArgs = @(
    "--build", $buildDir,
    "--config", $Configuration,
    "--parallel"
)

& cmake @buildArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed"
    exit 1
}

# Verify the DLL was built
$dllPath = Join-Path (Join-Path $buildDir $Configuration) "MineCordUpdater.dll"
if (-not (Test-Path $dllPath)) {
    Write-Error "DLL not found at $dllPath"
    exit 1
}

# Verify the DLL is valid
$dllInfo = Get-Item $dllPath
Write-Host "DLL built successfully: $($dllInfo.FullName) ($($dllInfo.Length / 1KB) KB)" -ForegroundColor Green

# Copy to project root for easy access
$projectDllPath = Join-Path $projectRoot "MineCordUpdater.dll"
Copy-Item $dllPath -Destination $projectDllPath -Force
Write-Host "Copied to project root: $projectDllPath" -ForegroundColor Green

# Also copy to updater/build/Release for electron-builder extraResources
$electronDllPath = Join-Path (Join-Path $buildDir $Configuration) "MineCordUpdater.dll"
if (-not (Test-Path (Split-Path $electronDllPath -Parent))) {
    New-Item -ItemType Directory -Path (Split-Path $electronDllPath -Parent) -Force | Out-Null
}
if ($dllPath -ne $electronDllPath) {
    Copy-Item $dllPath -Destination $electronDllPath -Force
}
Write-Host "Copied for electron-builder: $electronDllPath" -ForegroundColor Green

# Build NSIS installer if requested
if ($BuildInstaller) {
    Write-Host "Building NSIS installer..." -ForegroundColor Yellow
    
    # Check for NSIS
    $nsisPath = "${env:ProgramFiles}\NSIS\makensis.exe"
    if (-not (Test-Path $nsisPath)) {
        $nsisPath = "${env:ProgramFiles(x86)}\NSIS\makensis.exe"
    }
    if (-not (Test-Path $nsisPath)) {
        Write-Error "NSIS not found. Please install NSIS from https://nsis.sourceforge.io/Download"
        exit 1
    }
    
    # Copy DLL to updater directory for installer
    $installerDllPath = Join-Path $updaterDir $dllInfo.Name
    Copy-Item $dllPath -Destination $installerDllPath -Force
    
    # Build installer
    $nsisScript = Join-Path $updaterDir "MineCordUpdaterSetup.nsi"
    & $nsisPath $nsisScript
    if ($LASTEXITCODE -ne 0) {
        Write-Error "NSIS installer build failed"
        exit 1
    }
    
    # Move installer to dist
    $installerOutput = Join-Path $outputDir "MineCordUpdaterSetup.exe"
    $installerBuilt = Join-Path $updaterDir "MineCordUpdaterSetup.exe"
    if (Test-Path $installerBuilt) {
        if (-not (Test-Path $outputDir)) {
            New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
        }
        Move-Item $installerBuilt -Destination $installerOutput -Force
        Write-Host "Installer created: $installerOutput" -ForegroundColor Green
    }
    
    # Cleanup
    Remove-Item $installerDllPath -Force -ErrorAction SilentlyContinue
}

Write-Host "Build completed successfully!" -ForegroundColor Green