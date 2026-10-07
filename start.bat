@echo off
title FAVYT
echo ========================================================
echo  Starting FAVYT Web Application...
echo ========================================================

cd /d "%~dp0"

echo [1/2] Launching local server at http://localhost:8245 ...
start "" http://localhost:8245

python -m uvicorn backend.app:app --host 127.0.0.1 --port 8245 --reload
pause
