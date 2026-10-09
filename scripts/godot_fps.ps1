# Measures the Godot client's frame rate with vsync OFF on a live race (backend must be running).
#   powershell -ExecutionPolicy Bypass -File scripts\godot_fps.ps1 -Tag after [-Seconds 28] [-Extra "--quality","low"]
param([string]$Tag = "run", [int]$Seconds = 28, [string[]]$Extra = @(), [int]$Speed = 1,
      [string]$Godot = "C:\Users\Sukesh\Develop\Godot_4.6.3\Godot_v4.6.3-stable_win64_console.exe")
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $env:TEMP "godot_fps_$Tag.txt"
if (Test-Path $out) { Remove-Item $out }
$api = "http://localhost:8000/api/race"
Invoke-RestMethod -Method Post -Uri "$api/reset" -ContentType "application/json" -Body "{}" | Out-Null
Invoke-RestMethod -Method Post -Uri "$api/speed" -ContentType "application/json" -Body ("{""speed"":" + $Speed + "}") | Out-Null
Invoke-RestMethod -Method Post -Uri "$api/start" | Out-Null
$argv = @("--path", (Join-Path $root "godot"), "--print-fps", "--disable-vsync", "--resolution", "1600x900") + $Extra
$p = Start-Process $Godot -ArgumentList $argv -PassThru -RedirectStandardOutput $out
Start-Sleep $Seconds
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
$vals = @()
foreach ($line in (Get-Content $out)) {
  $m = [regex]::Match($line, "Project FPS: ([0-9]+)")
  if ($m.Success) { $vals += [int]$m.Groups[1].Value }
}
$vals = $vals | Select-Object -Skip 8      # skip load / warm-up
$st = $vals | Measure-Object -Average -Minimum -Maximum
"{0}: avg {1:N0} fps  min {2}  max {3}  ({4} samples)" -f $Tag, $st.Average, $st.Minimum, $st.Maximum, $st.Count
