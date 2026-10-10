# Godot client checks. Run from the repo root or from godot/:
#   powershell -ExecutionPolicy Bypass -File godot\check.ps1
# Fails (exit 1) on any GDScript parse/runtime error, so a broken script can never silently produce
# a blank window. The backend integration test only runs when the backend answers on :8000.
param([string]$Godot = $env:GODOT_CONSOLE)

$ErrorActionPreference = "Stop"
if (-not $Godot) { $Godot = "C:\Users\Sukesh\Develop\Godot_4.6.3\Godot_v4.6.3-stable_win64_console.exe" }
if (-not (Test-Path $Godot)) { Write-Error "Godot console executable not found: $Godot (set GODOT_CONSOLE)"; exit 1 }
$proj = $PSScriptRoot
$failed = $false

function Run-Godot([string]$title, [string[]]$args_) {
    Write-Host "== $title"
    $ErrorActionPreference = "Continue"      # Godot writes warnings to stderr; judge by the parsed output instead
    $out = & $Godot @args_ 2>&1 | Out-String
    $bad = ($out -split "`n") | Where-Object { $_ -match "SCRIPT ERROR|Parse Error|Failed to load script|Invalid access|Invalid call" }
    if ($bad) { $bad | ForEach-Object { Write-Host "   $_" }; $script:failed = $true; Write-Host "   FAILED" }
    else { Write-Host "   clean" }
    return $out
}

Run-Godot "import + parse every script" @("--headless", "--path", $proj, "--import") | Out-Null
$o = Run-Godot "circuit + car placement tests" @("--headless", "--path", $proj, "--script", "res://tools/test_placement.gd")
if ($o -notmatch "RESULT: PASS") { Write-Host $o; $failed = $true }

$up = $false
try { $up = (Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 2).status -eq "ok" } catch {}
if ($up) {
    $o = Run-Godot "backend integration test (resets the race)" @("--headless", "--path", $proj, "--script", "res://tools/test_backend.gd")
    if ($o -notmatch "RESULT: PASS") { Write-Host $o; $failed = $true }
    # boot the real main scene for ~4 s and make sure nothing errors at runtime
    Run-Godot "boot main scene (headless, 240 frames)" @("--headless", "--path", $proj, "--quit-after", "240") | Out-Null
} else {
    Write-Host "== backend not running on :8000: skipped integration test and scene boot"
}

if ($failed) { Write-Host "`nGODOT CHECKS FAILED"; exit 1 }
Write-Host "`nGODOT CHECKS PASSED"
