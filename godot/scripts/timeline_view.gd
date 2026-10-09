class_name TimelineView
extends Control
## Stint timeline: adaptive car (driven + planned stints) vs the fixed-stint baseline shadow car.
## Completed stops are filled red triangles, planned stops hollow amber, the next recommended stop pulses cyan.

var state: Dictionary = {}


func _init() -> void:
	custom_minimum_size = Vector2(600, 160)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func set_state(s: Dictionary) -> void:
	state = s
	queue_redraw()


func _process(_dt: float) -> void:
	if visible and is_visible_in_tree():
		queue_redraw()   # pulse animation for the next recommended stop


func _x(lap: float, left: float, width: float, n: int) -> float:
	return left + (lap - 1.0) / n * width


func _draw() -> void:
	if state.is_empty():
		return
	var n: int = int(state["total_laps"])
	var left := 110.0
	var width := size.x - left - 16.0
	var f := Style.font("mono")
	var fu := Style.font("ui")
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.08, 0.01, 0.03, 0.3))
	for i in range(0, n + 1):
		var x := _x(i + 1.0, left, width, n)
		draw_line(Vector2(x, 26), Vector2(x, 120), Color(1, 0.5, 0.55, 0.12), 1.0)
		if i % 5 == 0 and i < n:
			draw_string(f, Vector2(x + 2, 20), str(i + 1), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Style.MUTED)
	var lap: int = int(state["lap"])
	var stints: Array = state["stints"]
	var adaptive: Array = []
	for st in stints:
		var end_lap: int = int(st["end_lap"]) if st["end_lap"] != null else lap
		if end_lap >= int(st["start_lap"]):
			adaptive.append({"c": st["compound"], "a": int(st["start_lap"]), "b": end_lap, "planned": false})
	var rec: Variant = state.get("recommendation")
	if typeof(rec) == TYPE_DICTIONARY and state["status"] != "finished" and lap < n:
		var cur: Dictionary = stints[stints.size() - 1]
		var from := lap + 1
		var comp: String = cur["compound"]
		for p in rec["plan"]:
			if int(p["lap"]) > lap:
				adaptive.append({"c": comp, "a": from, "b": int(p["lap"]), "planned": true})
				from = int(p["lap"]) + 1
				comp = p["compound"]
		adaptive.append({"c": comp, "a": from, "b": n, "planned": true})
	var base: Array = []
	var b: Variant = state.get("baseline")
	if typeof(b) == TYPE_DICTIONARY:
		for st in b["stints"]:
			var end_lap2: int = int(st["end_lap"]) if st["end_lap"] != null else lap
			if end_lap2 >= int(st["start_lap"]):
				base.append({"c": st["compound"], "a": int(st["start_lap"]), "b": end_lap2, "planned": false})
	_lane(adaptive, 34.0, "ADAPTIVE", left, width, n, fu, f)
	_lane(base, 80.0, "BASELINE", left, width, n, fu, f)
	if lap > 0:
		var cx := _x(lap + 1.0, left, width, n)
		draw_line(Vector2(cx, 28), Vector2(cx, 122), Color.WHITE, 2.0)
	var y := 146.0
	_legend_tri(Vector2(left, y), true, Style.RED, "completed stop", fu)
	_legend_tri(Vector2(left + 150, y), false, Style.AMBER, "planned stop", fu)
	_legend_tri(Vector2(left + 290, y), true, Style.CYAN, "next recommended stop", fu)
	draw_string(fu, Vector2(left + 470, y + 4), "hatched = planned stint", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Style.MUTED)


func _lane(segs: Array, y: float, name: String, left: float, width: float, n: int, fu: Font, f: Font) -> void:
	draw_string(fu, Vector2(8, y + 26), name, HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Style.INK)
	draw_rect(Rect2(Vector2(left, y), Vector2(width, 34)), Color(0.15, 0.03, 0.06, 0.8), true)
	draw_rect(Rect2(Vector2(left, y), Vector2(width, 34)), Style.LINE, false, 1.0)
	var first_planned_stop := true
	for i in segs.size():
		var s: Dictionary = segs[i]
		var x0 := _x(float(s["a"]), left, width, n)
		var x1 := _x(float(s["b"]) + 1.0, left, width, n) - 2.0
		var col: Color = Style.compound_color(s["c"])
		var rect := Rect2(Vector2(x0, y + 2), Vector2(maxf(2.0, x1 - x0), 30))
		if s["planned"]:
			draw_rect(rect, Color(0.12, 0.02, 0.05, 0.9), true)
			var hx := rect.position.x
			while hx < rect.end.x:
				var xa := hx
				var xb := minf(hx + 8.0, rect.end.x)
				draw_line(Vector2(xa, rect.end.y), Vector2(xb, rect.position.y), Color(Style.CYAN, 0.35), 1.5)
				hx += 8.0
			draw_rect(rect, col, false, 1.5)
			draw_string(fu, rect.position + Vector2(6, 21), s["c"], HORIZONTAL_ALIGNMENT_LEFT, -1, 15, col)
		else:
			draw_rect(rect, Color(col, 0.88), true)
			draw_string(fu, rect.position + Vector2(6, 21), s["c"], HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Style.BG)
		if i > 0:
			var tri := PackedVector2Array([Vector2(x0, y - 2), Vector2(x0 - 7, y - 14), Vector2(x0 + 7, y - 14)])
			if s["planned"]:
				if first_planned_stop and name == "ADAPTIVE":
					first_planned_stop = false
					var pulse := 0.55 + 0.45 * sin(Time.get_ticks_msec() / 160.0)
					draw_colored_polygon(tri, Color(Style.CYAN, pulse))
				else:
					draw_polyline(PackedVector2Array([tri[0], tri[1], tri[2], tri[0]]), Style.AMBER, 2.0)
			else:
				draw_colored_polygon(tri, Style.RED)


func _legend_tri(p: Vector2, filled: bool, col: Color, text: String, fu: Font) -> void:
	var tri := PackedVector2Array([p + Vector2(0, 2), p + Vector2(-6, 14), p + Vector2(6, 14)])
	if filled:
		draw_colored_polygon(tri, col)
	else:
		draw_polyline(PackedVector2Array([tri[0], tri[1], tri[2], tri[0]]), col, 2.0)
	draw_string(fu, p + Vector2(12, 14), text, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Style.MUTED)
