# Benchmarks the Godot client (vsync off) for each quality preset and camera on a live race. Backend must be running.
#   powershell -ExecutionPolicy Bypass -File scripts\godot_bench.ps1 [-Seconds 10] [-Qualities performance,balanced,high,ultra] [-Cams orbit,chase]
param([int]$Seconds = 10, [string[]]$Qualities = @("performance", "balanced", "high", "ultra"), [string[]]$Cams = @("orbit", "chase", "top"),
      [string]$Godot = "C:\Users\Sukesh\Develop\Godot_4.6.3\Godot_v4.6.3-stable_win64_console.exe", [string]$Res = "1600x900")
$root = Split-Path -Parent $PSScriptRoot
$api = "http://localhost:8000/api/race"
foreach ($cam in $Cams) {
  foreach ($q in $Qualities) {
    Invoke-RestMethod -Method Post -Uri "$api/reset" -ContentType "application/json" -Body "{}" | Out-Null
    Invoke-RestMethod -Method Post -Uri "$api/speed" -ContentType "application/json" -Body "{""speed"":1}" | Out-Null
    Invoke-RestMethod -Method Post -Uri "$api/start" | Out-Null
    $argv = @("--path", (Join-Path $root "godot"), "--resolution", $Res, "--", "--novsync", "--quality=$q", "--cam=$cam", "--bench=$Seconds")
    $out = & $Godot @argv 2>&1 | Out-String
    $line = ($out -split "`n") | Where-Object { $_ -like "BENCH*" } | Select-Object -First 1
    "{0,-6} {1}" -f $cam, $line
  }
}
