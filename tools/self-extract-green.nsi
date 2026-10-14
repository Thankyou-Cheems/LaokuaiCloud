; Built-in NSIS pages and per-file LZMA only: no plug-in DLLs or temporary payload.
Unicode true
SetCompressor /FINAL lzma
SetCompressorDictSize 32
CRCCheck force
RequestExecutionLevel user
Name "唠蒯云 ${APP_VERSION} 绿色包"
Caption "唠蒯云 · 解压即用"
BrandingText "唠蒯云 · 固定目录绿色包"
InstallButtonText "解压"
OutFile "${OUTPUT_EXE}"
Icon "${APP_ICON}"
InstallDir "$EXEDIR\唠蒯云"
ShowInstDetails show
AutoCloseWindow false
LoadLanguageFile "${NSISDIR}\Contrib\Language files\SimpChinese.nlf"
DirText "选择一个新的空文件夹。程序直接释放到这里，不向系统临时目录释放应用。已有版本请用增量更新，以保留原账号和配置。"
Page directory "" "" CheckDirectoryPage
Page instfiles
CompletedText "解压完成。请打开所选文件夹，运行“唠蒯云.exe”。首次启动按提示授予管理员权限；本解压程序可以删除。"
Var Failure

Function ValidateDirectory
  StrCpy $Failure ""
  GetFullPathName $6 "$INSTDIR\"
  StrCpy $INSTDIR $6
  StrCmp $INSTDIR "" invalid
  ; Reject TEMP itself and descendants, including an explicit /D override.
  GetFullPathName $2 "$TEMP"
  StrCmp $INSTDIR $2 temporary
  StrCpy $2 "$2\"
  StrLen $3 $2
  StrCpy $4 $INSTDIR $3
  StrCmp $4 $2 temporary
  ; Never merge a full package into an existing app/profile or arbitrary files.
  FindFirst $0 $1 "$INSTDIR\*"
  loop:
    StrCmp $1 "" empty
    StrCmp $1 "." next
    StrCmp $1 ".." next
    FindClose $0
    StrCpy $Failure "这个文件夹已有文件。请选择新文件夹；更新已有应用请使用增量包。"
    Return
  next:
    FindNext $0 $1
    Goto loop
  empty:
    FindClose $0
    Return
  temporary:
    StrCpy $Failure "请选桌面、文档或其他固定目录，不要选择系统临时目录。"
    Return
  invalid:
    StrCpy $Failure "请选择有效的固定目录。"
FunctionEnd

Function CheckDirectoryPage
  Call ValidateDirectory
  StrCmp $Failure "" done
  MessageBox MB_OK|MB_ICONEXCLAMATION "$Failure"
  Abort
  done:
FunctionEnd

Section "释放程序"
  Call ValidateDirectory
  StrCmp $Failure "" extract
  IfSilent rejected
  MessageBox MB_OK|MB_ICONEXCLAMATION "$Failure"
  rejected:
    SetErrorLevel 2
    Quit
  extract:
    SetOverwrite off
    ClearErrors
    SetOutPath "$INSTDIR"
    File /r "${PAYLOAD_DIR}\*.*"
    SetOutPath "$INSTDIR\resources\legal"
    File /oname=SELF-EXTRACTOR-LICENSE.txt "${NSISDIR}\COPYING"
    IfErrors failed
    SetErrorLevel 0
    Goto done
  failed:
    IfSilent failed_silent
    MessageBox MB_OK|MB_ICONSTOP "释放未完成。请检查空间和目录写入权限，换一个空目录重试。现有文件不会被覆盖。"
  failed_silent:
    SetErrorLevel 3
  done:
SectionEnd
