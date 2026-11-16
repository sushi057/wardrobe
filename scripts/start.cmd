@echo off
rem Start Wardrobe from source (after setup.cmd). Opens it in Chrome.
if not exist "%~dp0..\.runtime\node\node.exe" (
  echo Run setup.cmd first.
  pause
  exit /b 1
)
set "WARDROBE_DATA=%~dp0..\data"
set "PATH=%~dp0..\.runtime\node;%PATH%"
"%~dp0..\.runtime\node\node.exe" "%~dp0..\launcher.js" %*
