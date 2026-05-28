@echo off
:: ── Start Qdrant vector database ──────────────────────────────────────────
:: Download qdrant.exe from:
::   https://github.com/qdrant/qdrant/releases/latest
::   → qdrant-x86_64-pc-windows-msvc.zip  → extract to C:\qdrant\
::
:: This script starts Qdrant and keeps the window open.
:: Data is saved automatically to .\storage\ next to qdrant.exe
:: Press Ctrl+C to stop Qdrant.

title Fin-Eye — Qdrant (port 6333)
echo Starting Qdrant vector database on port 6333...
echo Data will be saved to C:\qdrant\storage\
echo.
echo Press Ctrl+C to stop.
echo.

if not exist "C:\qdrant\qdrant.exe" (
    echo ERROR: C:\qdrant\qdrant.exe not found.
    echo.
    echo Download from:
    echo   https://github.com/qdrant/qdrant/releases/latest
    echo   File: qdrant-x86_64-pc-windows-msvc.zip
    echo   Extract qdrant.exe to C:\qdrant\
    pause
    exit /b 1
)

"C:\qdrant\qdrant.exe"
pause
