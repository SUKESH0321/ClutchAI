class_name Vegetation
extends Node3D
## Dense trees and grass around the circuit from the supplied models (assets/vegetation, optimised by
## scripts/godot_assets/build_vegetation.mjs): 7 textured trees (3 large, 3 medium, 1 bush) and 4 grass clumps.
##
## Placement is a density field, not uniform scatter: forest stands from fractal noise, a safety clearance from the
## track EDGE (centreline distance minus the local half-width), exclusions around the pit lane, grandstands and open
## sight-line zones on the outside of corners, small plants near the circuit and tall trees further back. Instances are
## grouped into 400 m chunks (one MultiMesh per species per chunk) with a visibility range, so only nearby chunks are drawn.

const DIR := "res://assets/vegetation/"
const TREE_FILES := ["tree_00_large", "tree_01_medium", "tree_02_medium", "tree_03_bush", "tree_04_large", "tree_05_large", "tree_06_medium"]
const GRASS_FILES := ["grass_0", "grass_1", "grass_2", "grass_3"]
const CHUNK := 400.0
const CELL := 40.0
const TREE_CLEARANCE := 46.0
const GRASS_CLEARANCE := 26.0
const PIT_CLEARANCE := 85.0
const CORNER_OPEN_R := 90.0
const FULL_TREES := 2600          # instances at density 1.0
const FULL_GRASS := 40000

var tree_nodes: Array = []
var grass_nodes: Array = []
var _meshes: Dictionary = {}


static func available() -> bool:
	return ResourceLoader.exists(DIR + TREE_FILES[0] + ".glb") and ResourceLoader.exists(DIR + GRASS_FILES[0] + ".glb")


func _mesh(name: String) -> Mesh:
	if _meshes.has(name):
		return _meshes[name]
	var ps: PackedScene = load(DIR + name + ".glb")
	var m: Mesh = null
	if ps != null:
		var root := ps.instantiate()
		for mi in root.find_children("*", "MeshInstance3D", true, false):
			m = (mi as MeshInstance3D).mesh
			break
		root.free()
	_meshes[name] = m
	return m


static func _smooth(a: float, b: float, v: float) -> float:
	var t := clampf((v - a) / (b - a), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


## exclusions: Array of Vector3(map_x, map_y, radius) where trees must not grow (grandstands etc.)
func build(c: Circuit, exclusions: Array, seed_v: int = 7) -> void:
	if not available():
		return
	var forest := FastNoiseLite.new()
	forest.seed = seed_v
	forest.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	forest.fractal_octaves = 3
	forest.frequency = 1.0 / 340.0
	var kind := FastNoiseLite.new()
	kind.seed = seed_v + 5
	kind.frequency = 1.0 / 800.0
	var rng := RandomNumberGenerator.new()
	rng.seed = 4242 + seed_v

	var minx := 1e9
	var maxx := -1e9
	var miny := 1e9
	var maxy := -1e9
	for i in c.n:
		minx = minf(minx, c.x[i]); maxx = maxf(maxx, c.x[i])
		miny = minf(miny, c.y[i]); maxy = maxf(maxy, c.y[i])
	var margin := 900.0
	var x0 := floorf((minx - margin) / CELL) * CELL
	var y0 := floorf((miny - margin) / CELL) * CELL
	var nx := int(ceil((maxx + margin - x0) / CELL))
	var ny := int(ceil((maxy + margin - y0) / CELL))

	# corner sight-line zones (outside of each bend)
	var opens: Array = []
	for k in c.data["corners"]:
		var i := int(k["index"])
		var side := -1.0 if str(k["turn"]) == "left" else 1.0
		var off := (c.hl[i] if side > 0.0 else c.hr[i]) + 55.0
		opens.append(Vector2(c.x[i] + (-c.ty[i]) * side * off, c.y[i] + c.tx[i] * side * off))
	var pit := c.pit_samples()

	var dens_t := PackedFloat32Array()
	var dens_g := PackedFloat32Array()
	var edge := PackedFloat32Array()
	dens_t.resize(nx * ny); dens_g.resize(nx * ny); edge.resize(nx * ny)
	var tot_t := 0.0
	var tot_g := 0.0
	for gy in ny:
		for gx in nx:
			var x := x0 + (gx + 0.5) * CELL
			var y := y0 + (gy + 0.5) * CELL
			var k := gy * nx + gx
			var e := c.edge_distance(x, y)
			edge[k] = e
			if e < GRASS_CLEARANCE - CELL * 0.5:
				continue
			var near_pit := false
			if e < 400.0:
				for s in pit:
					if (x - float(s[0])) * (x - float(s[0])) + (y - float(s[1])) * (y - float(s[1])) < PIT_CLEARANCE * PIT_CLEARANCE:
						near_pit = true
						break
			var block_t := e < TREE_CLEARANCE or near_pit
			for ex in exclusions:
				if Vector2(x - (ex as Vector3).x, y - (ex as Vector3).y).length() < (ex as Vector3).z:
					block_t = true
			if not block_t:
				for o in opens:
					if Vector2(x - (o as Vector2).x, y - (o as Vector2).y).length() < CORNER_OPEN_R:
						block_t = true
						break
			var f := forest.get_noise_2d(x, y) * 0.5 + 0.5
			var forest_m := _smooth(0.42, 0.58, f)
			if not block_t:
				var wd := _smooth(TREE_CLEARANCE, 130.0, e) * (1.0 - 0.8 * _smooth(450.0, 900.0, e))
				dens_t[k] = (forest_m + (1.0 - forest_m) * 0.1) * wd
				tot_t += dens_t[k]
			if not near_pit:
				var wg := _smooth(GRASS_CLEARANCE, 40.0, e) * (1.0 - _smooth(220.0, 700.0, e))
				dens_g[k] = wg * (0.7 + 0.3 * forest_m)
				tot_g += dens_g[k]

	var st := FULL_TREES / maxf(tot_t, 1e-6)
	var sg := FULL_GRASS / maxf(tot_g, 1e-6)
	var per_chunk: Dictionary = {}          # "cx,cy" -> {trees: [[species, Transform3D]...], grass: [...]}
	for gy in ny:
		for gx in nx:
			var k := gy * nx + gx
			var e := edge[k]
			var kt := dens_t[k] * st
			var kg := dens_g[k] * sg
			var ct := int(kt) + (1 if rng.randf() < kt - floorf(kt) else 0)
			var cg := int(kg) + (1 if rng.randf() < kg - floorf(kg) else 0)
			var cx := x0 + gx * CELL
			var cy := y0 + gy * CELL
			var tkind := kind.get_noise_2d(cx, cy) * 0.5 + 0.5
			for _t in ct:
				var x := cx + rng.randf() * CELL
				var y := cy + rng.randf() * CELL
				if e < TREE_CLEARANCE + CELL and c.edge_distance(x, y) < TREE_CLEARANCE:
					continue
				var sp := _pick_tree(rng, tkind, e)
				var layer := _smooth(50.0, 190.0, e)
				var sc := (0.8 + rng.randf() * 0.35) * (0.55 + 0.45 * layer)
				if sp == 3:
					sc = 0.8 + rng.randf() * 0.6
				var w := 0.9 + rng.randf() * 0.25
				var b := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(sc * w, sc, sc * w))
				_add(per_chunk, x, y, true, sp, Transform3D(b, Vector3(x, 0.0, -y)))
			for _g in cg:
				var x2 := cx + rng.randf() * CELL
				var y2 := cy + rng.randf() * CELL
				if e < GRASS_CLEARANCE + CELL and c.edge_distance(x2, y2) < GRASS_CLEARANCE:
					continue
				var s2 := 1.8 + rng.randf() * 2.4
				var b2 := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s2, s2 * (1.6 + rng.randf() * 1.2), s2))
				_add(per_chunk, x2, y2, false, rng.randi() % GRASS_FILES.size(), Transform3D(b2, Vector3(x2, -0.02, -y2)))

	for key in per_chunk:
		var ch: Dictionary = per_chunk[key]
		for sp in ch["trees"]:
			_emit(ch["trees"][sp], TREE_FILES[sp], "trees_real_%s_%d" % [key, sp], 950.0, tree_nodes)
		for sp in ch["grass"]:
			_emit(ch["grass"][sp], GRASS_FILES[sp], "grass_%s_%d" % [key, sp], 300.0, grass_nodes)


func _pick_tree(rng: RandomNumberGenerator, kind_v: float, e: float) -> int:
	# 0 large, 1 medium, 2 medium, 3 bush, 4 large, 5 large, 6 medium; large trees sit further back, bushes near the circuit
	var r := rng.randf()
	var layer := _smooth(60.0, 200.0, e)
	if r < 0.22 * (1.0 - layer) + 0.04:
		return 3
	var larges := [0, 4, 5]
	var mediums := [1, 2, 6]
	if rng.randf() < 0.25 + 0.55 * layer:
		return larges[int(rng.randf() * 3.0 + kind_v) % 3]
	return mediums[rng.randi() % 3]


func _add(per_chunk: Dictionary, x: float, y: float, tree: bool, sp: int, xf: Transform3D) -> void:
	var key := "%d,%d" % [int(floorf(x / CHUNK)), int(floorf(y / CHUNK))]
	if not per_chunk.has(key):
		per_chunk[key] = {"trees": {}, "grass": {}}
	var bucket: Dictionary = per_chunk[key]["trees" if tree else "grass"]
	if not bucket.has(sp):
		bucket[sp] = []
	(bucket[sp] as Array).append(xf)


var _grass_mat: StandardMaterial3D


func _emit(xfs: Array, file: String, node_name: String, vis_end: float, into: Array) -> void:
	var mesh := _mesh(file)
	if mesh == null or xfs.is_empty():
		return
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = xfs.size()
	for i in xfs.size():
		mm.set_instance_transform(i, xfs[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.name = node_name
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.visibility_range_end = vis_end
	if file.begins_with("grass"):
		if _grass_mat == null:
			_grass_mat = StandardMaterial3D.new()
			_grass_mat.albedo_color = Color("#1f4a16")        # deep natural green, matte
			_grass_mat.roughness = 1.0
			_grass_mat.metallic = 0.0
			_grass_mat.metallic_specular = 0.0
			_grass_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		mmi.material_override = _grass_mat
	add_child(mmi)
	into.append(mmi)


## trees / grass: fractions 0..1 of the planned instances; props_shadows: trees cast sun shadows
func apply_quality(trees: float, grass: float, tree_shadows: bool) -> void:
	for t in tree_nodes:
		var mm := (t as MultiMeshInstance3D).multimesh
		mm.visible_instance_count = int(round(mm.instance_count * trees))
		(t as MultiMeshInstance3D).visible = trees > 0.0
		(t as MultiMeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if tree_shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for g in grass_nodes:
		var mm2 := (g as MultiMeshInstance3D).multimesh
		mm2.visible_instance_count = int(round(mm2.instance_count * grass))
		(g as MultiMeshInstance3D).visible = grass > 0.0
