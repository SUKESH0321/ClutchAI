# One-stop launcher (Windows PowerShell).   Usage:
#   powershell -ExecutionPolicy Bypass -File run.ps1 setup     install everything (first time only)
#   powershell -ExecutionPolicy Bypass -File run.ps1 backend   start the AI / race engine on :8000
#   powershell -ExecutionPolicy Bypass -File run.ps1 web       start the browser app on :5173
#   powershell -ExecutionPolicy Bypass -File run.ps1 godot     start the Godot 3D game
#   powershell -ExecutionPolicy Bypass -File run.ps1 test      run all automated tests
# Open a separate terminal for each long-running task (backend, web, godot).
param([Parameter(Position = 0)][string]$Task = "help", [string]$Godot = $env:GODOT)

$root = $PSScriptRoot
$py = Join-Path $root "backend\.venv\Scripts\python.exe"

function Need($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { Write-Host "Missing '$name'. $hint" -ForegroundColor Red; exit 1 }
}

function Find-Godot([bool]$console) {
    $cands = @()
    if ($Godot) { $cands += $Godot }
    $cands += (Get-Command "godot*" -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
    foreach ($base in @("$env:USERPROFILE\Develop", "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop", "C:\Program Files", "$env:LOCALAPPDATA\Programs")) {
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
        Need "node" "Install Node.js 18+ from https://nodejs.org"
        Need "uv" "Install uv: https://docs.astral.sh/uv/getting-started/installation/ (it also fetches Python 3.12)"
        if (-not (Test-Path $py)) { uv venv --python 3.12 (Join-Path $root "backend\.venv") }
        uv pip install --python $py -r (Join-Path $root "backend\requirements.txt")
        Push-Location (Join-Path $root "frontend"); npm install; Pop-Location
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
    "godot" {
        $exe = Find-Godot $false
        if (-not $exe) {
            Write-Host "Godot 4.6 not found. Download it from https://godotengine.org/download (free), then either" -ForegroundColor Yellow
            Write-Host "  run.ps1 godot -Godot 'C:\path\to\Godot_v4.6.x_win64.exe'   or open godot\project.godot in Godot and press F5."
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
        & $exe --path $proj --resolution 1600x900
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
