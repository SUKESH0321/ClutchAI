class_name Assets
extends RefCounted
## Loads the CC0 Kenney Racing Kit models (godot/assets/kenney) and normalises their pivots so props
## can be placed by their ground-centre and cars face +X.

const DIR := "res://assets/kenney/"
static var _cache: Dictionary = {}

## The Kenney palette is pastel; remap it to richer colours that sit well in the maroon-red scene.
const PALETTE := {
	"carTire": [Color("#1b1b1f"), 0.9, 0.0],
	"glass": [Color("#1c2535"), 0.12, 0.3],
	"grey": [Color("#d9d3d5"), 0.75, 0.0],
	"red": [Color("#b3202c"), 0.55, 0.0],
	"grass": [Color("#2f6b34"), 0.95, 0.0],
	"bark": [Color("#5a3f2c"), 0.95, 0.0],
	"road": [Color("#3a3a40"), 0.9, 0.0],
	"pylon": [Color("#e8821a"), 0.6, 0.0],
}


## Returns {scene: PackedScene, mesh: Mesh, base: Transform3D, size: Vector3} (first mesh found).
static func info(model: String) -> Dictionary:
	if _cache.has(model):
		return _cache[model]
	var ps: PackedScene = load(DIR + model + ".glb")
	if ps == null:
		push_error("missing model %s" % model)
		return {}
	var root := ps.instantiate()
	var found := _find_mesh(root, Transform3D.IDENTITY)
	var out := {}
	if found.size() > 0:
		var mesh: Mesh = found["mesh"]
		_remap_materials(mesh)
		var xf: Transform3D = found["xf"]
		var box: AABB = xf * mesh.get_aabb()
		var c := box.get_center()
		var base := Transform3D(Basis.IDENTITY, Vector3(-c.x, -box.position.y, -c.z)) * xf
		out = {"scene": ps, "mesh": mesh, "base": base, "size": box.size}
	root.free()
	_cache[model] = out
	return out


static func _remap_materials(mesh: Mesh) -> void:
	for si in mesh.get_surface_count():
		var old := mesh.surface_get_material(si)
		var nm := old.resource_name if old else ""
		var m := StandardMaterial3D.new()
		m.resource_name = nm
		if PALETTE.has(nm):
			var e: Array = PALETTE[nm]
			m.albedo_color = e[0]
			m.roughness = e[1]
			m.metallic = e[2]
		elif old is BaseMaterial3D:
			var c := (old as BaseMaterial3D).albedo_color
			m.albedo_color = Color(c.r * 0.82, c.g * 0.82, c.b * 0.82, c.a)
			m.albedo_texture = (old as BaseMaterial3D).albedo_texture
			m.roughness = 0.85
		mesh.surface_set_material(si, m)


static func _find_mesh(node: Node, xf: Transform3D) -> Dictionary:
	if node is MeshInstance3D and (node as MeshInstance3D).mesh != null:
		return {"mesh": (node as MeshInstance3D).mesh, "xf": xf}
	for ch in node.get_children():
		if ch is Node3D:
			var r := _find_mesh(ch, xf * (ch as Node3D).transform)
			if r.size() > 0:
				return r
	return {}


## Instance a model as a node, centred on its ground footprint and uniformly scaled so its
## longest horizontal dimension (or height when `by_height`) equals `target` metres.
static func make(model: String, target: float, by_height: bool = false) -> Node3D:
	var i := info(model)
	var holder := Node3D.new()
	if i.is_empty():
		return holder
	var size: Vector3 = i["size"]
	var ref := size.y if by_height else maxf(size.x, size.z)
	var s := target / maxf(ref, 1e-6)
	var inner := MeshInstance3D.new()
	inner.mesh = i["mesh"]
	inner.transform = Transform3D(Basis.from_scale(Vector3(s, s, s)), Vector3.ZERO) * (i["base"] as Transform3D)
	holder.add_child(inner)
	return holder


## Transform for a MultiMesh instance: place (world) * scale * base.
static func instance_xf(model: String, place: Transform3D, scale: Vector3) -> Transform3D:
	var i := info(model)
	return place * Transform3D(Basis.from_scale(scale), Vector3.ZERO) * (i["base"] as Transform3D)


static func multimesh(model: String, xforms: Array, cast_shadow: bool = true) -> MultiMeshInstance3D:
	var i := info(model)
	var mmi := MultiMeshInstance3D.new()
	if i.is_empty() or xforms.is_empty():
		return mmi
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = i["mesh"]
	mm.instance_count = xforms.size()
	for k in xforms.size():
		mm.set_instance_transform(k, xforms[k])
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if cast_shadow else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mmi
