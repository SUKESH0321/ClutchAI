# Before/after render cost of the Godot client: renderer CPU + GPU milliseconds per frame (vsync off) for the committed
# revision vs the working tree, on three cameras. Backend must be running.
#   powershell -ExecutionPolicy Bypass -File scripts\godot_probe.ps1 [-Rev HEAD] [-Quality high] [-Cams orbit,chase,top]
param([string]$Rev = "HEAD", [string]$Quality = "", [string]$Cams = "orbit,chase,top",
      [string]$Godot = "C:\Users\Sukesh\Develop\Godot_4.6.3\Godot_v4.6.3-stable_win64_console.exe")
$root = Split-Path -Parent $PSScriptRoot
$old = Join-Path $env:TEMP "godot_old_tree"
if (Test-Path $old) { Remove-Item -Recurse -Force $old }
New-Item -ItemType Directory -Path $old | Out-Null
Push-Location $root
git archive --format=zip -o (Join-Path $old "tree.zip") $Rev godot
Pop-Location
Expand-Archive -Path (Join-Path $old "tree.zip") -DestinationPath $old -Force
$oldProj = Join-Path $old "godot"
Copy-Item (Join-Path $root "godot\tools\gpu_probe.gd") (Join-Path $oldProj "scripts\gpu_probe.gd")
$pg = Join-Path $oldProj "project.godot"
(Get-Content $pg -Raw).Replace('Backend="*res://scripts/backend.gd"', "Backend=""*res://scripts/backend.gd""`nProbe=""*res://scripts/gpu_probe.gd""") | Set-Content $pg -NoNewline
& $Godot --headless --path $oldProj --import 2>&1 | Out-Null
$api = "http://localhost:8000/api/race"
function Probe([string]$proj, [string]$cam, [string[]]$userArgs) {
  Invoke-RestMethod -Method Post -Uri "$api/reset" -ContentType "application/json" -Body "{}" | Out-Null
  Invoke-RestMethod -Method Post -Uri "$api/speed" -ContentType "application/json" -Body "{""speed"":1}" | Out-Null
  Invoke-RestMethod -Method Post -Uri "$api/start" | Out-Null
  $argv = @("--path", $proj, "--disable-vsync", "--resolution", "1600x900", "--") + $userArgs + @("--cam=$cam")
  $out = & $Godot @argv 2>&1 | Out-String
  $l = ($out -split "`n") | Where-Object { $_ -like "PROBE*" } | Select-Object -First 1
  if ($l) { return $l.Trim() } else { return "(no probe output)" }
}
foreach ($cam in ($Cams -split ",")) {
  $new = @("--probe", "--noadapt"); if ($Quality) { $new += "--quality=$Quality" }
  "{0,-6} BEFORE ({1}): {2}" -f $cam, $Rev, (Probe $oldProj $cam @())
  "{0,-6} AFTER  (tree):  {1}" -f $cam, (Probe (Join-Path $root "godot") $cam $new)
}
