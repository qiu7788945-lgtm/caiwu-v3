@echo off
setlocal

cd /d %~dp0

echo Starting OCR dev service...
echo.
echo If you have not created a virtual environment yet, you can run:
echo   python -m venv .venv
echo   .venv\Scripts\pip install -r requirements.txt
echo.

if exist .venv\Scripts\python.exe (
  .venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 18000 --reload
) else (
  python -m uvicorn app:app --host 127.0.0.1 --port 18000 --reload
)
