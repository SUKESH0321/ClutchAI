class_name RaceClock
extends RefCounted
## Maps the AUTHORITATIVE per-lap timing from the backend onto positions on the circuit.
## A port of frontend/src/lib/raceClock.ts: a car's position at race time t is a pure function of its
## recorded lap times, so reported lap times and gaps are exactly what drives the animation.
##
## The visual clock eases toward the moment the leader has completed the newest known lap, so
## rendering is smooth but never runs ahead of data the backend has produced.

var _from: float = 0.0
var _to: float = 0.0
var _t0: float = 0.0
var _dur: float = 1.0
var _smooth: bool = false
var _key: String = ""
var _inited: bool = false


func _ms() -> float:
	return Time.get_ticks_msec()


func now() -> float:
	var k := clampf((_ms() - _t0) / _dur, 0.0, 1.0)
	if _smooth:
		k = 1.0 - (1.0 - k) * (1.0 - k)
	return _from + (_to - _from) * k


func update(s: Dictionary) -> void:
	var target := clock_target(s)
	var key := "%s|%s|%s|%.3f" % [s.get("lap"), s.get("status"), s.get("speed"), target]
	if key == _key:
		return
	_key = key
	if not _inited:
		_inited = true
		_from = target; _to = target; _t0 = _ms(); _dur = 1.0
		return
	var cur := now()
	if target < cur - 1e-6 or int(s.get("lap", 0)) == 0:
		_from = target; _to = target; _t0 = _ms(); _dur = 1.0
		return
	_from = cur
	_to = target
	_t0 = _ms()
	var running: bool = s.get("status") == "running"
	_smooth = not running
	_dur = 3000.0 / float(s.get("speed", 1.0)) if running else 1400.0


## Latest race time for which every car's position is fully known.
static func clock_target(s: Dictionary) -> float:
	var cars: Array = s.get("cars", [])
	if int(s.get("lap", 0)) == 0 or cars.is_empty():
		return 0.0
	var ends: Array = []
	for c in cars:
		var laps: Array = c["laps"]
		ends.append(laps[laps.size() - 1]["elapsed_s"] if laps.size() > 0 else 0.0)
	var b: Variant = s.get("baseline")
	if typeof(b) == TYPE_DICTIONARY:
		var t := 0.0
		for l in b["laps"]:
			t += float(l["lap_time_s"])
		ends.append(t)
	var out: float = float(ends[0])
	var finished: bool = s.get("status") == "finished"
	for e in ends:
		out = maxf(out, float(e)) if finished else minf(out, float(e))
	return out


static func baseline_laps(s: Dictionary) -> Array:
	var out: Array = []
	var b: Variant = s.get("baseline")
	if typeof(b) != TYPE_DICTIONARY:
		return out
	var t := 0.0
	for l in b["laps"]:
		t += float(l["lap_time_s"])
		out.append({"lap": l["lap"], "lap_time_s": l["lap_time_s"], "elapsed_s": t, "pitted": l["pitted"], "pit_loss_s": l.get("pit_loss_s", 0.0)})
	return out


static func _lap_index_at(laps: Array, t: float) -> int:
	var lo := 0
	var hi := laps.size()
	while lo < hi:
		var mid := (lo + hi) >> 1
		if float(laps[mid]["elapsed_s"]) > t:
			hi = mid
		else:
			lo = mid + 1
	return lo


## opts: L, d_in, d_out, lane_in, lane_out, ratio, grid_frac, box_before
## returns {kind: "track"|"pit", frac, s, total, lap_no, stopped}
static func place_car(laps: Array, t: float, o: Dictionary) -> Dictionary:
	var L: float = o["L"]
	var grid: float = o["grid_frac"]
	if laps.is_empty() or t <= 0.0:
		return {"kind": "track", "frac": fposmod(1.0 - grid, 1.0), "s": 0.0, "total": -grid, "lap_no": 1, "stopped": false}
	var idx := _lap_index_at(laps, t)
	if idx >= laps.size():
		var last: Dictionary = laps[laps.size() - 1]
		var cap: float = o.get("roll_cap", 0.05)
		var extra := minf(cap, ((t - float(last["elapsed_s"])) / float(last["lap_time_s"])) * 0.5)
		return {"kind": "track", "frac": extra, "s": 0.0, "total": laps.size() + extra, "lap_no": laps.size(), "stopped": false}
	var lap: Dictionary = laps[idx]
	var start := 0.0 if idx == 0 else float(laps[idx - 1]["elapsed_s"])
	var tt := t - start
	var lt: float = lap["lap_time_s"]
	var fe := 1.0 - float(o["d_in"]) / L
	var fx := float(o["d_out"]) / L
	var prev_pitted: bool = idx > 0 and bool(laps[idx - 1]["pitted"])
	var lane_in: float = o["lane_in"]
	var lane_out: float = o["lane_out"]

	if bool(lap["pitted"]):
		var loss: float = lap["pit_loss_s"]
		var tr := maxf(1e-6, lt - loss)
		var t_main := tr * fe
		if tt < t_main:
			var f := (tt / t_main) * fe
			var frac := (-grid + (1.0 + grid) * f) if idx == 0 else f
			return {"kind": "track", "frac": fposmod(frac, 1.0), "s": 0.0, "total": idx + frac, "lap_no": lap["lap"], "stopped": false}
		var tail := lt - t_main
		var service := minf(loss * float(o["ratio"]), tail * 0.8)
		var travel := maxf(1e-6, tail - service)
		var to_box := maxf(1.0, lane_in - float(o["box_before"]))
		var travel_a := travel * (to_box / lane_in)
		var t2 := tt - t_main
		var s := 0.0
		var stopped := false
		if t2 < travel_a:
			s = (t2 / travel_a) * to_box
		elif t2 < travel_a + service:
			s = to_box
			stopped = true
		else:
			s = to_box + ((t2 - travel_a - service) / maxf(1e-6, travel - travel_a)) * (lane_in - to_box)
		return {"kind": "pit", "frac": 0.0, "s": minf(s, lane_in), "total": idx + fe + (s / lane_in) * (1.0 - fe), "lap_no": lap["lap"], "stopped": stopped}

	var f2 := tt / lt
	if idx == 0:
		f2 = -grid + (1.0 + grid) * f2
	if prev_pitted and f2 >= 0.0 and f2 < fx:
		return {"kind": "pit", "frac": 0.0, "s": lane_in + (f2 / fx) * lane_out, "total": idx + f2, "lap_no": lap["lap"], "stopped": false}
	return {"kind": "track", "frac": fposmod(f2, 1.0), "s": 0.0, "total": idx + f2, "lap_no": lap["lap"], "stopped": false}


static func pose_of(c: Circuit, p: Dictionary) -> Dictionary:
	if p["kind"] == "track":
		return c.point_at(p["frac"])
	return c.pit_at(p["s"])


static func opts_for(c: Circuit, ratio: float, grid_slot: int, box_index: int) -> Dictionary:
	var gap := 8.5
	return {
		"L": c.length,
		"d_in": float(c.data["pit_lane"]["entry_distance_m"]),
		"d_out": float(c.data["pit_lane"]["exit_distance_m"]),
		"lane_in": c.pit_line_dist,
		"lane_out": c.pit_length - c.pit_line_dist,
		"ratio": ratio,
		"grid_frac": (grid_slot * gap + 6.0) / c.length,
		"box_before": minf(c.pit_line_dist - 6.0, box_index * 11.0),
		"roll_cap": 0.05,
	}
