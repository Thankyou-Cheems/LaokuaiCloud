@echo off
setlocal
set "SQUAD_SRC=%~dp0"
set "SQUAD_OUT=%~dp0..\..\build\squad"
if not exist "%SQUAD_OUT%" mkdir "%SQUAD_OUT%"
where cl.exe >nul 2>&1
if %errorlevel% neq 0 (
  for %%p in ("%ProgramFiles%" "%ProgramFiles(x86)%") do (
    for %%y in (2022 2019 18 17) do (
      for %%e in (Community Professional Enterprise BuildTools) do (
        if exist "%%~p\Microsoft Visual Studio\%%y\%%e\VC\Auxiliary\Build\vcvarsall.bat" (
          call "%%~p\Microsoft Visual Studio\%%y\%%e\VC\Auxiliary\Build\vcvarsall.bat" x64
          goto :build
        )
      )
    )
  )
  exit /b 1
)
:build
cl.exe /nologo /EHsc /O2 /MT /DUNICODE /D_UNICODE /Fo:"%SQUAD_OUT%\scope.obj" /Fe:"%SQUAD_OUT%\squad-scope.exe" "%SQUAD_SRC%main.cpp" /link user32.lib
exit /b %errorlevel%
