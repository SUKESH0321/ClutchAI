extends Node3D
## Impossible Pit Stop 3D: native Godot client. All race state comes from the Python backend;
## this scene only turns authoritative lap timing into motion (see race_clock.gd).

enum Cam { CHASE, BROADCAST, TOP, ORBIT, HOOD }
const CAM_NAMES := ["Chase", "Broadcast", "Top-down", "Orbit", "Hood"]

const SECONDARY := ["#1d1f26", "#f1f1ee", "#2a2f3a", "#e8e3da", "#16181d", "#d9dde3", "#222630", "#f4efe6"]

signal camera_mode_changed(mode: int)
signal selection_changed(car_id: String)

var circuit: Circuit
var circuit_id: String = "silverstone"
var world: World
var clock := RaceClock.new()
var state: Dictionary = {}
var cars: Dictionary = {}            # id -> CarView
var ghost: CarView
var safety_car: CarView
var opts_cache: Dictionary = {}      # id -> placement options
var poses: Dictionary = {}           # id -> {x,y,tx,ty,place}
var selected_id: String = ""
var primary_id: String = ""

var cam: Camera3D
var cam_mode: int = Cam.ORBIT
var hud: Hud

# camera state
var _orbit_yaw: float = 0.35
var _orbit_pitch: float = -0.95
var _orbit_dist: float = 1750.0
var _top_height: float = 3300.0
var _spot: Vector3 = Vector3.ZERO
var _spot_valid: bool = false
var _bcast_spots: Array = []
var _center: Vector3 = Vector3.ZERO
var _dragging: bool = false
var _time: float = 0.0
var _wet: float = 0.0
var _sc_on: bool = false
var _drawer_shift: float = 0.0       # screen-space shift while the console is open (0..1)

# screenshot / verification options
var _shot_path: String = ""
var _shot_frames: int = 0
var _no_ghost: bool = false
var _burst_prefix: String = ""
var _burst_every: int = 20
var _burst_count: int = 0
var _force_wet: float = -1.0
var _frame: int = 0
var _dt: float = 0.016
var _dyn: Dictionary = {}            # id -> {x, y, t, v, b}: per-car motion for wheels and brake lights
var _bl_cache: Array = []            # baseline laps, rebuilt only when a new state arrives
var _last_fov: float = -1.0
var _applied_wet: float = -1.0
var quality_level: String = ""
var _auto_dropped: bool = false
var _fps_ema: float = 60.0
var _slow_s: float = 0.0
var _scale_lock: float = 0.0
var _fps_label: Label
var _fps_text_t: float = 0.0
var _bench_s: float = 0.0
var _bench_acc: Array = []
var _bench_t: float = 0.0
var _forced_quality: String = ""
var _no_adapt: bool = false


func _ready() -> void:
	circuit_id = str(Backend.state.get("circuit_id", "silverstone"))
	if not FileAccess.file_exists("res://data/%s.json" % circuit_id):
		circuit_id = "silverstone"
	circuit = Circuit.load_from("res://data/%s.json" % circuit_id)
	world = World.new()
	add_child(world)
	world.build(circuit)
	_compute_center()
	_make_broadcast_spots()

	cam = Camera3D.new()
	cam.fov = 45.0
	cam.near = 0.5
	cam.far = 9000.0
	cam.current = true
	add_child(cam)
	_apply_orbit(1.0)

	hud = Hud.new()
	add_child(hud)
	hud.bind(self)

	Backend.state_received.connect(_on_state)
	if not Backend.state.is_empty():
		_on_state(Backend.state)
	_parse_args()
	_make_fps_label()
	apply_quality(_forced_quality if _forced_quality != "" else Quality.default_level())


func _make_fps_label() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 60
	add_child(layer)
	_fps_label = Label.new()
	_fps_label.anchor_left = 1.0
	_fps_label.anchor_right = 1.0
	_fps_label.anchor_top = 1.0
	_fps_label.anchor_bottom = 1.0
	_fps_label.offset_left = -330.0
	_fps_label.offset_right = -12.0
	_fps_label.offset_top = -26.0
	_fps_label.offset_bottom = -6.0
	_fps_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_fps_label.add_theme_font_size_override("font_size", 12)
	_fps_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.55))
	_fps_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(_fps_label)


## Apply a quality preset to the viewport, the world and every car.
func apply_quality(level: String) -> void:
	if not Quality.PRESETS.has(level):
		return
	quality_level = level
	var P: Dictionary = Quality.PRESETS[level]
	var vp := get_viewport()
	vp.msaa_3d = Quality.msaa_enum(int(P["msaa"]))
	_scale_lock = 6.0
	world.apply_quality(P)
	for cv in _all_car_views():
		cv.set_quality(float(P["lod_m"]), bool(P["car_shadows"]))


func _all_car_views() -> Array:
	var out: Array = cars.values()
	if ghost != null:
		out.append(ghost)
	if safety_car != null:
		out.append(safety_car)
	return out


## Automatic quality: when the frame rate stays well under the display refresh, step down one preset (shadows, glow,
## MSAA, tree count and car detail all drop). It never steps back up on its own (that would oscillate); press Q to raise it.
## (The Compatibility renderer ignores 3D render-scale, so presets are the real lever.)
func _adapt_quality(dt: float) -> void:
	_fps_ema = lerpf(_fps_ema, 1.0 / maxf(dt, 1e-4), 1.0 - exp(-2.0 * dt))
	_scale_lock = maxf(0.0, _scale_lock - dt)
	var target := minf(maxf(30.0, DisplayServer.screen_get_refresh_rate()), 90.0)
	if _fps_ema < target * 0.8 and _scale_lock <= 0.0:
		_slow_s += dt
	else:
		_slow_s = 0.0
	if _slow_s > 3.0:
		var qi: int = Quality.LEVELS.find(quality_level)
		if qi > 0:
			apply_quality(Quality.LEVELS[qi - 1])
			_auto_dropped = true
		_slow_s = 0.0
		_scale_lock = 10.0


func _update_fps_label(dt: float) -> void:
	_fps_text_t += dt
	if _fps_text_t < 0.5 or _fps_label == null:
		return
	_fps_text_t = 0.0
	_fps_label.text = "%d fps  |  %s%s  |  Q: quality" % [int(round(Engine.get_frames_per_second())), quality_level.capitalize(), " (auto)" if _auto_dropped else ""]


func _bench_step(dt: float) -> void:
	if _bench_s <= 0.0 or _frame < 150:
		return
	_bench_t += dt
	_bench_acc.append(dt)
	if _bench_t >= _bench_s:
		var n := _bench_acc.size()
		var sum := 0.0
		var worst := 0.0
		for d in _bench_acc:
			sum += float(d)
			worst = maxf(worst, float(d))
		print("BENCH quality=%s avg_fps=%.0f worst_frame_ms=%.1f draws=%d objects=%d primitives=%d" % [
			quality_level, n / sum, worst * 1000.0,
			int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
			int(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)),
			int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME))])
		get_tree().quit()


func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			_shot_path = a.substr(7)
		elif a.begins_with("--shot-frames="):
			_shot_frames = int(a.substr(14))
		elif a.begins_with("--cam="):
			var idx := ["chase", "broadcast", "top", "orbit", "hood"].find(a.substr(6))
			if idx >= 0:
				set_camera_mode(idx)
		elif a.begins_with("--burst="):
			_burst_prefix = a.substr(8)
		elif a.begins_with("--burst-every="):
			_burst_every = int(a.substr(14))
		elif a.begins_with("--wet="):
			_force_wet = float(a.substr(6))
		elif a.begins_with("--quality="):
			_forced_quality = a.substr(10)
		elif a.begins_with("--bench="):
			_bench_s = float(a.substr(8))
		elif a == "--noadapt":
			_no_adapt = true
		elif a == "--probe":
			add_child(load("res://tools/gpu_probe.gd").new())
		elif a == "--novsync":
			DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		elif a.begins_with("--res="):
			var wh := a.substr(6).split("x")
			if wh.size() == 2:
				DisplayServer.window_set_size(Vector2i(int(wh[0]), int(wh[1])))
		elif a == "--noghost":
			_no_ghost = true
		elif a.begins_with("--select="):
			selected_id = a.substr(9)
		elif a.begins_with("--console"):
			hud.open_console(true)
		elif a.begins_with("--tab="):
			hud.set_tab(int(a.substr(6)))


func _compute_center() -> void:
	var minx := 1e9
	var maxx := -1e9
	var miny := 1e9
	var maxy := -1e9
	for i in circuit.n:
		minx = minf(minx, circuit.x[i]); maxx = maxf(maxx, circuit.x[i])
		miny = minf(miny, circuit.y[i]); maxy = maxf(maxy, circuit.y[i])
	_center = Vector3((minx + maxx) * 0.5, 0.0, -(miny + maxy) * 0.5)


func _make_broadcast_spots() -> void:
	# Trackside TV positions on the outside of the circuit, kept clear of the pit complex and the
	# grandstands (which sit near the start straight and the landmark corners).
	var avoid: Array = [0]
	for l in circuit.data["landmarks"]:
		avoid.append(int(l["index"]))
	var i := 60
	while i < circuit.n:
		var blocked := false
		for a in avoid:
			var d := absi(i - int(a))
			d = mini(d, circuit.n - d)
			if d < 34:
				blocked = true
		if not blocked:
			var nx := -circuit.ty[i]
			var ny := circuit.tx[i]
			var to_c := Vector2(_center.x - circuit.x[i], -_center.z - circuit.y[i])
			var side := -1.0 if to_c.dot(Vector2(nx, ny)) > 0.0 else 1.0
			var off := (circuit.hl[i] if side > 0.0 else circuit.hr[i]) + 44.0
			_bcast_spots.append(Vector3(circuit.x[i] + nx * side * off, 7.0, -(circuit.y[i] + ny * side * off)))
		i += 36


# ------------------------------------------------------------------ state from backend
func _on_state(s: Dictionary) -> void:
	# the backend owns the selected circuit: when it changes (selected in the web app), rebuild the whole scene for it
	var cid := str(s.get("circuit_id", circuit_id))
	if cid != circuit_id and FileAccess.file_exists("res://data/%s.json" % cid):
		get_tree().reload_current_scene.call_deferred()
		return
	state = s
	clock.update(s)
	_bl_cache = RaceClock.baseline_laps(s)
	_ensure_cars(s)
	if hud:
		hud.on_state(s)


func _ensure_cars(s: Dictionary) -> void:
	var list: Array = s.get("cars", [])
	if list.size() != cars.size():
		for c in cars.values():
			c.queue_free()
		cars.clear()
		opts_cache.clear()
		var rival_i := 0
		for car in list:
			var cv := CarView.new()
			var second := Color("#14161b")
			if not bool(car["is_primary"]):
				second = Color(SECONDARY[rival_i % SECONDARY.size()])
				rival_i += 1
			cv.setup(str(car["id"]), "f1", Color(str(car["color"])), str(car["code"]), bool(car["is_primary"]), false, second)
			add_child(cv)
			cars[str(car["id"])] = cv
			if bool(car["is_primary"]):
				primary_id = str(car["id"])
		if selected_id == "" or not cars.has(selected_id):
			selected_id = primary_id
		if ghost == null:
			ghost = CarView.new()
			ghost.setup("ghost", "f1", Color.WHITE, "BASE", false, true)
			add_child(ghost)
			safety_car = CarView.new()
			safety_car.setup("sc", "raceCarOrange", Color("#ffb020"), "SC", false)
			add_child(safety_car)
			safety_car.visible = false
		selection_changed.emit(selected_id)
		if quality_level != "":
			apply_quality(quality_level)
	var ratio: float = float(s.get("pit_service_ratio", 0.8))
	var idx := 0
	for car in list:
		opts_cache[str(car["id"])] = RaceClock.opts_for(circuit, ratio, int(car["grid_slot"]), idx)
		idx += 1
	opts_cache["__ghost"] = RaceClock.opts_for(circuit, ratio, 5, 0)
	# after the flag each car coasts to its own stopping point, winner furthest on
	var order: Array = list.duplicate()
	order.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a["elapsed_s"]) < float(b["elapsed_s"]))
	for r in order.size():
		opts_cache[str(order[r]["id"])]["roll_cap"] = 0.085 - 0.0085 * r


# ------------------------------------------------------------------ per frame
func _process(dt: float) -> void:
	_time += dt
	_frame += 1
	_dt = dt
	if not state.is_empty() and not cars.is_empty():
		_update_cars()
	_update_camera(dt)
	_update_effects()
	world.update_shadow_for_camera(cam.global_position.y)
	if _bench_s <= 0.0 and not _no_adapt:
		_adapt_quality(dt)
	_update_fps_label(dt)
	_bench_step(dt)
	if _burst_prefix != "" and _frame % _burst_every == 0:
		var pp: Variant = poses.get(primary_id)
		var kind: String = str(pp["place"]["kind"]) if pp != null else "?"
		var stopped: bool = bool(pp["place"]["stopped"]) if pp != null else false
		get_viewport().get_texture().get_image().save_png("%s_%02d.png" % [_burst_prefix, _burst_count])
		print("burst %02d frame=%d lap=%s pit=%s stopped=%s wet=%.2f sc=%s" % [_burst_count, _frame, str(state.get("lap")), kind, str(stopped), _wet, str(_sc_on)])
		_burst_count += 1
		if _burst_count >= int(_shot_frames):
			get_tree().quit()
	if _shot_path != "" and _frame >= _shot_frames and _burst_prefix == "":
		var img := get_viewport().get_texture().get_image()
		img.save_png(_shot_path)
		for id in cars:
			var cvv: CarView = cars[id]
			print("car %s color=%s pos=(%.1f, %.1f) dist_to_cam=%.1f" % [id, cvv.team_color.to_html(false), cvv.position.x, cvv.position.z, cvv.position.distance_to(cam.global_position)])
		if ghost:
			print("ghost visible=", ghost.visible, " pos=", ghost.position)
		print("selected=", selected_id, " cam=", cam.global_position)
		print("status=", state.get("status"), " lap=", state.get("lap"), " clock=", clock.now(), " ncars=", state.get("cars", []).size())
		for id2 in poses:
			print("  pose ", id2, " total=", poses[id2]["place"]["total"], " frac=", poses[id2]["place"]["frac"], " opts.grid=", opts_cache[id2]["grid_frac"])
		print("saved screenshot ", _shot_path)
		get_tree().quit()


func _update_cars() -> void:
	var t := clock.now()
	var leader_total := -1e9
	var list: Array = state["cars"]
	for car in list:
		var id := str(car["id"])
		var cv: CarView = cars[id]
		var place := RaceClock.place_car(car["laps"], t, opts_cache[id])
		var pose := RaceClock.pose_of(circuit, place)
		leader_total = maxf(leader_total, float(place["total"]))
		var lateral := 0.0
		if place["kind"] == "track" and float(place["total"]) < 0.012:
			var slot := int(car["grid_slot"])
			lateral = (3.2 if slot % 2 == 1 else -3.2) * clampf(1.0 - maxf(0.0, float(place["total"])) / 0.012, 0.0, 1.0)
		cv.apply_pose(pose, lateral)
		cv.set_selected(id == selected_id)
		# wheel spin / steering / brake lights from the car's real motion (distance and speed in race time)
		var px := float(pose["x"])
		var py := float(pose["y"])
		var dyn: Variant = _dyn.get(id)
		var ds := 0.0
		var brake := 0.0
		if dyn == null:
			_dyn[id] = {"x": px, "y": py, "t": t, "v": 0.0, "b": 0.0}
		else:
			var dtr: float = t - float(dyn["t"])
			ds = sqrt((px - float(dyn["x"])) ** 2 + (py - float(dyn["y"])) ** 2)
			if ds > 40.0 or dtr < 0.0:
				ds = 0.0
			if dtr > 1e-4:
				var v := ds / dtr
				var dec := (float(dyn["v"]) - v) / dtr
				dyn["b"] = float(dyn["b"]) + (clampf(dec / 20.0, 0.0, 1.0) - float(dyn["b"])) * minf(1.0, _dt * 10.0)
				dyn["v"] = lerpf(float(dyn["v"]), v, minf(1.0, _dt * 8.0))
			else:
				dyn["v"] = float(dyn["v"]) * exp(-_dt * 5.0)
				dyn["b"] = float(dyn["b"]) * exp(-_dt * 8.0)
			dyn["x"] = px
			dyn["y"] = py
			dyn["t"] = t
			brake = float(dyn["b"])
		var kap := 0.0
		if place["kind"] == "track":
			kap = circuit.kappa[int(round(float(place["frac"]) * circuit.n)) % circuit.n]
		cv.animate(_dt, ds, kap, brake, cam.global_position)
		pose["place"] = place
		pose["lateral"] = lateral
		poses[id] = pose
	# baseline shadow car
	if state.get("baseline") != null and ghost != null and not _no_ghost:
		var gp := RaceClock.place_car(_bl_cache, t, opts_cache["__ghost"])
		var gpose := RaceClock.pose_of(circuit, gp)
		ghost.apply_pose(gpose)
		ghost.animate(_dt, 0.0, 0.0, 0.0, cam.global_position)
		ghost.position.y = 0.3
		ghost.visible = true
	elif ghost != null:
		ghost.visible = false

	# visual weather / safety-car state from the lap currently on screen
	var prim: Dictionary = {}
	for car in list:
		if bool(car["is_primary"]):
			prim = car
	var laps: Array = state.get("laps", [])
	if not prim.is_empty() and laps.size() > 0:
		var plaps: Array = prim["laps"]
		var lo := 0
		var hi := plaps.size()
		while lo < hi:
			var mid := (lo + hi) >> 1
			if float(plaps[mid]["elapsed_s"]) > t:
				hi = mid
			else:
				lo = mid + 1
		var rec: Dictionary = laps[mini(lo, laps.size() - 1)]
		_wet = float(rec["wetness"])
		_sc_on = bool(rec["safety_car"]) and (state.get("status") == "running" or t < float(plaps[mini(lo, plaps.size() - 1)]["elapsed_s"]))
	else:
		_wet = float(state.get("conditions", {}).get("track_wetness", 0.0))
		_sc_on = false

	if safety_car != null:
		safety_car.visible = _sc_on
		if _sc_on:
			var lf := fposmod(leader_total, 1.0)
			safety_car.apply_pose(circuit.point_at(lf + 140.0 / circuit.length))

	# pit highlight: proposal vs execution
	var pit_mode := 0
	var pp: Variant = poses.get(primary_id)
	if pp != null and pp["place"]["kind"] == "pit":
		pit_mode = 2
	else:
		var r: Variant = state.get("recommendation")
		if typeof(r) == TYPE_DICTIONARY and r["action"] == "BOX_THIS_LAP" and state.get("status") != "finished":
			pit_mode = 1
	world.set_pit_highlight(pit_mode, _time)


func _update_effects() -> void:
	if absf(cam.fov - _last_fov) > 0.05:
		_last_fov = cam.fov
		world.scale_labels(cam.fov)
		for cv in cars.values():
			(cv as CarView).scale_label(cam.fov)
	if _force_wet >= 0.0:
		_wet = _force_wet
	world.set_wetness(_wet)
	world.set_safety_car(_sc_on, _time)
	if absf(_wet - _applied_wet) > 0.002:
		_applied_wet = _wet
		hud.set_rain(clampf((_wet - 0.05) * 1.4, 0.0, 1.0))
		# dim and cool the light a little in the wet
		world.sun.light_energy = lerpf(0.95, 0.55, clampf(_wet, 0.0, 1.0))
		world.env.fog_density = lerpf(0.00007, 0.0003, clampf(_wet, 0.0, 1.0))


# ------------------------------------------------------------------ cameras
func set_camera_mode(m: int) -> void:
	cam_mode = m
	_spot_valid = false
	camera_mode_changed.emit(m)


func cycle_selection(dir: int) -> void:
	var ids: Array = cars.keys()
	if ids.is_empty():
		return
	var i := ids.find(selected_id)
	selected_id = ids[(i + dir + ids.size()) % ids.size()]
	selection_changed.emit(selected_id)


func select_car(id: String) -> void:
	if cars.has(id):
		selected_id = id
		selection_changed.emit(id)


func set_drawer_open(open: bool) -> void:
	_drawer_shift = 1.0 if open else 0.0


func _update_camera(dt: float) -> void:
	var tgt: Variant = poses.get(selected_id)
	var k := 1.0 - exp(-6.0 * dt)
	match cam_mode:
		Cam.ORBIT:
			_apply_orbit(k)
		Cam.TOP:
			var want := Vector3(_center.x, _top_height, _center.z + 1.0)
			cam.global_position = cam.global_position.lerp(want, k)
			cam.look_at(Vector3(want.x, 0, want.z - 0.01), Vector3(0, 0, -1))
			cam.fov = lerpf(cam.fov, 40.0, k)
		Cam.CHASE, Cam.HOOD:
			if tgt == null:
				return
			var p := Vector3(tgt["x"], 0.0, -float(tgt["y"]))
			var fwd := Vector3(tgt["tx"], 0.0, -float(tgt["ty"])).normalized()
			var want := p - fwd * 17.0 + Vector3.UP * 6.2
			var look := p + fwd * 20.0 + Vector3.UP * 1.0
			var fov := 62.0
			if cam_mode == Cam.HOOD:
				want = p + fwd * 1.0 + Vector3.UP * 1.45
				look = p + fwd * 40.0 + Vector3.UP * 1.0
				fov = 82.0
			cam.global_position = cam.global_position.lerp(want, 1.0 - exp(-9.0 * dt))
			cam.look_at(cam.global_position + (look - cam.global_position).normalized(), Vector3.UP)
			cam.fov = lerpf(cam.fov, fov, k)
		Cam.BROADCAST:
			if tgt == null:
				return
			var p2 := Vector3(tgt["x"], 1.0, -float(tgt["y"]))
			if not _spot_valid or _spot.distance_to(p2) > 230.0:
				var best := 1e18
				for s in _bcast_spots:
					var d := (s as Vector3).distance_to(p2)
					if d < best and d > 45.0:
						best = d
						_spot = s
				_spot_valid = true
			cam.global_position = cam.global_position.lerp(_spot, 1.0 - exp(-3.0 * dt))
			var dist := maxf(30.0, _spot.distance_to(p2))
			var fov2 := clampf(rad_to_deg(2.0 * atan(10.0 / dist)), 3.0, 40.0)
			cam.fov = lerpf(cam.fov, fov2, 1.0 - exp(-5.0 * dt))
			cam.look_at(p2, Vector3.UP)
	# keep the circuit clear of the console: nudge the view while it is open
	cam.h_offset = 0.0
	cam.v_offset = lerpf(cam.v_offset, -0.18 * _drawer_shift * _view_scale(), 1.0 - exp(-6.0 * dt))


func _view_scale() -> float:
	return 1.0 if cam_mode == Cam.TOP or cam_mode == Cam.ORBIT else 0.4


func _apply_orbit(k: float) -> void:
	var rot := Basis.from_euler(Vector3(_orbit_pitch, _orbit_yaw, 0.0))
	var want := _center + rot * Vector3(0, 0, _orbit_dist)
	cam.global_position = cam.global_position.lerp(want, k)
	cam.look_at(_center, Vector3.UP)
	cam.fov = lerpf(cam.fov, 45.0, k)


func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseButton:
		var mb := e as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_dragging = mb.pressed
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			_zoom(0.9)
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_zoom(1.1)
	elif e is InputEventMouseMotion and _dragging:
		var mm := e as InputEventMouseMotion
		if cam_mode == Cam.ORBIT:
			_orbit_yaw -= mm.relative.x * 0.005
			_orbit_pitch = clampf(_orbit_pitch - mm.relative.y * 0.004, -1.5, -0.12)
	elif e is InputEventKey and (e as InputEventKey).pressed and not (e as InputEventKey).echo:
		var key := (e as InputEventKey).keycode
		match key:
			KEY_1: set_camera_mode(Cam.CHASE)
			KEY_2: set_camera_mode(Cam.BROADCAST)
			KEY_3: set_camera_mode(Cam.TOP)
			KEY_4: set_camera_mode(Cam.ORBIT)
			KEY_5: set_camera_mode(Cam.HOOD)
			KEY_TAB: cycle_selection(1)
			KEY_Q:
				var qi: int = (Quality.LEVELS.find(quality_level) + 1) % Quality.LEVELS.size()
				apply_quality(Quality.LEVELS[qi])
			KEY_C: hud.open_console(not hud.console_open)
			KEY_SPACE:
				if state.get("status") == "idle": Backend.start()
				elif state.get("status") == "running": Backend.pause()
				elif state.get("status") == "paused": Backend.resume()
			KEY_N: Backend.step()
			KEY_R: Backend.reset(str(state.get("config_name", "demo")))
			KEY_ESCAPE: hud.open_console(false)


func _zoom(f: float) -> void:
	match cam_mode:
		Cam.ORBIT: _orbit_dist = clampf(_orbit_dist * f, 150.0, 5000.0)
		Cam.TOP: _top_height = clampf(_top_height * f, 300.0, 5500.0)
