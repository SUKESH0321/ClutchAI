# One-stop launcher (Windows PowerShell).   Usage:
#   powershell -ExecutionPolicy Bypass -File run.ps1 setup     install everything (first time only)
#   powershell -ExecutionPolicy Bypass -File run.ps1 backend   start the AI / race engine on :8000
#   powershell -ExecutionPolicy Bypass -File run.ps1 web       start the browser app on :5173
#   powershell -ExecutionPolicy Bypass -File run.ps1 godot     start the Godot 3D game (backend must already be running)
#   powershell -ExecutionPolicy Bypass -File run.ps1 play      start the backend AND the Godot game together (easiest)
#   powershell -ExecutionPolicy Bypass -File run.ps1 get-godot download Godot 4.6.3 into tools\godot (no install needed)
#   powershell -ExecutionPolicy Bypass -File run.ps1 setup -NoWeb   Godot-only setup: skips Node.js and the browser app
#   powershell -ExecutionPolicy Bypass -File run.ps1 test      run all automated tests
# Open a separate terminal for each long-running task (backend, web, godot).
param([Parameter(Position = 0)][string]$Task = "help", [string]$Godot = $env:GODOT, [switch]$NoWeb)

$root = $PSScriptRoot
$py = Join-Path $root "backend\.venv\Scripts\python.exe"

function Need($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { Write-Host "Missing '$name'. $hint" -ForegroundColor Red; exit 1 }
}

function Find-Godot([bool]$console) {
    $cands = @()
    if ($Godot) { $cands += $Godot }
    $cands += (Get-Command "godot*" -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    foreach ($base in @((Join-Path $root "tools\godot"), "$env:USERPROFILE\Develop", "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop", "C:\Program Files", "$env:LOCALAPPDATA\Programs")) {
        if (Test-Path $base) {
            $cands += (Get-ChildItem $base -Recurse -Depth 3 -Filter "Godot*.exe" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
        }
    }
    $pick = $cands | Where-Object { $_ -and (Test-Path $_) -and (($_ -match "console") -eq $console) } | Select-Object -First 1
    if (-not $pick) { $pick = $cands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1 }
    return $pick
}

switch ($Task) {
    "setup" {
        if (-not $NoWeb) { Need "node" "Install Node.js 18+ from https://nodejs.org (or run: run.ps1 setup -NoWeb to skip the browser app)" }
        Need "uv" "Install uv: https://docs.astral.sh/uv/getting-started/installation/ (it also fetches Python 3.12)"
        if (-not (Test-Path $py)) { uv venv --python 3.12 (Join-Path $root "backend\.venv") }
        uv pip install --python $py -r (Join-Path $root "backend\requirements.txt")
        if (-not $NoWeb) { Push-Location (Join-Path $root "frontend"); npm install; Pop-Location }
        Write-Host "`nSetup done. Next: run.ps1 backend  (one terminal), then run.ps1 web  or  run.ps1 godot  (another)." -ForegroundColor Green
    }
    "backend" {
        if (-not (Test-Path $py)) { Write-Host "Run 'run.ps1 setup' first." -ForegroundColor Red; exit 1 }
        Push-Location (Join-Path $root "backend")
        & $py -m uvicorn app.main:app --port 8000
        Pop-Location
    }
    "web" {
        Push-Location (Join-Path $root "frontend"); npm run dev; Pop-Location
    }
    "get-godot" {
        $dir = Join-Path $root "tools\godot"
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $zip = Join-Path $dir "godot.zip"
        Write-Host "Downloading Godot 4.6.3 (about 80 MB) from github.com/godotengine/godot ..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri "https://github.com/godotengine/godot/releases/download/4.6.3-stable/Godot_v4.6.3-stable_win64.exe.zip" -OutFile $zip
        Expand-Archive -Path $zip -DestinationPath $dir -Force
        Remove-Item $zip
        Write-Host "Godot is in $dir. Now run: run.ps1 play" -ForegroundColor Green
    }
    "play" {
        if (-not (Test-Path $py)) { Write-Host "Run 'run.ps1 setup -NoWeb' first." -ForegroundColor Red; exit 1 }
        try { $up = (Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 2).status -eq "ok" } catch { $up = $false }
        if (-not $up) {
            Write-Host "Starting the backend in a new window..." -ForegroundColor Cyan
            Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "backend"
            for ($i = 0; $i -lt 40 -and -not $up; $i++) {
                Start-Sleep 1
                try { $up = (Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 2).status -eq "ok" } catch { }
            }
            if (-not $up) { Write-Host "The backend did not start. Check the backend window for errors." -ForegroundColor Red; exit 1 }
        }
        if ($Godot) { & $PSCommandPath godot -Godot $Godot } else { & $PSCommandPath godot }
    }
    "godot" {
        $exe = Find-Godot $false
        if (-not $exe) {
            Write-Host "Godot 4.6 not found. Run:  run.ps1 get-godot   (downloads it into tools\godot)" -ForegroundColor Yellow
            Write-Host "or download it from https://godotengine.org/download and run  run.ps1 godot -Godot 'C:\path\to\Godot_v4.6.x_win64.exe'  or open godot\project.godot in Godot and press F5."
            exit 1
        }
        try { $up = (Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 2).status -eq "ok" } catch { $up = $false }
        if (-not $up) { Write-Host "Note: the backend is not running on :8000. Start it with 'run.ps1 backend' (the game reconnects automatically)." -ForegroundColor Yellow }
        $proj = Join-Path $root "godot"
        if (-not (Test-Path (Join-Path $proj ".godot"))) {
            # first run on a fresh download: let Godot import the models and fonts before launching
            Write-Host "First run: importing game assets (about 20 seconds)..." -ForegroundColor Cyan
            & $exe --headless --path $proj --import | Out-Null
        }
        & $exe --path $proj        # starts full screen (F11 toggles windowed)
    }
    "test" {
        Push-Location (Join-Path $root "backend"); & $py -m pytest -q; Pop-Location
        Push-Location (Join-Path $root "frontend"); npm test; Pop-Location
        $g = Find-Godot $true
        if ($g) { $env:GODOT_CONSOLE = $g; & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "godot\check.ps1") } else { Write-Host "Godot not found: skipped the Godot checks." }
    }
    default {
        Get-Content $PSCommandPath -TotalCount 7 | ForEach-Object { Write-Host ($_ -replace "^# ?", "") }
    }
}
