class_name Circuit
extends RefCounted
## Circuit geometry (real Silverstone centerline from the TUM FTM racetrack-database, see data/README.md).
## Math is done in "map" coordinates (x east, y north, metres); to_scene() converts to Godot (x, y-up, z = -north).

var data: Dictionary
var n: int
var length: float
var step: float
var x := PackedFloat64Array()
var y := PackedFloat64Array()
var tx := PackedFloat64Array()
var ty := PackedFloat64Array()
var hl := PackedFloat64Array()   # half width to the left of travel
var hr := PackedFloat64Array()
# pit lane polyline
var px := PackedFloat64Array()
var py := PackedFloat64Array()
var ptx := PackedFloat64Array()
var pty := PackedFloat64Array()
var pcum := PackedFloat64Array()
var pit_length: float
var pit_line_dist: float          # lane distance from entry to the start line


static func load_from(path: String) -> Circuit:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("cannot open circuit file %s" % path)
		return null
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("bad circuit json")
		return null
	var c := Circuit.new()
	c._build(parsed)
	return c


func _build(d: Dictionary) -> void:
	data = d
	n = int(d["point_count"])
	length = float(d["length_m"])
	step = length / n
	var pts: Array = d["points"]
	var wl: Array = d["half_width_left_m"]
	var wr: Array = d["half_width_right_m"]
	x.resize(n); y.resize(n); tx.resize(n); ty.resize(n); hl.resize(n); hr.resize(n)
	for i in n:
		x[i] = float(pts[i][0]); y[i] = float(pts[i][1])
		hl[i] = float(wl[i]); hr[i] = float(wr[i])
	for i in n:
		var dx := x[(i + 1) % n] - x[(i - 1 + n) % n]
		var dy := y[(i + 1) % n] - y[(i - 1 + n) % n]
		var l := maxf(1e-9, sqrt(dx * dx + dy * dy))
		tx[i] = dx / l; ty[i] = dy / l
	var pp: Array = d["pit_lane"]["points"]
	var m := pp.size()
	px.resize(m); py.resize(m); ptx.resize(m); pty.resize(m); pcum.resize(m)
	for i in m:
		px[i] = float(pp[i][0]); py[i] = float(pp[i][1])
		if i > 0:
			pcum[i] = pcum[i - 1] + sqrt(pow(px[i] - px[i - 1], 2) + pow(py[i] - py[i - 1], 2))
	for i in m:
		var a := maxi(0, i - 1)
		var b := mini(m - 1, i + 1)
		var dx := px[b] - px[a]
		var dy := py[b] - py[a]
		var l := maxf(1e-9, sqrt(dx * dx + dy * dy))
		ptx[i] = dx / l; pty[i] = dy / l
	pit_length = pcum[m - 1]
	var line_idx := -int(d["pit_lane"]["entry_index_offset"])
	pit_line_dist = pcum[line_idx]


static func to_scene(px_: float, py_: float, h: float = 0.0) -> Vector3:
	return Vector3(px_, h, -py_)


func point_at(f: float) -> Dictionary:
	var u := (f - floorf(f)) * n
	var i := int(floorf(u))
	var k := u - i
	var j := (i + 1) % n
	var ttx := tx[i] * (1.0 - k) + tx[j] * k
	var tty := ty[i] * (1.0 - k) + ty[j] * k
	var l := maxf(1e-9, sqrt(ttx * ttx + tty * tty))
	return {"x": x[i] * (1.0 - k) + x[j] * k, "y": y[i] * (1.0 - k) + y[j] * k, "tx": ttx / l, "ty": tty / l}


func pit_at(s: float) -> Dictionary:
	var m := pcum.size()
	var d := clampf(s, 0.0, pit_length)
	var lo := 0
	var hi := m - 1
	while hi - lo > 1:
		var mid := (lo + hi) >> 1
		if pcum[mid] <= d:
			lo = mid
		else:
			hi = mid
	var seg := maxf(1e-9, pcum[hi] - pcum[lo])
	var k := (d - pcum[lo]) / seg
	var ttx := ptx[lo] * (1.0 - k) + ptx[hi] * k
	var tty := pty[lo] * (1.0 - k) + pty[hi] * k
	var l := maxf(1e-9, sqrt(ttx * ttx + tty * tty))
	return {"x": px[lo] * (1.0 - k) + px[hi] * k, "y": py[lo] * (1.0 - k) + py[hi] * k, "tx": ttx / l, "ty": tty / l}


func distance_to_track(qx: float, qy: float) -> float:
	var best := 1e18
	var i := 0
	while i < n:
		var dx := qx - x[i]
		var dy := qy - y[i]
		var d2 := dx * dx + dy * dy
		if d2 < best:
			best = d2
		i += 1
	return sqrt(best)


## Sample dictionary arrays used by the mesh builders (main circuit or pit lane).
func main_samples() -> Array:
	var out: Array = []
	for i in n:
		out.append([x[i], y[i], tx[i], ty[i]])
	return out


func pit_samples() -> Array:
	var out: Array = []
	for i in px.size():
		out.append([px[i], py[i], ptx[i], pty[i]])
	return out


# ------------------------------------------------------------------ mesh builders
## Horizontal strip between lateral offsets (positive = left of travel). Samples are [x, y, tx, ty].
## o0/o1: PackedFloat64Array of per-sample offsets. Optional per-sample colors.
static func strip(samples: Array, o0: PackedFloat64Array, o1: PackedFloat64Array, h: float, closed: bool, colors: PackedColorArray = PackedColorArray(), uv_scale: float = 8.0) -> ArrayMesh:
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	var count := samples.size() + (1 if closed else 0)
	var dist := 0.0
	var prev := Vector2.ZERO
	for k in count:
		var i := k % samples.size()
		var s: Array = samples[i]
		var nx := -float(s[3])
		var ny := float(s[2])
		var a := o0[i]
		var b := o1[i]
		var p := Vector2(s[0], s[1])
		if k > 0:
			dist += p.distance_to(prev)
		prev = p
		verts.append(Vector3(p.x + nx * a, h, -(p.y + ny * a)))
		verts.append(Vector3(p.x + nx * b, h, -(p.y + ny * b)))
		norms.append(Vector3.UP)
		norms.append(Vector3.UP)
		uvs.append(Vector2(0.0, dist / uv_scale))
		uvs.append(Vector2(1.0, dist / uv_scale))
		if colors.size() > 0:
			cols.append(colors[i])
			cols.append(colors[i])
		if k > 0:
			var v := (k - 1) * 2
			idx.append_array([v, v + 1, v + 2, v + 1, v + 3, v + 2])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	if colors.size() > 0:
		arrays[Mesh.ARRAY_COLOR] = cols
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


static func const_offsets(count: int, v: float) -> PackedFloat64Array:
	var a := PackedFloat64Array()
	a.resize(count)
	a.fill(v)
	return a
