extends Node
## Measures the renderer's own CPU and GPU time per frame (independent of vsync and of what limits the frame rate),
## prints one PROBE line after ~500 frames and quits. Used by scripts/godot_compare.ps1 on both old and new builds.

var _frames := 0
var _n := 0
var _gpu := 0.0
var _cpu := 0.0
var _wall := 0.0
var _draws := 0


func _ready() -> void:
	RenderingServer.viewport_set_measure_render_time(get_tree().root.get_viewport_rid(), true)


func _process(dt: float) -> void:
	_frames += 1
	if _frames < 220:
		return
	var rid := get_tree().root.get_viewport_rid()
	_gpu += RenderingServer.viewport_get_measured_render_time_gpu(rid)
	_cpu += RenderingServer.viewport_get_measured_render_time_cpu(rid)
	_draws = int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
	_wall += dt
	_n += 1
	if _n >= 400:
		print("PROBE gpu_ms=%.2f cpu_render_ms=%.2f frame_ms=%.2f fps=%.0f draws=%d" % [_gpu / _n, _cpu / _n, _wall / _n * 1000.0, _n / _wall, _draws])
		get_tree().quit()
