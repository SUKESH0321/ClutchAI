class_name CarView
extends Node3D
## One race car: Kenney model (CC0) + team livery marker + floating code label.
## +X is the nose. Position and heading are set every frame by Main from the authoritative lap data.

const CAR_LENGTH := 5.8
## Kenney cars are modelled along Z. Rotate so the nose points along +X (flip with PI if reversed).
const MODEL_YAW := PI / 2.0

var car_id: String = ""
var code: String = ""
var team_color: Color = Color.WHITE
var is_primary: bool = false
var is_ghost: bool = false

var _label: Label3D
var _label_base: float = 0.0002
var _ring: MeshInstance3D
var _body: Node3D


func setup(id: String, model: String, color: Color, label_text: String, primary: bool, ghost: bool = false) -> void:
	car_id = id
	code = label_text
	team_color = color
	is_primary = primary
	is_ghost = ghost
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

	# livery stripe along the roof in the team colour (distinguishes cars that share a Kenney model)
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
		_label.position = Vector3(0.0, 4.4, 0.0)
		_label.render_priority = 2
		add_child(_label)

		_ring = MeshInstance3D.new()
		var torus := TorusMesh.new()
		torus.inner_radius = 3.2
		torus.outer_radius = 3.6
		_ring.mesh = torus
		_ring.scale = Vector3(1.0, 0.05, 1.0)
		_ring.position.y = 0.2
		var rm := StandardMaterial3D.new()
		rm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		rm.albedo_color = Color.WHITE
		_ring.material_override = rm
		_ring.visible = false
		add_child(_ring)


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
	position = Vector3(px, 0.12, -py)
	rotation.y = atan2(ty, tx)
