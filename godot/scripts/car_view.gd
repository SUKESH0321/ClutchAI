class_name CarView
extends Node3D
## One race car. The racers use the supplied F1 model (assets/f1, optimised by scripts/f1car): a detailed near
## model and a light far model, swapped by camera distance, recoloured per team with a centre stripe, with spinning
## and steering wheels and brake lights. The safety car (and the fallback if the F1 files are missing) uses a Kenney
## car. +X is the nose. Position and heading are set every frame by Main from the authoritative lap data.

const CAR_LENGTH := 5.8
## Kenney cars are modelled along Z. Rotate so the nose points along +X (flip with PI if reversed).
const MODEL_YAW := PI / 2.0
const F1_HI := "res://assets/f1/f1_hi.glb"
const F1_LO := "res://assets/f1/f1_far.glb"      # far model: wheels merged into the body (3 draw calls)
const WHEEL_R := 0.305
const PAINT_SHADER := preload("res://assets/f1/paint.gdshader")

var car_id: String = ""
var code: String = ""
var team_color: Color = Color.WHITE
var is_primary: bool = false
var is_ghost: bool = false

var _label: Label3D
var _label_base: float = 0.0002
var _ring: MeshInstance3D
var _body: Node3D                    # Kenney model (safety car / fallback)
var _hi: Node3D
var _lo: Node3D
var _wheels: Array = []              # [[node, is_front], ...] for both detail levels
var _brake_mat: StandardMaterial3D
var _spin: float = 0.0
var _steer: float = 0.0
var _near: bool = true
var _lod_m: float = 100.0
var _shadows: bool = true


static func f1_available() -> bool:
	return ResourceLoader.exists(F1_HI) and ResourceLoader.exists(F1_LO)


## `second`: livery stripe colour. `model` "f1" selects the F1 car, anything else is a Kenney model name.
func setup(id: String, model: String, color: Color, label_text: String, primary: bool, ghost: bool = false, second: Color = Color("#14161b")) -> void:
	car_id = id
	code = label_text
	team_color = color
	is_primary = primary
	is_ghost = ghost
	if model == "f1" and f1_available():
		_build_f1(color, second, ghost)
	else:
		_build_kenney("raceCarRed" if model == "f1" else model, color, ghost)

	if not ghost:
		_label = Label3D.new()
		_label.text = "STRATEGY CAR" if primary else label_text
		_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		_label.no_depth_test = true
		_label.fixed_size = true
		_label_base = 0.00016 if primary else 0.00012
		_label.pixel_size = _label_base
		_label.font_size = 64
		_label.outline_size = 18
		_label.modulate = Color.WHITE
		_label.outline_modulate = Color("#ff3b47") if primary else Color(color.r * 0.5, color.g * 0.5, color.b * 0.5)
		_label.position = Vector3(0.0, 3.4, 0.0)
		_label.render_priority = 2
		add_child(_label)

		_ring = MeshInstance3D.new()
		var torus := TorusMesh.new()
		torus.inner_radius = 3.2
		torus.outer_radius = 3.6
		torus.rings = 24
		torus.ring_segments = 8
		_ring.mesh = torus
		_ring.scale = Vector3(1.0, 0.05, 1.0)
		_ring.position.y = 0.2
		var rm := StandardMaterial3D.new()
		rm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		rm.albedo_color = Color.WHITE
		_ring.material_override = rm
		_ring.visible = false
		add_child(_ring)


func _build_f1(color: Color, second: Color, ghost: bool) -> void:
	var paint: Material
	if ghost:
		var gm := StandardMaterial3D.new()
		gm.albedo_color = Color(1, 1, 1, 0.28)
		gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		paint = gm
	else:
		var sm := ShaderMaterial.new()
		sm.shader = PAINT_SHADER
		sm.set_shader_parameter("base", color)
		sm.set_shader_parameter("second", second)
		paint = sm
	_brake_mat = StandardMaterial3D.new()
	_brake_mat.albedo_color = Color("#330000")
	_brake_mat.emission_enabled = true
	_brake_mat.emission = Color("#ff1a1a")
	_brake_mat.emission_energy_multiplier = 0.4
	var carbon := StandardMaterial3D.new()
	carbon.albedo_color = Color("#1b1c20")
	carbon.metallic = 0.5
	carbon.roughness = 0.4
	var rubber := StandardMaterial3D.new()
	rubber.albedo_color = Color("#141414")
	rubber.roughness = 0.9
	_lo = _f1_instance(F1_LO, paint, carbon, rubber, ghost)
	if not ghost:
		_hi = _f1_instance(F1_HI, paint, carbon, rubber, false)
		# brake lights on the near model
		var bm := BoxMesh.new()
		bm.size = Vector3(0.09, 0.05, 0.03)
		for x in [-0.06, 0.06]:
			var mi := MeshInstance3D.new()
			mi.mesh = bm
			mi.material_override = _brake_mat
			mi.position = Vector3(x, 0.5, -2.76)
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			_hi.add_child(mi)
	else:
		_lo.visible = true
	set_lod(true)


func _f1_instance(path: String, paint: Material, carbon: Material, rubber: Material, ghost: bool) -> Node3D:
	var ps: PackedScene = load(path)
	var root := ps.instantiate() as Node3D
	root.rotation.y = MODEL_YAW
	add_child(root)
	for mi in root.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		var nm := m.name.to_lower()
		if ghost:
			m.material_override = paint
			m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		elif nm.begins_with("paint"):
			m.material_override = paint
		elif nm.begins_with("tyre"):
			m.material_override = rubber
		else:
			m.material_override = carbon
	for w in root.find_children("wheel-*", "Node3D", true, false):
		_wheels.append([w, String(w.name).begins_with("wheel-front")])
	return root


func _build_kenney(model: String, color: Color, ghost: bool) -> void:
	_body = Assets.make(model, CAR_LENGTH)
	_body.rotation.y = MODEL_YAW
	add_child(_body)
	# paint the body surface (index 1 on all four Kenney cars) in the team colour
	var mi := _body.get_child(0) as MeshInstance3D
	if mi != null and mi.mesh != null and mi.mesh.get_surface_count() > 1 and not ghost:
		var paint := StandardMaterial3D.new()
		paint.albedo_color = color
		paint.metallic = 0.0
		paint.roughness = 0.45
		mi.set_surface_override_material(1, paint)
	if ghost:
		_ghostify(_body)
	var stripe := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(2.4, 0.07, 0.55)
	stripe.mesh = box
	stripe.position = Vector3(-0.1, 1.72, 0.0)
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(color.r, color.g, color.b, 0.4 if ghost else 1.0)
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = 0.9
	if ghost:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	stripe.material_override = m
	stripe.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(stripe)


func _ghostify(node: Node) -> void:
	for ch in node.get_children():
		if ch is MeshInstance3D:
			var mi := ch as MeshInstance3D
			var gm := StandardMaterial3D.new()
			gm.albedo_color = Color(1, 1, 1, 0.28)
			gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			mi.material_override = gm
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_ghostify(ch)


func set_quality(lod_m: float, shadows: bool) -> void:
	_lod_m = lod_m
	_shadows = shadows
	var setting := GeometryInstance3D.SHADOW_CASTING_SETTING_ON if (shadows and not is_ghost) else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for root in [_hi, _lo]:
		if root == null:
			continue
		for mi in (root as Node3D).find_children("*", "MeshInstance3D", true, false):
			(mi as MeshInstance3D).cast_shadow = setting


func set_lod(near: bool) -> void:
	_near = near and _hi != null
	if _hi:
		_hi.visible = _near
	if _lo:
		_lo.visible = not _near


## Per-frame update from Main. `ds`: metres travelled this frame (race time), `kappa`: signed path curvature,
## `brake`: 0..1, `cam_pos`: camera position for the level-of-detail switch.
func animate(dt: float, ds: float, kappa: float, brake: float, cam_pos: Vector3) -> void:
	if _lo == null:
		return
	if _hi != null:
		var d := global_position.distance_to(cam_pos)
		if _near and d > _lod_m * 1.1:
			set_lod(false)
		elif not _near and d < _lod_m * 0.9:
			set_lod(true)
	_spin += ds / WHEEL_R
	var want := clampf(atan(2.8 * kappa) * 1.6, -0.5, 0.5)
	_steer += (want - _steer) * (1.0 - exp(-14.0 * dt))
	var spin_b := Basis(Vector3.RIGHT, fposmod(_spin, TAU))
	var front_b := Basis(Vector3.UP, _steer) * spin_b
	for e in _wheels:
		var w := e[0] as Node3D
		if w.is_visible_in_tree():
			w.basis = front_b if e[1] else spin_b
	if _brake_mat != null and _near:
		_brake_mat.emission_energy_multiplier = 0.4 + brake * 4.5


## Fixed-size labels grow as the field of view narrows; keep them a constant on-screen size.
func scale_label(fov_deg: float) -> void:
	if _label:
		_label.pixel_size = _label_base * clampf(fov_deg / 45.0, 0.1, 1.5)


func set_selected(v: bool) -> void:
	if _ring:
		_ring.visible = v


## pose: {x, y, tx, ty} in map coordinates
func apply_pose(pose: Dictionary, lateral: float = 0.0) -> void:
	var tx := float(pose["tx"])
	var ty := float(pose["ty"])
	var px := float(pose["x"]) + (-ty) * lateral
	var py := float(pose["y"]) + tx * lateral
	position = Vector3(px, 0.02 if _lo != null else 0.12, -py)
	rotation.y = atan2(ty, tx)
