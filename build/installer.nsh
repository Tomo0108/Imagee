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
    LangString imageeUpdateTitle ${LANG_JAPANESE} "Imagee はインストール済みです"
    LangString imageeUpdateTitle ${LANG_ENGLISH} "Imagee is already installed"
    LangString imageeUpdateSubtitle ${LANG_JAPANESE} "インストールの方法を選んでください。"
    LangString imageeUpdateSubtitle ${LANG_ENGLISH} "Choose how to install."
    LangString imageeUpdateIntro ${LANG_JAPANESE} "このパソコンには Imagee $imageeOldVersion がインストールされています。Imagee ${VERSION} をどのようにインストールしますか？"
    LangString imageeUpdateIntro ${LANG_ENGLISH} "Imagee $imageeOldVersion is installed on this computer. How would you like to install Imagee ${VERSION}?"
    LangString imageeUpdateOption ${LANG_JAPANESE} "アップデートする（おすすめ）"
    LangString imageeUpdateOption ${LANG_ENGLISH} "Update (recommended)"
    LangString imageeUpdateOptionNote ${LANG_JAPANESE} "今と同じ場所に新しいバージョンを上書きします。設定、ショートカット、ライブラリの画像はそのまま引き継がれます。"
    LangString imageeUpdateOptionNote ${LANG_ENGLISH} "Installs the new version over the current one, in the same place. Your settings, shortcuts and library are kept."
    LangString imageeCustomOption ${LANG_JAPANESE} "インストール方法と場所を選び直す"
    LangString imageeCustomOption ${LANG_ENGLISH} "Choose how and where to install"
    LangString imageeCustomOptionNote ${LANG_JAPANESE} "使うユーザーとインストール先のフォルダーを、次の画面で選び直します。"
    LangString imageeCustomOptionNote ${LANG_ENGLISH} "Pick who it is installed for and the folder on the next pages."
    LangString imageeUpdateButton ${LANG_JAPANESE} "アップデート"
    LangString imageeUpdateButton ${LANG_ENGLISH} "&Update"
    LangString imageeOldRemoveSkipped ${LANG_JAPANESE} "古いバージョンのファイルを先に削除できなかったため、上書きしてアップデートします（コード $R0）。"
    LangString imageeOldRemoveSkipped ${LANG_ENGLISH} "The old version's files could not be removed first, so they are being overwritten instead (code $R0)."
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

      ${NSD_CreateLabel} 0 0 100% 24u "$(imageeUpdateIntro)"
      Pop $0

      ${NSD_CreateRadioButton} 0 34u 100% 12u "$(imageeUpdateOption)"
      Pop $imageeRadioUpdate
      ${NSD_AddStyle} $imageeRadioUpdate ${WS_GROUP}
      ${NSD_OnClick} $imageeRadioUpdate imageeUpdatePageClick
      ${NSD_CreateLabel} 12u 48u -12u 24u "$(imageeUpdateOptionNote)"
      Pop $0

      ${NSD_CreateRadioButton} 0 80u 100% 12u "$(imageeCustomOption)"
      Pop $imageeRadioCustom
      ${NSD_OnClick} $imageeRadioCustom imageeUpdatePageClick
      ${NSD_CreateLabel} 12u 94u -12u 24u "$(imageeCustomOptionNote)"
      Pop $0

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
