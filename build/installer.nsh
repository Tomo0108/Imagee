; Imagee Windows installer: when Imagee is already installed, the first page of the wizard asks whether
; to update it in place. "Update" skips the install-mode and folder pages and installs over the existing
; copy, keeping its folder, shortcuts and the user's library. The other choice goes through the usual pages.

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh

  Var imageeUpdate        ; "1" = update the existing install in place
  Var imageeExisting      ; "1" = Imagee is already installed
  Var imageeOldVersion
  Var imageeRadioUpdate
  Var imageeRadioCustom

  ; Shorter texts than the defaults on the folder and finish pages.
  !define MUI_DIRECTORYPAGE_TEXT_TOP "$(imageeDirectoryText)"
  !define MUI_FINISHPAGE_TITLE "$(imageeFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(imageeFinishText)"

  ; The installer's own "updated" flag (--updated, used by auto-updates) now also covers our update choice,
  ; so every page and step that already handles updates behaves the same way.
  !undef isUpdated
  !macro _isUpdatedOrChosen _a _b _t _f
    ${StdUtils.TestParameter} $R9 "updated"
    StrCmp "$R9" "true" `${_t}` 0
    StrCmp "$imageeUpdate" "1" `${_t}` `${_f}`
  !macroend
  !define isUpdated `"" isUpdatedOrChosen ""`

  !macro customHeader
    LangString imageeUpdateTitle ${LANG_JAPANESE} "Imagee をアップデート"
    LangString imageeUpdateTitle ${LANG_ENGLISH} "Update Imagee"
    LangString imageeUpdateSubtitle ${LANG_JAPANESE} "$imageeOldVersion → ${VERSION}"
    LangString imageeUpdateSubtitle ${LANG_ENGLISH} "$imageeOldVersion → ${VERSION}"
    LangString imageeUpdateOption ${LANG_JAPANESE} "アップデートする（おすすめ）"
    LangString imageeUpdateOption ${LANG_ENGLISH} "Update (recommended)"
    LangString imageeUpdateOptionNote ${LANG_JAPANESE} "設定とライブラリはそのまま引き継がれます。"
    LangString imageeUpdateOptionNote ${LANG_ENGLISH} "Your settings and library are kept."
    LangString imageeCustomOption ${LANG_JAPANESE} "インストール先を選び直す"
    LangString imageeCustomOption ${LANG_ENGLISH} "Choose where to install"
    LangString imageeDirectoryText ${LANG_JAPANESE} "インストール先のフォルダーを選んでください。"
    LangString imageeDirectoryText ${LANG_ENGLISH} "Choose the folder to install Imagee in."
    LangString imageeFinishTitle ${LANG_JAPANESE} "準備ができました"
    LangString imageeFinishTitle ${LANG_ENGLISH} "Imagee is ready"
    LangString imageeFinishText ${LANG_JAPANESE} "Imagee ${VERSION} をインストールしました。"
    LangString imageeFinishText ${LANG_ENGLISH} "Imagee ${VERSION} has been installed."
    LangString imageeUpdateButton ${LANG_JAPANESE} "アップデート"
    LangString imageeUpdateButton ${LANG_ENGLISH} "&Update"
    LangString imageeOldRemoveSkipped ${LANG_JAPANESE} "古いファイルを上書きしてアップデートします（コード $R0）。"
    LangString imageeOldRemoveSkipped ${LANG_ENGLISH} "Overwriting the old files instead (code $R0)."
  !macroend

  !macro customInit
    StrCpy $imageeUpdate "0"
    StrCpy $imageeExisting "0"
    ${If} $hasPerUserInstallation == "1"
    ${OrIf} $hasPerMachineInstallation == "1"
      StrCpy $imageeExisting "1"
      ReadRegStr $imageeOldVersion SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
      ; Update is the default, and what a silent install does.
      StrCpy $imageeUpdate "1"
      ${If} ${UAC_IsInnerInstance}
        ; The elevated copy for an all-users install: take the choice made in the first window.
        !insertmacro UAC_AsUser_GetGlobalVar $imageeUpdate
        ${If} $imageeUpdate != "0"
          StrCpy $imageeUpdate "1"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  !macroend

  ; The choice is the first page of the wizard, shown only when Imagee is already installed.
  !macro customWelcomePage
    Page custom imageeUpdatePageShow imageeUpdatePageLeave

    Function imageeUpdatePageButton
      GetDlgItem $1 $HWNDPARENT 1
      ${NSD_GetState} $imageeRadioUpdate $0
      ${If} $0 == ${BST_CHECKED}
        SendMessage $1 ${WM_SETTEXT} 0 "STR:$(imageeUpdateButton)"
      ${Else}
        SendMessage $1 ${WM_SETTEXT} 0 "STR:$(^NextBtn)"
      ${EndIf}
    FunctionEnd

    Function imageeUpdatePageClick
      Pop $0
      Call imageeUpdatePageButton
    FunctionEnd

    Function imageeUpdatePageShow
      ${If} $imageeExisting != "1"
      ${OrIf} ${UAC_IsInnerInstance}
        Abort
      ${EndIf}
      !insertmacro MUI_HEADER_TEXT "$(imageeUpdateTitle)" "$(imageeUpdateSubtitle)"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateRadioButton} 0 6u 100% 12u "$(imageeUpdateOption)"
      Pop $imageeRadioUpdate
      ${NSD_AddStyle} $imageeRadioUpdate ${WS_GROUP}
      ${NSD_OnClick} $imageeRadioUpdate imageeUpdatePageClick
      ${NSD_CreateLabel} 13u 20u -13u 10u "$(imageeUpdateOptionNote)"
      Pop $0
      SetCtlColors $0 808080 transparent

      ${NSD_CreateRadioButton} 0 40u 100% 12u "$(imageeCustomOption)"
      Pop $imageeRadioCustom
      ${NSD_OnClick} $imageeRadioCustom imageeUpdatePageClick

      ${If} $imageeUpdate == "1"
        ${NSD_Check} $imageeRadioUpdate
        ${NSD_SetFocus} $imageeRadioUpdate
      ${Else}
        ${NSD_Check} $imageeRadioCustom
        ${NSD_SetFocus} $imageeRadioCustom
      ${EndIf}
      Call imageeUpdatePageButton
      nsDialogs::Show
    FunctionEnd

    Function imageeUpdatePageLeave
      ${NSD_GetState} $imageeRadioUpdate $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $imageeUpdate "1"
      ${Else}
        StrCpy $imageeUpdate "0"
      ${EndIf}
    FunctionEnd
  !macroend

  ; Just before installing: close Imagee and remove the old version ourselves. The old uninstaller is run
  ; without --updated, so it deletes files in place instead of first moving them to the temp folder; that
  ; move fails when a file is still in use and made the installer stop with "Imagee cannot be closed".
  ; Afterwards the installer finds no old version to remove. Settings and the library are kept.
  !macro customPageAfterChangeDir
    Page custom imageeRemoveOldVersion

    Function imageeRemoveOldVersion
      ${If} $imageeExisting == "1"
        Call imageeCloseApp
        ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
        ReadRegStr $R2 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
        ${If} $R1 != ""
        ${AndIf} $R2 != ""
        ${AndIf} ${FileExists} "$R1\${UNINSTALL_FILENAME}"
          ${If} $installMode == "all"
            StrCpy $R3 "/allusers"
          ${Else}
            StrCpy $R3 "/currentuser"
          ${EndIf}
          ReadRegStr $R4 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts
          ${If} $R4 == "true"
          ${AndIf} $imageeUpdate == "1"
            StrCpy $R3 "$R3 --keep-shortcuts"
          ${EndIf}
          InitPluginsDir
          ClearErrors
          CopyFiles /SILENT "$R1\${UNINSTALL_FILENAME}" "$PLUGINSDIR\imagee-old-uninstaller.exe"
          ${IfNot} ${Errors}
            ExecWait '"$PLUGINSDIR\imagee-old-uninstaller.exe" /S /KEEP_APP_DATA $R3 _?=$R1' $R0
          ${EndIf}
          ClearErrors
        ${EndIf}
      ${EndIf}
      Abort
    FunctionEnd

    ; Ends every Imagee process and waits (up to 5 seconds) until none is left.
    Function imageeCloseApp
      nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
      Pop $0
      StrCpy $1 0
      ${Do}
        nsExec::Exec `"$SYSDIR\cmd.exe" /C "$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /NH | "$SYSDIR\find.exe" /I "${APP_EXECUTABLE_FILENAME}"`
        Pop $0
        ${If} $0 != 0
        ${OrIf} $1 >= 10
          ${ExitDo}
        ${EndIf}
        IntOp $1 $1 + 1
        Sleep 500
        nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
        Pop $0
      ${Loop}
    FunctionEnd
  !macroend

  ; Updating keeps the existing install mode (just me / all users) instead of asking again.
  !macro customInstallMode
    ${If} $imageeUpdate == "1"
      ${If} $hasPerMachineInstallation == "1"
        StrCpy $isForceMachineInstall "1"
      ${Else}
        StrCpy $isForceCurrentInstall "1"
      ${EndIf}
    ${EndIf}
  !macroend

  ; The old version's uninstaller moves its files aside before removing them, and gives up when it can't
  ; (a file still in use, or Imagee installed on another drive than the temp folder). Instead of stopping
  ; the whole installer with "uninstall failed", close any Imagee left running and install over the old
  ; files: they are restored in place when that happens, and the new version simply replaces them.
  !macro imageeHandleOldUninstall
    ${If} ${Errors}
      ClearErrors
    ${ElseIf} $R0 != 0
      DetailPrint "$(imageeOldRemoveSkipped)"
      nsExec::Exec `taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
      Pop $0
      Sleep 500
      ClearErrors
    ${EndIf}
  !macroend
  !macro customUnInstallCheck
    !insertmacro imageeHandleOldUninstall
  !macroend
  !macro customUnInstallCheckCurrentUser
    !insertmacro imageeHandleOldUninstall
  !macroend
!endif
