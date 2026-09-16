@echo off
REM Script de demarrage rapide pour gestion_stocks_node (Windows)

cd /d "%~dp0"

REM Verifier que Node est installe
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [ERREUR] Node.js n'est pas installe.
    echo Telechargez-le sur https://nodejs.org (version 18 ou plus)
    pause
    exit /b 1
)

REM Installer les dependances si absentes
if not exist node_modules (
    echo.
    echo [INFO] Installation des dependances...
    npm install
    if errorlevel 1 (
        echo [ERREUR] npm install a echoue.
        pause
        exit /b 1
    )
)

REM Creer .env si absent
if not exist .env (
    echo [INFO] Creation du fichier .env depuis .env.example
    copy .env.example .env >nul
)

REM Initialiser la base + seed si absente
if not exist data\app.db (
    echo.
    echo [INFO] Initialisation de la base SQLite + donnees de demo...
    call npm run setup
)

echo.
echo ============================================================
echo   Systeme intelligent de gestion des stocks
echo   Serveur en cours de demarrage...
echo   Ouvrir : http://localhost:9000
echo   Comptes : admin/admin123 ^| gestionnaire/gestion123 ^| caissier/caisse123
echo ============================================================
echo.

REM Lancer le serveur
npm start
