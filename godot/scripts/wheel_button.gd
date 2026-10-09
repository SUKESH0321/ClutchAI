class_name WheelButton
extends Control
## Floating racing-wheel button (drawn with the canvas API): rubber tyre with tread, red compound band,
## metallic five-spoke rim. Floats gently, the rim turns on hover and when the console is open.

signal pressed

var open: bool = false
var badge: String = ""
var _hover: bool = false
var _angle: float = 0.0
var _target_angle: float = 0.0
var _scale_now: float = 1.0
var _t: float = 0.0
const R := 42.0


func _init() -> void:
	custom_minimum_size = Vector2(110, 110)
	size = Vector2(110, 110)
	mouse_filter = Control.MOUSE_FILTER_STOP
	tooltip_text = "Race Control & Telemetry  (C)"
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND


func _ready() -> void:
	mouse_entered.connect(func() -> void: _hover = true)
	mouse_exited.connect(func() -> void: _hover = false)


func set_open(v: bool) -> void:
	open = v
	tooltip_text = ("Close console  (C)" if v else "Race Control & Telemetry  (C)")


func _gui_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		pressed.emit()
		accept_event()


func _process(dt: float) -> void:
	_t += dt
	_target_angle = (TAU * 0.4 if _hover else 0.0) + (TAU * 0.4 if open else 0.0)
	_angle = lerp(_angle, _target_angle, 1.0 - exp(-5.0 * dt))
	_scale_now = lerp(_scale_now, 1.1 if _hover else 1.0, 1.0 - exp(-12.0 * dt))
	queue_redraw()


func _draw() -> void:
	var c := size / 2.0 + Vector2(0, sin(_t * 1.8) * 4.0)      # gentle float
	# soft glow + shadow
	for i in 6:
		draw_circle(c, (R + 12 - i * 2) * _scale_now, Color(1.0, 0.23, 0.28, 0.035 + (0.03 if _hover else 0.0)))
	draw_circle(c + Vector2(0, 7), R * _scale_now, Color(0, 0, 0, 0.35))
	var r := R * _scale_now
	# tyre
	draw_circle(c, r, Color("#120b0d"))
	draw_circle(c, r * 0.97, Color("#241619"))
	for i in 40:
		var a := TAU * i / 40.0
		draw_line(c + Vector2(cos(a), sin(a)) * r * 0.9, c + Vector2(cos(a), sin(a)) * r, Color("#070405"), 3.0)
	draw_arc(c, r * 0.79, 0.0, TAU, 64, Color("#ff3b47"), 3.4, true)
	draw_arc(c, r * 0.79, 0.0, TAU, 64, Color(1, 1, 1, 0.25), 1.0, true)
	draw_circle(c, r * 0.73, Color("#140a0c"))
	# rim
	var rim := r * 0.69
	draw_circle(c, rim, Color("#cfc7c9"))
	draw_circle(c, rim * 0.86, Color("#1b1012"))
	for k in 5:
		var a2 := _angle + TAU * k / 5.0 - PI / 2.0
		var dir := Vector2(cos(a2), sin(a2))
		var perp := Vector2(-dir.y, dir.x)
		var pts := PackedVector2Array([
			c + dir * rim * 0.22 + perp * 3.4, c + dir * rim * 0.92 + perp * 5.2,
			c + dir * rim * 0.92 - perp * 5.2, c + dir * rim * 0.22 - perp * 3.4,
		])
		draw_colored_polygon(pts, Color("#e6dfe0"))
		draw_line(c + dir * rim * 0.3, c + dir * rim * 0.88, Color(1, 1, 1, 0.55), 1.2)
	draw_arc(c, rim * 0.86, 0.0, TAU, 48, Color("#8d8084"), 2.0, true)
	draw_circle(c, rim * 0.3, Color("#8d8084"))
	draw_circle(c, rim * 0.2, Color("#ff3b47"))
	draw_circle(c, rim * 0.08, Color("#2a0a10"))
	# highlight
	draw_arc(c, r * 0.9, PI * 1.05, PI * 1.45, 16, Color(1, 1, 1, 0.22), 3.0, true)
	if badge != "":
		var f := Style.font("display")
		var tw := f.get_string_size(badge, HORIZONTAL_ALIGNMENT_LEFT, -1, 18).x
		var br := Rect2(Vector2(size.x - tw - 20, 4), Vector2(tw + 14, 24))
		var pulse := 0.65 + 0.35 * sin(_t * 6.0)
		draw_rect(br, Color(1.0, 0.23, 0.28, pulse), true)
		draw_string(f, br.position + Vector2(7, 18), badge, HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color.WHITE)
