; Imagee Windows installer: when Imagee is already installed, offer to update it in place.
; "Update" skips the install-mode and folder pages and installs over the existing copy, keeping
; its folder, shortcuts and the user's library. "No" goes through the usual pages.

!ifndef BUILD_UNINSTALLER
  Var imageeUpdate

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
    LangString imageeUpdatePrompt ${LANG_JAPANESE} "Imagee $R0 がこのパソコンにインストールされています。$\r$\n$\r$\nImagee ${VERSION} にアップデートしますか？$\r$\n$\r$\nはい：アップデートする（おすすめ。設定とライブラリの画像はそのまま引き継がれます）$\r$\nいいえ：インストール方法と場所を選び直す$\r$\nキャンセル：インストールをやめる"
    LangString imageeUpdatePrompt ${LANG_ENGLISH} "Imagee $R0 is already installed on this computer.$\r$\n$\r$\nUpdate to Imagee ${VERSION}?$\r$\n$\r$\nYes: update (recommended; your settings and library are kept)$\r$\nNo: choose how and where to install again$\r$\nCancel: quit the installer"
  !macroend

  !macro customInit
    StrCpy $imageeUpdate "0"
    ${If} $hasPerUserInstallation == "1"
    ${OrIf} $hasPerMachineInstallation == "1"
      ${If} ${UAC_IsInnerInstance}
        ; The elevated copy for an all-users install: the choice was already made in the first window.
        StrCpy $imageeUpdate "1"
      ${ElseIfNot} ${Silent}
        ReadRegStr $R0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
        MessageBox MB_YESNOCANCEL|MB_ICONQUESTION|MB_DEFBUTTON1 "$(imageeUpdatePrompt)" /SD IDYES IDYES imageeUpdateYes IDNO imageeUpdateDone
        Quit
        imageeUpdateYes:
          StrCpy $imageeUpdate "1"
        imageeUpdateDone:
      ${EndIf}
    ${EndIf}
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
!endif
