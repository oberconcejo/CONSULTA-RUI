@echo off
echo ======================================================
echo          SUBIR PROYECTO RUI A GITHUB
echo ======================================================
echo.

where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Git no esta instalado o no se encuentra en el PATH.
    echo.
    echo Por favor, descarga e instala Git desde:
    echo https://git-scm.com/download/win
    echo.
    echo Presiona una tecla para abrir la web de descarga...
    pause > nul
    start https://git-scm.com/download/win
    exit
)

echo [1/5] Inicializando repositorio Git local...
if not exist .git (
    git init
) else (
    echo Ya esta inicializado.
)

echo.
echo [2/5] Agregando archivos...
git add .

echo.
echo [3/5] Creando commit...
git commit -m "feat: Consulta RUI con diseno oficial DNP"

echo.
echo [4/5] Configurando repositorio remoto...
git remote remove origin >nul 2>nul
git remote add origin https://github.com/oberconcejo/CONSULTA-RUI.git
git branch -M main

echo.
echo [5/5] Subiendo cambios a GitHub...
echo (Inicia sesion en la ventana de GitHub si se te solicita)
echo.
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ======================================================
    echo [EXITO] El proyecto se subio correctamente a GitHub.
    echo ======================================================
) else (
    echo.
    echo ======================================================
    echo [ERROR] Ocurrio un problema al subir a GitHub.
    echo ======================================================
)

echo.
echo Presiona una tecla para salir...
pause > nul
