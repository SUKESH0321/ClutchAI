extends SceneTree
## Headless checks for the circuit data and car placement (mirrors frontend/src/lib/__tests__/raceClock.test.ts).
## Run: Godot_console.exe --headless --path godot --script res://tools/test_placement.gd

var failures := 0


func check(cond: bool, msg: String) -> void:
	if cond:
		print("  ok   ", msg)
	else:
		print("  FAIL ", msg)
		failures += 1


func _laps(n: int, base: float, pit_laps: Array, loss: float = 25.0) -> Array:
	var out: Array = []
	var t := 0.0
	for i in range(1, n + 1):
		var pit := pit_laps.has(i)
		var lt := base + (loss if pit else 0.0)
		t += lt
		out.append({"lap": i, "lap_time_s": lt, "elapsed_s": t, "pitted": pit, "pit_loss_s": loss if pit else 0.0})
	return out


func _init() -> void:
	var c := Circuit.load_from("res://data/silverstone.json")
	check(c != null, "circuit loads")
	check(c.length > 5800.0 and c.length < 5950.0, "length %.0f m is Silverstone-like" % c.length)
	var a := c.point_at(0.0)
	var b := c.point_at(0.9999)
	check(Vector2(a["x"], a["y"]).distance_to(Vector2(b["x"], b["y"])) < 15.0, "loop is closed")
	var o := RaceClock.opts_for(c, 0.8, 5, 0)
	var laps := _laps(6, 92.0, [3])
	var end_t: float = laps[laps.size() - 1]["elapsed_s"]

	var prev := RaceClock.pose_of(c, RaceClock.place_car(laps, 0.0001, o))
	var max_step := 0.0
	var t := 0.05
	var used_pit := 0
	var stopped_t := 0.0
	while t < end_t:
		var pl := RaceClock.place_car(laps, t, o)
		var p := RaceClock.pose_of(c, pl)
		max_step = maxf(max_step, Vector2(p["x"], p["y"]).distance_to(Vector2(prev["x"], prev["y"])))
		if pl["kind"] == "pit":
			used_pit += 1
			if pl["stopped"]:
				stopped_t += 0.05
		prev = p
		t += 0.05
	check(max_step < 6.0, "no teleporting: max step %.2f m per 50 ms" % max_step)
	check(used_pit > 0, "pit lane used on the pitted lap")
	check(absf(stopped_t - 25.0 * 0.8) < 0.3, "stationary %.2f s = service share of pit loss" % stopped_t)

	for lp in laps:
		var pl2 := RaceClock.place_car(laps, float(lp["elapsed_s"]) - 1e-3, o)
		var pose := RaceClock.pose_of(c, pl2)
		var line := c.point_at(0.0)
		var d := Vector2(pose["x"], pose["y"]).distance_to(Vector2(line["x"], line["y"]))
		var expected := float(c.data["pit_lane"]["offset_m"]) if bool(lp["pitted"]) else 0.0
		check(absf(d - expected) < 10.0, "lap %d ends beside the start line (%.1f m off, expected %.0f)" % [lp["lap"], d, expected])

	check(RaceClock.place_car(laps, 0.0, o)["total"] < 0.0, "starts on the grid behind the line")
	print("RESULT: %s (%d failures)" % ["PASS" if failures == 0 else "FAIL", failures])
	quit(1 if failures > 0 else 0)
