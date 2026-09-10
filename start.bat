@echo off
cd /d "%~dp0"
start "" http://localhost:5173/
python -m http.server 5173
