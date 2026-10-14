@echo off
pwsh -NoLogo -NoProfile -File "%~dp0apply-incremental-update.ps1" %*
pause
