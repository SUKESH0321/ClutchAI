# Compares frame rate of the Godot client at a git revision (default HEAD) against the working tree, vsync off, same cameras.
#   powershell -ExecutionPolicy Bypass -File scripts\godot_compare.ps1 [-Rev HEAD] [-Seconds 22]
param([string]$Rev = "HEAD", [int]$Seconds = 22, [string]$Cams = "orbit,chase,top", [string]$Extra = "", [double]$Stress = 0,
      [string]$Godot = "C:\Users\Sukesh\Develop\Godot_4.6.3\Godot_v4.6.3-stable_win64_console.exe")
$root = Split-Path -Parent $PSScriptRoot
$old = Join-Path $env:TEMP "godot_old_tree"
if (Test-Path $old) { Remove-Item -Recurse -Force $old }
New-Item -ItemType Directory -Path $old | Out-Null
Push-Location $root
git archive --format=zip -o (Join-Path $old "tree.zip") $Rev godot
Expand-Archive -Path (Join-Path $old "tree.zip") -DestinationPath $old -Force
Pop-Location
if ($Stress -gt 0) {   # emulate a slower GPU by supersampling the 3D view (GPU load x Stress^2) in both builds
  $mf = Join-Path $old "godot\scripts\main.gd"
  (Get-Content $mf -Raw).Replace("func _ready() -> void:`n", "func _ready() -> void:`n`tget_viewport().scaling_3d_scale = $Stress`n") | Set-Content $mf -NoNewline
  $Extra = ("$Extra --scale=$Stress --noadapt").Trim()
}
& $Godot --headless --path (Join-Path $old "godot") --import 2>&1 | Out-Null
$api = "http://localhost:8000/api/race"

function Measure-One([string]$proj, [string]$cam, [string[]]$userArgs) {
  Invoke-RestMethod -Method Post -Uri "$api/reset" -ContentType "application/json" -Body "{}" | Out-Null
  Invoke-RestMethod -Method Post -Uri "$api/speed" -ContentType "application/json" -Body "{""speed"":1}" | Out-Null
  Invoke-RestMethod -Method Post -Uri "$api/start" | Out-Null
  $out = Join-Path $env:TEMP "godot_cmp.txt"
  if (Test-Path $out) { Remove-Item $out }
  $argv = @("--path", $proj, "--print-fps", "--disable-vsync", "--resolution", "1600x900", "--") + $userArgs + @("--cam=$cam")
  $p = Start-Process $Godot -ArgumentList $argv -PassThru -RedirectStandardOutput $out
  Start-Sleep $Seconds
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  $vals = @()
  foreach ($line in (Get-Content $out)) {
    $m = [regex]::Match($line, "Project FPS: ([0-9]+)")
    if ($m.Success) { $vals += [int]$m.Groups[1].Value }
  }
  $vals = $vals | Select-Object -Skip 6
  $st = $vals | Measure-Object -Average -Minimum
  return ("avg {0,4:N0}  min {1,4}  ({2} s)" -f $st.Average, $st.Minimum, $st.Count)
}

foreach ($cam in ($Cams -split ",")) {
  $new = @(); if ($Extra) { $new = $Extra -split " " }
  "{0,-6} BEFORE ({1}): {2}" -f $cam, $Rev, (Measure-One (Join-Path $old "godot") $cam @())
  "{0,-6} AFTER  (tree):  {1}" -f $cam, (Measure-One (Join-Path $root "godot") $cam $new)
}
