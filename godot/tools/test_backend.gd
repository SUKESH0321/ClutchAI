extends SceneTree
## Integration test of the Godot client's backend layer against a RUNNING backend (ws://127.0.0.1:8000).
## Run: Godot_console.exe --headless --path godot --script res://tools/test_backend.gd
## It resets the race, so do not run it while a demo is in progress.

var failures := 0
var backend: Node


func check(cond: bool, msg: String) -> void:
	print(("  ok   " if cond else "  FAIL ") + msg)
	if not cond:
		failures += 1


## Wait until `pred` returns true, or give up after `timeout` seconds.
func wait_for(pred: Callable, timeout: float = 8.0) -> bool:
	var t0 := Time.get_ticks_msec()
	while Time.get_ticks_msec() - t0 < timeout * 1000.0:
		if pred.call():
			return true
		await process_frame
	return false


func _init() -> void:
	await process_frame
	await process_frame
	backend = root.get_node_or_null("Backend")
	check(backend != null, "Backend autoload present")
	if backend == null:
		quit(1)
		return
	var online: bool = await wait_for(func() -> bool: return backend.online)
	check(online, "websocket connected")
	if not online:
		print("RESULT: FAIL (backend not running on %s)" % backend.host)
		quit(1)
		return
	await wait_for(func() -> bool: return not backend.state.is_empty())

	backend.reset("demo")
	var ok: bool = await wait_for(func() -> bool: return backend.state.get("status") == "idle" and int(backend.state.get("lap", -1)) == 0)
	check(ok, "reset -> idle, lap 0")
	check((backend.state["cars"] as Array).size() == 8, "state has 8 cars")
	check(backend.state["recommendation"] != null, "initial optimizer recommendation present")

	backend.step()
	ok = await wait_for(func() -> bool: return int(backend.state.get("lap", 0)) == 1)
	check(ok and backend.state["status"] == "paused", "step -> lap 1, paused")
	var prim: Dictionary = {}
	for c in backend.state["cars"]:
		if c["is_primary"]:
			prim = c
	check(absf(float(prim["laps"][0]["elapsed_s"]) - float(backend.state["elapsed_s"])) < 1e-6, "car lap data matches header elapsed time")

	backend.event("RAIN", 0.8)
	ok = await wait_for(func() -> bool: return float(backend.state["conditions"]["rain_intensity"]) > 0.5)
	check(ok, "rain event changes the simulated conditions")
	check(backend.state["recommendation"]["trigger"] == "WEATHER_CHANGE", "optimizer replanned on WEATHER_CHANGE")

	backend.event("SC_DEPLOY")
	ok = await wait_for(func() -> bool: return bool(backend.state["conditions"]["safety_car"]))
	check(ok, "safety car deployed")
	check(backend.state["recommendation"]["trigger"] == "SC_DEPLOYED", "optimizer replanned on SC_DEPLOYED")
	var errors: Array = []
	backend.api_error.connect(func(m: String) -> void: errors.append(m))
	backend.event("SC_DEPLOY")
	ok = await wait_for(func() -> bool: return errors.size() > 0)
	check(ok, "duplicate safety car is rejected with a backend error: %s" % (errors[0] if errors.size() > 0 else ""))
	backend.event("SC_WITHDRAW")
	ok = await wait_for(func() -> bool: return not bool(backend.state["conditions"]["safety_car"]))
	check(ok, "safety car withdrawn")

	backend.set_speed(8.0)
	ok = await wait_for(func() -> bool: return absf(float(backend.state["speed"]) - 8.0) < 1e-6)
	check(ok, "speed changed to 8x")
	backend.resume()
	ok = await wait_for(func() -> bool: return backend.state["status"] == "running")
	check(ok, "resume -> running")
	backend.pause()
	ok = await wait_for(func() -> bool: return backend.state["status"] == "paused")
	check(ok, "pause -> paused")

	backend.finish()
	ok = await wait_for(func() -> bool: return backend.state["status"] == "finished", 20.0)
	check(ok and int(backend.state["lap"]) == int(backend.state["total_laps"]), "finish -> race complete")
	# every car has a full lap history that ends where the header says the strategy car did
	var all_full := true
	for c in backend.state["cars"]:
		if (c["laps"] as Array).size() != int(backend.state["total_laps"]):
			all_full = false
	check(all_full, "every car completed all laps")

	backend.set_speed(1.0)
	backend.reset("demo")
	ok = await wait_for(func() -> bool: return backend.state["status"] == "idle")
	check(ok, "reset again -> idle (left ready for the next run)")
	print("RESULT: %s (%d failures)" % ["PASS" if failures == 0 else "FAIL", failures])
	quit(1 if failures > 0 else 0)
