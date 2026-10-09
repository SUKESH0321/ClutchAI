class_name Plot
extends Control
## Minimal line chart drawn with the canvas API (no add-ons). Used for tyre wear and lap time.
## series: [{pts: PackedVector2Array, color: Color, dashed: bool, width: float, dots: bool}]
## shade:  [{x0, x1, color}] background bands (safety-car / wet laps);  vlines: [{x, color}]

var title: String = ""
var series: Array = []
var shade: Array = []
var vlines: Array = []
var x_max: float = 25.0
var y_min: float = 0.0
var y_max: float = 1.0
var hline: float = -1.0
var hline_label: String = ""
var y_scale: float = 1.0          # multiply tick values (e.g. 100 for percent)
var y_suffix: String = ""
var y_decimals: int = 0
var cursor_x: float = -1.0


func _init() -> void:
	custom_minimum_size = Vector2(300, 170)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func set_data(p_series: Array, p_shade: Array, p_vlines: Array, p_x_max: float, p_y_min: float, p_y_max: float, p_hline: float = -1.0) -> void:
	series = p_series; shade = p_shade; vlines = p_vlines
	x_max = p_x_max; y_min = p_y_min; y_max = p_y_max; hline = p_hline
	queue_redraw()


func _draw() -> void:
	var f := Style.font("mono")
	var r := Rect2(Vector2(50, 22), size - Vector2(64, 44))
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.08, 0.01, 0.03, 0.35))
	draw_string(Style.font("ui"), Vector2(8, 15), title.to_upper(), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Style.MUTED)
	for b in shade:
		var x0 := _px(float(b["x0"]), r)
		var x1 := _px(float(b["x1"]), r)
		draw_rect(Rect2(Vector2(x0, r.position.y), Vector2(x1 - x0, r.size.y)), b["color"])
	for i in 5:
		var fy := r.position.y + r.size.y * i / 4.0
		draw_line(Vector2(r.position.x, fy), Vector2(r.end.x, fy), Color(1, 0.5, 0.55, 0.12), 1.0)
		var v := y_max - (y_max - y_min) * i / 4.0
		draw_string(f, Vector2(4, fy + 4), ("%." + str(y_decimals) + "f%s") % [v * y_scale, y_suffix], HORIZONTAL_ALIGNMENT_LEFT, 46, 10, Style.MUTED)
	var step := 5 if x_max > 12 else 1
	var xi := 1
	while xi <= int(x_max):
		draw_string(f, Vector2(_px(float(xi), r) - 6, size.y - 8), str(xi), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Style.MUTED)
		xi += step
	if hline >= 0.0:
		var hy := _py(hline, r)
		_dashed(Vector2(r.position.x, hy), Vector2(r.end.x, hy), Style.RED, 1.5)
		draw_string(f, Vector2(r.end.x - 70, hy - 4), hline_label, HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Style.RED)
	for v in vlines:
		var vx := _px(float(v["x"]), r)
		draw_line(Vector2(vx, r.position.y), Vector2(vx, r.end.y), v["color"], 1.0)
	if cursor_x >= 0.0:
		var cx := _px(cursor_x, r)
		draw_line(Vector2(cx, r.position.y), Vector2(cx, r.end.y), Color(1, 1, 1, 0.35), 1.0)
	for s in series:
		var pts: PackedVector2Array = s["pts"]
		if pts.size() == 0:
			continue
		var mapped := PackedVector2Array()
		for p in pts:
			mapped.append(Vector2(_px(p.x, r), _py(p.y, r)))
		var col: Color = s["color"]
		var w: float = s.get("width", 2.0)
		if mapped.size() >= 2:
			if s.get("dashed", false):
				for i in range(mapped.size() - 1):
					_dashed(mapped[i], mapped[i + 1], col, w)
			else:
				draw_polyline(mapped, col, w, true)
		if s.get("dots", false):
			for m in mapped:
				draw_circle(m, 2.6, col)


func _px(x: float, r: Rect2) -> float:
	return r.position.x + clampf(x / maxf(x_max, 1e-6), 0.0, 1.0) * r.size.x


func _py(y: float, r: Rect2) -> float:
	return r.end.y - clampf((y - y_min) / maxf(y_max - y_min, 1e-6), 0.0, 1.0) * r.size.y


func _dashed(a: Vector2, b: Vector2, col: Color, w: float) -> void:
	var d := b - a
	var len := d.length()
	if len < 0.01:
		return
	var dir := d / len
	var t := 0.0
	while t < len:
		draw_line(a + dir * t, a + dir * minf(t + 6.0, len), col, w)
		t += 11.0
