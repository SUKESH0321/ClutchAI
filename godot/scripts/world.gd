class_name World
extends Node3D
## Builds the 3D circuit: real Silverstone geometry (road, kerbs, gravel, runoff, pit lane) from
## Circuit, dressed with CC0 Kenney models (trees, grandstands, barriers, garages, gantry, flags).

const MAROON_FOG := Color("#4a141c")
const RED := Color("#d9232d")
const WHITE := Color("#f2f2f2")

var circuit: Circuit
var sun: DirectionalLight3D
var env: Environment
var road_mat: StandardMaterial3D
var pit_glow_mat: StandardMaterial3D
var sc_glow_mat: StandardMaterial3D
var _rng := RandomNumberGenerator.new()
var _label_nodes: Array = []     # [Label3D, base pixel_size]
var _corner_label_nodes: Array = []
var _tree_nodes: Array = []
var _prop_nodes: Array = []
var _shadow_pref: bool = true
var _applied_wet: float = -1.0
var _label_k: float = -1.0


func build(c: Circuit) -> void:
	circuit = c
	_rng.seed = 20261009
	_environment()
	_ground()
	_track_surfaces()
	_corner_details()
	_pit_complex()
	_start_line()
	_scenery()
	_labels()
	for ch in get_children():
		if ch is MultiMeshInstance3D:
			(_tree_nodes if str(ch.name).begins_with("trees_") else _prop_nodes).append(ch)


# ------------------------------------------------------------------ environment
func _environment() -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color("#2b0b1c")
	sky_mat.sky_horizon_color = Color("#d4573f")
	sky_mat.sky_curve = 0.22
	sky_mat.ground_horizon_color = Color("#6b2a30")
	sky_mat.ground_bottom_color = Color("#2a0a10")
	sky_mat.sun_angle_max = 25.0
	sky_mat.sun_curve = 0.12
	var sky := Sky.new()
	sky.sky_material = sky_mat
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("#d9c9c6")
	env.ambient_light_energy = 0.46
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 0.82
	env.glow_enabled = true
	env.glow_intensity = 0.2
	env.glow_bloom = 0.02
	env.fog_enabled = true
	env.fog_light_color = MAROON_FOG
	env.fog_density = 0.00007
	env.fog_sky_affect = 0.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-24.0, -58.0, 0.0)
	sun.light_color = Color("#ffe3c8")
	sun.light_energy = 0.95
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 1400.0
	sun.shadow_bias = 0.06
	add_child(sun)


# ------------------------------------------------------------------ textures / materials
func _noise_tex(base: Color, var_amt: float, speck: Color, speck_p: float, size: int = 256) -> ImageTexture:
	var img := Image.create(size, size, true, Image.FORMAT_RGB8)
	var r := RandomNumberGenerator.new()
	r.seed = 77
	for yy in size:
		for xx in size:
			var v := 1.0 + (r.randf() - 0.5) * 2.0 * var_amt
			var col := Color(base.r * v, base.g * v, base.b * v)
			if r.randf() < speck_p:
				col = col.lerp(speck, 0.5)
			img.set_pixel(xx, yy, col)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func _mat(color: Color, tex: Texture2D = null, rough: float = 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	if tex != null:
		m.albedo_texture = tex
		m.texture_repeat = true
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	m.roughness = rough
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


func _unshaded(color: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


func _mesh_node(mesh: Mesh, mat: Material, shadow: bool = false) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadow else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	return mi


func _merge(meshes: Array) -> ArrayMesh:
	var st := SurfaceTool.new()
	for m in meshes:
		st.append_from(m, 0, Transform3D.IDENTITY)
	return st.commit()


# ------------------------------------------------------------------ ground and track
func _ground() -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(9000, 9000)
	var g := _mat(Color.WHITE, _noise_tex(Color("#6a9a4c"), 0.14, Color("#86b35c"), 0.16), 1.0)
	g.uv1_scale = Vector3(900, 900, 1)
	var mi := _mesh_node(plane, g)
	mi.position.y = -0.3

	# mown grass ribbon along the whole circuit
	var S := circuit.main_samples()
	var n := circuit.n
	var o0 := PackedFloat64Array()
	var o1 := PackedFloat64Array()
	for i in n:
		o0.append(-(circuit.hr[i] + 55.0))
		o1.append(circuit.hl[i] + 55.0)
	var mown := _mat(Color.WHITE, _noise_tex(Color("#70a050"), 0.1, Color("#86b560"), 0.1), 1.0)
	mown.uv1_scale = Vector3(1, 1, 1)
	_mesh_node(Circuit.strip(S, o0, o1, -0.1, true, PackedColorArray(), 10.0), mown)


func _track_surfaces() -> void:
	var S := circuit.main_samples()
	var n := circuit.n
	var left := PackedFloat64Array()
	var right := PackedFloat64Array()
	for i in n:
		left.append(circuit.hl[i])
		right.append(-circuit.hr[i])
	road_mat = _mat(Color.WHITE, _noise_tex(Color("#5b5e66"), 0.07, Color("#8a8c92"), 0.05), 0.92)
	_mesh_node(Circuit.strip(S, right, left, 0.05, true, PackedColorArray(), 12.0), road_mat)

	# white edge lines
	var l0 := PackedFloat64Array()
	var l1 := PackedFloat64Array()
	var r0 := PackedFloat64Array()
	var r1 := PackedFloat64Array()
	for i in n:
		l0.append(circuit.hl[i] - 0.5); l1.append(circuit.hl[i] - 0.15)
		r0.append(-circuit.hr[i] + 0.15); r1.append(-circuit.hr[i] + 0.5)
	var line_mat := _mat(Color("#ececec"), null, 0.8)
	_mesh_node(Circuit.strip(S, l0, l1, 0.07, true), line_mat)
	_mesh_node(Circuit.strip(S, r0, r1, 0.07, true), line_mat)

	# safety-car edge glow (amber, toggled by Main)
	var g0 := PackedFloat64Array()
	var g1 := PackedFloat64Array()
	for i in n:
		g0.append(circuit.hl[i] + 0.4); g1.append(circuit.hl[i] + 1.8)
	var g2 := PackedFloat64Array()
	var g3 := PackedFloat64Array()
	for i in n:
		g2.append(-circuit.hr[i] - 1.8); g3.append(-circuit.hr[i] - 0.4)
	sc_glow_mat = _unshaded(Color(1.0, 0.69, 0.13, 0.0))
	_mesh_node(_merge([Circuit.strip(S, g0, g1, 0.11, true), Circuit.strip(S, g2, g3, 0.11, true)]), sc_glow_mat)


func _corner_sub(k: Dictionary, ext: int) -> Dictionary:
	var n := circuit.n
	var start := int(k["start_index"])
	var end_ := int(k["end_index"])
	var cnt := ((end_ - start + n) % n) + 1 + ext * 2
	var ids: Array = []
	for j in cnt:
		ids.append((start - ext + j + n) % n)
	return {"ids": ids, "left": k["turn"] == "left"}


func _corner_details() -> void:
	var S := circuit.main_samples()
	var kerb_meshes: Array = []
	var gravel_meshes: Array = []
	var barrier_red: Array = []
	var barrier_white: Array = []
	for k in circuit.data["corners"]:
		var sub := _corner_sub(k, 6)
		var ids: Array = sub["ids"]
		var left: bool = sub["left"]
		var samples: Array = []
		var ko0 := PackedFloat64Array()
		var ko1 := PackedFloat64Array()
		var go0 := PackedFloat64Array()
		var go1 := PackedFloat64Array()
		var cols := PackedColorArray()
		for j in ids.size():
			var i: int = ids[j]
			samples.append(S[i])
			if left:
				ko0.append(circuit.hl[i]); ko1.append(circuit.hl[i] + 1.7)
				go0.append(-(circuit.hr[i] + 3.0)); go1.append(-(circuit.hr[i] + 22.0))
			else:
				ko0.append(-(circuit.hr[i] + 1.7)); ko1.append(-circuit.hr[i])
				go0.append(circuit.hl[i] + 3.0); go1.append(circuit.hl[i] + 22.0)
			cols.append(RED if (j / 2) % 2 == 0 else WHITE)
		kerb_meshes.append(Circuit.strip(samples, ko0, ko1, 0.09, false, cols, 3.0))
		gravel_meshes.append(Circuit.strip(samples, go0, go1, 0.03, false, PackedColorArray(), 6.0))
		# Kenney barriers on the outside of the corner
		for j in ids.size():
			var i2: int = ids[j]
			var off: float = -(circuit.hr[i2] + 25.0) if left else (circuit.hl[i2] + 25.0)
			var pose := {"x": circuit.x[i2], "y": circuit.y[i2], "tx": circuit.tx[i2], "ty": circuit.ty[i2]}
			var model := "barrierRed" if (j / 2) % 2 == 0 else "barrierWhite"
			var xf := Assets.instance_xf(model, _place(pose, off, 0.0, 0.0), Vector3(34, 9, 11))
			if model == "barrierRed":
				barrier_red.append(xf)
			else:
				barrier_white.append(xf)
	var kerb_mat := _mat(Color.WHITE, null, 0.65)
	kerb_mat.vertex_color_use_as_albedo = true
	_mesh_node(_merge(kerb_meshes), kerb_mat)
	_mesh_node(_merge(gravel_meshes), _mat(Color.WHITE, _noise_tex(Color("#b3a67f"), 0.18, Color("#8a7d5c"), 0.3), 1.0))
	add_child(Assets.multimesh("barrierRed", barrier_red))
	add_child(Assets.multimesh("barrierWhite", barrier_white))


# ------------------------------------------------------------------ placement helpers
## Transform at a track pose, lateral offset (+left), height, extra yaw. +X of the result points along travel.
func _place(p: Dictionary, lateral: float, height: float, yaw_extra: float) -> Transform3D:
	var nx := -float(p["ty"])
	var ny := float(p["tx"])
	var pos := Vector3(float(p["x"]) + nx * lateral, height, -(float(p["y"]) + ny * lateral))
	var yaw := atan2(float(p["ty"]), float(p["tx"])) + yaw_extra
	return Transform3D(Basis(Vector3.UP, yaw), pos)


## Transform whose local +Z faces the direction (vx, vz) in scene space.
func _facing_z(pos: Vector3, vx: float, vz: float) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, atan2(vx, vz)), pos)


# ------------------------------------------------------------------ pit lane
func _pit_complex() -> void:
	var P := circuit.pit_samples()
	var m := P.size()
	var a := PackedFloat64Array(); a.resize(m); a.fill(-5.0)
	var b := PackedFloat64Array(); b.resize(m); b.fill(5.0)
	_mesh_node(Circuit.strip(P, a, b, 0.06, false, PackedColorArray(), 8.0), _mat(Color.WHITE, _noise_tex(Color("#6f727a"), 0.06, Color("#92949a"), 0.04), 0.9))
	var a2 := PackedFloat64Array(); a2.resize(m); a2.fill(-4.5)
	var b2 := PackedFloat64Array(); b2.resize(m); b2.fill(4.5)
	pit_glow_mat = _unshaded(Color(1, 0.23, 0.28, 0.0))
	_mesh_node(Circuit.strip(P, a2, b2, 0.12, false), pit_glow_mat)

	# garages and offices from Kenney pieces, facing the pit lane
	var garages: Array = []
	var offices: Array = []
	for i in range(4, m - 4):
		var s: Array = P[i]
		var pose := {"x": s[0], "y": s[1], "tx": s[2], "ty": s[3]}
		var lateral := -19.0                       # right of the lane (infield side)
		var pos := _place(pose, lateral, 0.0, 0.0).origin
		var to_lane_x := float(-pose["ty"]) * 1.0  # left normal in map == toward the lane from the right side
		var to_lane_z := -float(pose["tx"])
		var xf := _facing_z(pos, to_lane_x, to_lane_z)
		if i == 4 or i == m - 5:
			offices.append(Assets.instance_xf("pitsOffice", xf, Vector3(10, 9, 10)))
		else:
			garages.append(Assets.instance_xf("pitsGarage", xf, Vector3(8.6, 9, 10)))
	add_child(Assets.multimesh("pitsGarage", garages))
	add_child(Assets.multimesh("pitsOffice", offices))

	# low wall between the lane and the track
	var wall_a: Array = []
	for i in range(0, m, 1):
		var s2: Array = P[i]
		var pose2 := {"x": s2[0], "y": s2[1], "tx": s2[2], "ty": s2[3]}
		wall_a.append(Assets.instance_xf("barrierWhite", _place(pose2, 7.5, 0.0, 0.0), Vector3(34, 8, 8)))
	add_child(Assets.multimesh("barrierWhite", wall_a))


func _start_line() -> void:
	var p := circuit.point_at(0.0)
	var w := circuit.hl[0] + circuit.hr[0]
	# chequered strip
	var img := Image.create(2, 16, false, Image.FORMAT_RGB8)
	for yy in 16:
		for xx in 2:
			img.set_pixel(xx, yy, Color("#f4f4f4") if (xx + yy) % 2 == 0 else Color("#0b0b0b"))
	var tex := ImageTexture.create_from_image(img)
	var quad := PlaneMesh.new()
	quad.size = Vector2(4.0, w)
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = tex
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	var mi := MeshInstance3D.new()
	mi.mesh = quad
	mi.material_override = mat
	mi.transform = _place(p, (circuit.hl[0] - circuit.hr[0]) * 0.5, 0.12, 0.0)
	add_child(mi)
	# Kenney overhead gantry across the track plus flags
	var nx_s := -float(p["ty"])
	var nz_s := -float(p["tx"])
	var centre := Vector3(float(p["x"]), 0.0, -float(p["y"]))
	var gantry := Assets.make("overhead", w + 16.0)
	gantry.transform = Transform3D(Basis(Vector3.UP, atan2(-nz_s, nx_s)), centre)
	gantry.scale = Vector3(1.0, 0.8, 1.0)
	add_child(gantry)
	for side in [-1.0, 1.0]:
		var flag := Assets.make("flagCheckers", 9.0, true)
		flag.position = centre + Vector3(nx_s, 0, nz_s) * side * (w * 0.5 + 6.0)
		add_child(flag)
	# sector lines
	for f in [1.0 / 3.0, 2.0 / 3.0]:
		var sp := circuit.point_at(f)
		var q := PlaneMesh.new()
		q.size = Vector2(1.2, w)
		var sm := StandardMaterial3D.new()
		sm.albedo_color = Color("#4fe0f7") if f < 0.5 else Color("#ffb020")
		sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		var smi := MeshInstance3D.new()
		smi.mesh = q
		smi.material_override = sm
		smi.transform = _place(sp, (circuit.hl[0] - circuit.hr[0]) * 0.5, 0.13, 0.0)
		add_child(smi)


# ------------------------------------------------------------------ scenery
func _scenery() -> void:
	# trees, kept clear of the circuit
	var minx := 1e9
	var maxx := -1e9
	var miny := 1e9
	var maxy := -1e9
	for i in circuit.n:
		minx = minf(minx, circuit.x[i]); maxx = maxf(maxx, circuit.x[i])
		miny = minf(miny, circuit.y[i]); maxy = maxf(maxy, circuit.y[i])
	var large: Array = []
	var small: Array = []
	var tries := 0
	while large.size() + small.size() < 700 and tries < 6000:
		tries += 1
		var px := minx - 450.0 + _rng.randf() * (maxx - minx + 900.0)
		var py := miny - 450.0 + _rng.randf() * (maxy - miny + 900.0)
		if circuit.distance_to_track(px, py) < 70.0:
			continue
		var pos := Vector3(px, 0.0, -py)
		var s := 5.5 + _rng.randf() * 4.5
		var xf := Transform3D(Basis(Vector3.UP, _rng.randf() * TAU), pos)
		if _rng.randf() < 0.65:
			large.append(Assets.instance_xf("treeLarge", xf, Vector3(s, s * (0.9 + _rng.randf() * 0.4), s)))
		else:
			small.append(Assets.instance_xf("treeSmall", xf, Vector3(s * 1.2, s * 1.2, s * 1.2)))
	var tl := Assets.multimesh("treeLarge", large)
	tl.name = "trees_large"
	add_child(tl)
	var ts := Assets.multimesh("treeSmall", small)
	ts.name = "trees_small"
	add_child(ts)

	# grandstands
	var stand := func(idx: int, side_left: bool, model: String, off: float) -> void:
		var i: int = ((idx % circuit.n) + circuit.n) % circuit.n
		var pose := {"x": circuit.x[i], "y": circuit.y[i], "tx": circuit.tx[i], "ty": circuit.ty[i]}
		var w: float = circuit.hl[i] if side_left else circuit.hr[i]
		var lat: float = (w + off) * (1.0 if side_left else -1.0)
		var pos := _place(pose, lat, 0.0, 0.0).origin
		var dir := -1.0 if side_left else 1.0               # face the track
		var vx := -float(pose["ty"]) * dir
		var vz := -float(pose["tx"]) * dir
		var node := Assets.make(model, 34.0)
		node.transform = _facing_z(pos, vx, vz)
		node.scale = Vector3(1.0, 0.8, 1.0)
		add_child(node)
	stand.call(circuit.n - 16, true, "grandStandCovered", 30.0)
	stand.call(circuit.n - 6, true, "grandStandCovered", 30.0)
	stand.call(10, true, "grandStandAwning", 30.0)
	stand.call(21, true, "grandStand", 30.0)
	for l in circuit.data["landmarks"]:
		if l["kind"] == "corner":
			var corner: Variant = null
			for k in circuit.data["corners"]:
				if int(k["index"]) == int(l["index"]):
					corner = k
			var outer_left: bool = corner != null and corner["turn"] == "right"
			stand.call(int(l["index"]), outer_left, "grandStandRound", 46.0)

	# floodlight posts and billboards along the main straights
	var posts: Array = []
	var boards: Array = []
	var i2 := 6
	while i2 < circuit.n:
		var pose2 := {"x": circuit.x[i2], "y": circuit.y[i2], "tx": circuit.tx[i2], "ty": circuit.ty[i2]}
		posts.append(Assets.instance_xf("lightPostLarge", _place(pose2, circuit.hl[i2] + 9.0, 0.0, 0.0), Vector3(16, 16, 16)))
		i2 += 24
	var j := 3
	while j < circuit.n:
		var pose3 := {"x": circuit.x[j], "y": circuit.y[j], "tx": circuit.tx[j], "ty": circuit.ty[j]}
		if j % 3 == 0 and circuit.hr[j] > 0.0:
			var pos3 := _place(pose3, -(circuit.hr[j] + 36.0), 0.0, 0.0).origin
			boards.append(Assets.instance_xf("billboardLow", _facing_z(pos3, -float(pose3["ty"]), -float(pose3["tx"])), Vector3(16, 12, 16)))
		j += 41
	add_child(Assets.multimesh("lightPostLarge", posts))
	add_child(Assets.multimesh("billboardLow", boards))


func _labels() -> void:
	for l in circuit.data["landmarks"]:
		var i := ((int(l["index"]) % circuit.n) + circuit.n) % circuit.n
		var lab := Label3D.new()
		lab.text = str(l["name"]).to_upper()
		lab.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		lab.no_depth_test = true
		lab.fixed_size = true
		lab.pixel_size = 0.0003
		lab.font_size = 36
		lab.outline_size = 10
		lab.modulate = Color("#fff4f1")
		lab.outline_modulate = Color("#6b0f1b")
		lab.position = Vector3(circuit.x[i], 34.0, -circuit.y[i])
		add_child(lab)
		_label_nodes.append([lab, lab.pixel_size])
	for k in circuit.data["corners"]:
		var i2 := int(k["index"])
		var lab2 := Label3D.new()
		lab2.text = "T%d" % int(k["n"])
		lab2.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		lab2.no_depth_test = true
		lab2.fixed_size = true
		lab2.pixel_size = 0.00022
		lab2.font_size = 28
		lab2.outline_size = 8
		lab2.modulate = Color("#d3b5b9")
		lab2.outline_modulate = Color("#3a0a12")
		var side := -1.0 if k["turn"] == "left" else 1.0
		var off: float = (circuit.hl[i2] if side > 0 else circuit.hr[i2]) + 40.0
		var pose := {"x": circuit.x[i2], "y": circuit.y[i2], "tx": circuit.tx[i2], "ty": circuit.ty[i2]}
		var p := _place(pose, off * side, 14.0, 0.0).origin
		lab2.position = p
		add_child(lab2)
		_label_nodes.append([lab2, lab2.pixel_size])
		_corner_label_nodes.append(lab2)


# ------------------------------------------------------------------ dynamic state
func scale_labels(fov_deg: float) -> void:
	var k := clampf(fov_deg / 45.0, 0.1, 1.5)
	if absf(k - _label_k) < 0.004:
		return
	_label_k = k
	for e in _label_nodes:
		(e[0] as Label3D).pixel_size = float(e[1]) * k

func set_wetness(w: float) -> void:
	if road_mat == null or absf(w - _applied_wet) < 0.002:
		return
	_applied_wet = w
	var dry := Color.WHITE
	var wet := Color(0.5, 0.52, 0.58)
	road_mat.albedo_color = dry.lerp(wet, clampf(w * 1.4, 0.0, 1.0))
	road_mat.roughness = 0.92 - 0.72 * clampf(w * 1.3, 0.0, 1.0)
	road_mat.metallic_specular = 0.5 + 0.5 * clampf(w, 0.0, 1.0)


func set_safety_car(active: bool, t: float) -> void:
	if sc_glow_mat:
		sc_glow_mat.albedo_color.a = (0.45 + 0.4 * sin(t * 6.0)) if active else 0.0


## mode: 0 = none, 1 = proposed (pulsing red), 2 = executing (green)
func set_pit_highlight(mode: int, t: float) -> void:
	if pit_glow_mat == null:
		return
	match mode:
		1:
			pit_glow_mat.albedo_color = Color(1, 0.23, 0.28, 0.25 + 0.35 * (0.5 + 0.5 * sin(t * 7.0)))
		2:
			pit_glow_mat.albedo_color = Color(0.18, 0.88, 0.54, 0.5)
		_:
			pit_glow_mat.albedo_color.a = 0.0


# ------------------------------------------------------------------ quality
func apply_quality(P: Dictionary) -> void:
	_shadow_pref = bool(P["shadows"])
	sun.shadow_enabled = _shadow_pref
	var splits := int(P["splits"])
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL if splits <= 1 else (DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS if splits == 2 else DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS)
	sun.directional_shadow_max_distance = maxf(50.0, float(P["shadow_dist"]))
	RenderingServer.directional_shadow_atlas_set_size(int(P["shadow_size"]), true)
	env.glow_enabled = bool(P["glow"])
	env.fog_enabled = bool(P["fog"])
	var frac := float(P["trees"])
	for t in _tree_nodes:
		var mm := (t as MultiMeshInstance3D).multimesh
		if mm != null:
			mm.visible_instance_count = int(round(mm.instance_count * frac))
		(t as MultiMeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if bool(P["props_shadows"]) else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for p in _prop_nodes:
		(p as MultiMeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if bool(P["props_shadows"]) else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for l in _corner_label_nodes:
		(l as Label3D).visible = bool(P["corner_labels"])


## Shadows only matter near the cars: switch the sun's shadow pass off while the camera is far above the circuit.
func update_shadow_for_camera(cam_height: float) -> void:
	var want := _shadow_pref and cam_height < 420.0
	if sun.shadow_enabled != want:
		sun.shadow_enabled = want
