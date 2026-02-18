@echo off
echo =============================================
echo  Ampdeck v1.3.1 - Stream Deck Plugin
echo  The Unofficial Plexamp Controller
echo =============================================
echo.

:: Check if Stream Deck is running
tasklist /FI "IMAGENAME eq StreamDeck.exe" 2>NUL | find /I /N "StreamDeck.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo ERROR: Stream Deck is currently running!
    echo.
    echo Please close Stream Deck completely:
    echo   1. Right-click Stream Deck icon in system tray
    echo   2. Click "Quit" or "Exit"
    echo   3. Run this installer again
    echo.
    pause
    exit /b 1
)

:: Set the plugin directory
set "PLUGIN_DIR=%APPDATA%\Elgato\StreamDeck\Plugins\com.dreadheadhippy.ampdeck.sdPlugin"
set "SOURCE_DIR=%~dp0com.dreadheadhippy.ampdeck.sdPlugin"

:: Remove old installation if exists
if exist "%PLUGIN_DIR%" (
    echo Removing previous installation...
    rmdir /s /q "%PLUGIN_DIR%"
)

:: Copy plugin files
echo Installing plugin files...
xcopy /E /I /Y "%SOURCE_DIR%" "%PLUGIN_DIR%\"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo =============================================
    echo  Installation Complete!
    echo =============================================
    echo.
    echo Next steps:
    echo.
    echo 1. Start the Stream Deck application
    echo.
    echo 2. Find "Ampdeck" in the actions list on the right
    echo.
    echo 3. Drag "Album Art" to any button
    echo.
    echo 4. Drag "Now Playing Strip" to ALL 4 DIALS
    echo.
    echo 5. Click any action and configure:
    echo    - Server URL: http://YOUR-SERVER-IP:32400
    echo    - Plex Token: [your token]
    echo    - Client Name: [your PC name in Plex]
    echo.
    echo 6. Click "Test Connection" to verify
    echo.
    echo 7. Play something in Plexamp!
    echo.
) else (
    echo.
    echo ERROR: Installation failed!
    echo.
)

pause
