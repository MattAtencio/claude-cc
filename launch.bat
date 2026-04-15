@echo off
cd /d C:\dev\claude-organizer
start "" /B npm run dev
timeout /t 3 /nobreak >nul
cd src-tauri
cargo run --release
