; MineCordUpdaterSetup.nsi
; Shared Windows Updater DLL Installer
; Installs MineCordUpdater.dll to %ProgramFiles%\MineCord\

Unicode true
XPStyle on

; ============================================================================
; Configuration
; ============================================================================
!define PRODUCT_NAME "MineCord Updater"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "ZEY-CAT"
!define PRODUCT_WEB_SITE "https://github.com/ZEY-CAT/MineCord"

!define INSTALL_DIR "$PROGRAMFILES\MineCord"
!define DLL_NAME "MineCordUpdater.dll"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "MineCordUpdaterSetup.exe"
InstallDir "${INSTALL_DIR}"
InstallDirRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MineCordUpdater" "InstallLocation"

; Request administrator privileges for Program Files
RequestExecutionLevel admin

; ============================================================================
; Pages
; ============================================================================
Page directory
Page instfiles

UninstPage uninstConfirm
UninstPage instfiles

; ============================================================================
; Languages
; ============================================================================
LoadLanguageFile "${NSISDIR}\Contrib\Language files\English.nlf"
LangString DESC_SecMain ${LANG_ENGLISH} "MineCord Shared Updater DLL (required for MineCord Electron and Tauri Lite)"

; ============================================================================
; Sections
; ============================================================================
Section "Main" SecMain
    SectionIn RO
    SetOutPath "$INSTALL_DIR"

    ; Copy the DLL
    File "${DLL_NAME}"

    ; Write uninstaller
    WriteUninstaller "$INSTALL_DIR\Uninstall.exe"

    ; Write registry keys for uninstaller
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MineCordUpdater" \
        "DisplayName" "${PRODUCT_NAME}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MineCordUpdater" \
        "UninstallString" "$INSTALL_DIR\Uninstall.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MineCordUpdater" \
        "QuietUninstallString" "$INSTALL_DIR\Uninstall.exe /S"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MineCordUpdater" \
        "InstallLocation" "$INSTALL_DIR"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MineCordUpdater" \
        "DisplayVersion" "${PRODUCT_VERSION}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MineCordUpdater" \
        "Publisher" "${PRODUCT_PUBLISHER}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MineCordUpdater" \
        "URLInfoAbout" "${PRODUCT_WEB_SITE}"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MineCordUpdater" \
        "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MineCordUpdater" \
        "NoRepair" 1
SectionEnd

; ============================================================================
; Uninstaller
; ============================================================================
Section "Uninstall"
    ; Remove the DLL
    Delete "$INSTALL_DIR\${DLL_NAME}"

    ; Remove uninstaller
    Delete "$INSTALL_DIR\Uninstall.exe"

    ; Remove directory if empty
    RMDir "$INSTALL_DIR"

    ; Remove registry keys
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MineCordUpdater"
SectionEnd

; ============================================================================
; Functions
; ============================================================================
Function .onInit
    ; Check if DLL is already loaded by running process
    ; This is a basic check - in production you'd want more sophisticated handling
    ClearErrors
    StrCpy $0 0
    loop:
    FindWindow $1 "MineCordUpdaterClass" "" $0
    StrCmp $1 0 done
    IntOp $0 $0 + 1
    Goto loop
    done:
FunctionEnd

; Check if we can safely replace the DLL (not locked)
Function CanReplaceDLL
    Push $0
    Push $1
    
    ; Try to open the DLL for write access
    ClearErrors
    System::Call 'kernel32::CreateFile(w "$INSTALL_DIR\${DLL_NAME}", i 0x40000000, i 0, i 0, i 3, i 0, i 0) i .r0'
    IfErrors locked
    System::Call 'kernel32::CloseHandle(i $0)'
    StrCpy $1 1
    Goto end
    locked:
    StrCpy $1 0
    end:
    Pop $0
    Exch $1
FunctionEnd