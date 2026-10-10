class_name Hud
extends CanvasLayer
## Heads-up display: header, timing tower, optimizer card, camera buttons, event toasts, the
## racing-wheel button and the five-tab race console. Everything shown comes from the backend state.

const TAB_NAMES := ["Telemetry", "Strategy engine", "Timeline", "Analytics", "Events & controls"]
const EVENT_COLORS := {
	"RACE_STARTED": "#2fe08a", "RACE_FINISHED": "#4fe0f7", "PIT_STOP": "#ff3b47", "FORCED_PIT": "#ff3b47",
	"STRATEGY_RECALCULATED": "#4fe0f7", "RECOMMENDATION_CHANGED": "#b28cff", "SC_DEPLOYED": "#ffb020",
	"SC_WITHDRAWN": "#ffb020", "RAIN_STARTED": "#2f8bff", "RAIN_CHANGED": "#2f8bff", "RAIN_STOPPED": "#2f8bff",
	"WEATHER_CHANGED": "#2f8bff", "MANUAL_EVENT": "#fff4f1", "WARNING": "#ffb020",
}

var console_open: bool = false
var main: Node
var s: Dictionary = {}

var root: Control
var _w: Dictionary = {}                # named widgets
var _rows: Dictionary = {}             # timing tower rows: id -> PanelContainer
var _tower: Control
var _cam_buttons: Array = []
var _tower_t: float = 0.0
var _toast: Label
var _toast_t: float = 0.0
var _last_event_id: int = 0
var _console: PanelContainer
var _tabs: TabContainer
var _wheel: WheelButton
var _console_tween: Tween
var _rec_sig: String = ""
var _flash_t: float = 0.0
var _lap_cells: Array = []
var _bench_loaded_for: String = ""


func bind(m: Node) -> void:
	main = m
	_build()
	Backend.connection_changed.connect(_on_conn)
	Backend.api_error.connect(_on_api_error)
	main.camera_mode_changed.connect(_on_cam_mode)
	main.selection_changed.connect(func(_id: String) -> void: _refresh_selected())
	_on_conn(Backend.online)
	_on_cam_mode(main.cam_mode)


func _on_conn(online: bool) -> void:
	_w["conn"].text = "LIVE FEED / WEBSOCKET" if online else "BACKEND OFFLINE"
	(_w["conn_dot"] as ColorRect).color = Style.GREEN if online else Style.RED
	_w["offline"].visible = not online


func _on_api_error(msg: String) -> void:
	_w["err"].text = msg
	_show_toast("ERROR: " + msg, Style.RED)


func _on_cam_mode(m: int) -> void:
	for i in _cam_buttons.size():
		var b: Button = _cam_buttons[i]
		b.add_theme_stylebox_override("normal", Style.box(Color(0.93, 0.18, 0.25) if i == m else Color(0.34, 0.10, 0.16, 0.95), Color(1, 0.42, 0.46) if i == m else Color(0.78, 0.30, 0.38, 0.9), 4))


# ------------------------------------------------------------------ build
## Anchor `c` to a screen corner/edge and place it with explicit offsets; it grows away from the anchor.
func _pin(c: Control, anchor_x: float, anchor_y: float, off_x: float, off_y: float) -> void:
	c.anchor_left = anchor_x
	c.anchor_right = anchor_x
	c.anchor_top = anchor_y
	c.anchor_bottom = anchor_y
	c.offset_left = off_x
	c.offset_right = off_x
	c.offset_top = off_y
	c.offset_bottom = off_y
	c.grow_horizontal = Control.GROW_DIRECTION_BEGIN if anchor_x > 0.75 else (Control.GROW_DIRECTION_BOTH if anchor_x > 0.25 else Control.GROW_DIRECTION_END)
	c.grow_vertical = Control.GROW_DIRECTION_BEGIN if anchor_y > 0.75 else Control.GROW_DIRECTION_END


func _build() -> void:
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_build_rain_overlay()
	_build_header()
	_build_left()
	_build_reco_card()
	_build_selected_card()
	_build_lap_strip()
	_build_toast()
	_build_console()
	_build_wheel()
	_build_offline()


func _build_rain_overlay() -> void:
	var rect := ColorRect.new()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rect.color = Color.WHITE
	var mat := ShaderMaterial.new()
	mat.shader = load("res://assets/rain.gdshader")
	mat.set_shader_parameter("intensity", 0.0)
	rect.material = mat
	_w["rain_mat"] = mat
	_w["rain_rect"] = rect
	rect.visible = false             # a full-screen shader costs fill-rate even at zero intensity: only draw it in the wet
	root.add_child(rect)


func set_rain(v: float) -> void:
	(_w["rain_mat"] as ShaderMaterial).set_shader_parameter("intensity", v)
	(_w["rain_rect"] as ColorRect).visible = v > 0.02


func _mk_vbox(sep: int = 4) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", sep)
	return v


func _mk_hbox(sep: int = 8) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", sep)
	return h


func _readout(title: String, key: String, size: int = 30) -> VBoxContainer:
	var v := _mk_vbox(0)
	v.add_child(Style.label(title.to_upper(), 10, Style.MUTED, "ui"))
	var l := Style.label("--", size, Style.INK, "display")
	_w[key] = l
	v.add_child(l)
	return v


func _build_header() -> void:
	var bar := PanelContainer.new()
	bar.add_theme_stylebox_override("panel", Style.box(Color(0.2, 0.05, 0.08, 0.93), Color(1, 0.35, 0.42, 0.45), 0, 1))
	bar.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	bar.custom_minimum_size = Vector2(0, 66)
	root.add_child(bar)
	var h := _mk_hbox(22)
	bar.add_child(h)
	var title := _mk_vbox(0)
	var status_row := _mk_hbox(6)
	var dot := ColorRect.new()
	dot.custom_minimum_size = Vector2(8, 8)
	dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_w["conn_dot"] = dot
	status_row.add_child(dot)
	var conn := Style.label("CONNECTING", 10, Style.MUTED, "ui")
	_w["conn"] = conn
	status_row.add_child(conn)
	title.add_child(status_row)
	var t := RichTextLabel.new()
	t.bbcode_enabled = true
	t.fit_content = true
	t.scroll_active = false
	t.custom_minimum_size = Vector2(430, 34)
	t.mouse_filter = Control.MOUSE_FILTER_IGNORE
	t.add_theme_font_override("normal_font", Style.font("display"))
	t.add_theme_font_size_override("normal_font_size", 28)
	t.text = "CLUTCH[color=#ff3b47]AI[/color]  [font_size=13][color=#cfb0b4]GODOT 3D[/color][/font_size]"
	title.add_child(t)
	h.add_child(title)
	h.add_child(_readout("Status", "status"))
	h.add_child(_readout("Lap", "lap"))
	h.add_child(_readout("Elapsed", "elapsed"))
	h.add_child(_readout("vs fixed-stint baseline", "gap"))
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(sp)
	h.add_child(_race_buttons(false))


## Start/pause/resume/step/finish/reset + speed. One implementation reused by the header and console.
func _race_buttons(with_speed_buttons: bool) -> Control:
	var h := _mk_hbox(6)
	var spec := [["Start", "start", true], ["Pause", "pause", false], ["Resume", "resume", false],
		["Step lap", "step", false], ["Finish", "finish", false], ["Reset", "reset", false]]
	for sp in spec:
		var b := Style.button(sp[0], sp[2], Style.AMBER if sp[1] == "reset" else Color.TRANSPARENT)
		b.pressed.connect(_on_race_button.bind(sp[1]))
		h.add_child(b)
		var key: String = "btn_" + str(sp[1]) + ("_c" if with_speed_buttons else "")
		_w[key] = b
	var lab := Style.label("SPEED", 11, Style.MUTED, "ui")
	h.add_child(lab)
	if with_speed_buttons:
		for v in [0.5, 1, 2, 4, 8, 16]:
			var sb := Style.button("%sx" % str(v))
			sb.pressed.connect(func() -> void: Backend.set_speed(float(v)))
			h.add_child(sb)
	else:
		var ob := OptionButton.new()
		ob.focus_mode = Control.FOCUS_NONE
		ob.add_theme_font_override("font", Style.font("ui"))
		ob.add_theme_font_size_override("font_size", 16)
		ob.add_theme_stylebox_override("normal", Style.box(Color(0.34, 0.10, 0.16, 0.95), Color(0.78, 0.30, 0.38, 0.9), 4))
		ob.add_theme_stylebox_override("hover", Style.box(Color(0.45, 0.14, 0.22), Color(1, 0.4, 0.45), 4))
		for v in [0.5, 1, 2, 4, 8, 16]:
			ob.add_item("%sx" % str(v))
			ob.set_item_metadata(ob.item_count - 1, float(v))
		ob.item_selected.connect(func(i: int) -> void: Backend.set_speed(float(ob.get_item_metadata(i))))
		_w["speed_opt"] = ob
		h.add_child(ob)
	return h


func _on_race_button(which: String) -> void:
	match which:
		"start": Backend.start()
		"pause": Backend.pause()
		"resume": Backend.resume()
		"step": Backend.step()
		"finish": Backend.finish()
		"reset": Backend.reset(str(s.get("config_name", "demo")))


func _build_left() -> void:
	var col := _mk_vbox(8)
	root.add_child(col)
	_pin(col, 0.0, 0.0, 12, 78)
	# track selector: the backend resets the race on the chosen circuit and every client (this one included) rebuilds for it
	var trk := _mk_hbox(6)
	trk.add_child(Style.label("TRACK (T)", 11, Style.MUTED, "ui"))
	var opt := OptionButton.new()
	var ids := ["silverstone", "spa", "monza", "zandvoort"]
	var labels := ["Silverstone", "Spa-Francorchamps", "Monza", "Zandvoort"]
	for k in ids.size():
		opt.add_item(labels[k], k)
	opt.selected = maxi(0, ids.find(main.circuit_id))
	opt.add_theme_font_size_override("font_size", 14)
	opt.item_selected.connect(func(idx: int) -> void: main.change_circuit(ids[idx]))
	trk.add_child(opt)
	col.add_child(trk)
	# scenario / demo selector: each is a backend config; picking one resets the race on the current circuit
	var scn := _mk_hbox(6)
	scn.add_child(Style.label("DEMO", 11, Style.MUTED, "ui"))
	var sopt := OptionButton.new()
	var cfgs := ["demo", "demo_win_rain", "demo_win_chaos", "demo_underdog_rain", "demo_win_sc", "demo_win_dry", "demo_scripted", "default"]
	var clabels := ["Default demo (dry)", "WIN: fast car, rain", "WIN: rain + safety car", "WIN: mid-field car, rain", "Fast car, safety car", "Fast car, dry (tie)", "Scripted rain + SC", "Random events"]
	for k in cfgs.size():
		sopt.add_item(clabels[k], k)
	sopt.selected = maxi(0, cfgs.find(str(main.state.get("config_name", "demo"))))
	sopt.add_theme_font_size_override("font_size", 14)
	sopt.item_selected.connect(func(idx: int) -> void: main.change_scenario(cfgs[idx]))
	scn.add_child(sopt)
	_w["demo_opt"] = sopt
	_w["demo_cfgs"] = cfgs
	col.add_child(scn)
	var cams := _mk_hbox(4)
	var names := ["1 Chase", "2 Broadcast", "3 Top", "4 Orbit", "5 Hood"]
	for i in names.size():
		var b := Style.button(names[i])
		b.add_theme_font_size_override("font_size", 14)
		b.pressed.connect(func() -> void: main.set_camera_mode(i))
		cams.add_child(b)
		_cam_buttons.append(b)
	col.add_child(cams)
	var pan := Style.panel(0.82)
	pan.custom_minimum_size = Vector2(230, 0)
	col.add_child(pan)
	var v := _mk_vbox(4)
	pan.add_child(v)
	var head := _mk_hbox(0)
	head.add_child(Style.label("LIVE ORDER", 11, Style.MUTED, "ui"))
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(sp)
	var lap_l := Style.label("", 11, Style.MUTED, "ui")
	_w["tower_lap"] = lap_l
	head.add_child(lap_l)
	v.add_child(head)
	_tower = Control.new()
	_tower.custom_minimum_size = Vector2(210, 8 * 29)
	v.add_child(_tower)
	var note := Style.label("Rivals are simulated AI (rule-based).", 9, Style.MUTED)
	v.add_child(note)


func _build_reco_card() -> void:
	var pan := Style.panel(0.86, Style.GREEN)
	pan.custom_minimum_size = Vector2(300, 0)
	root.add_child(pan)
	_pin(pan, 1.0, 0.0, -12, 78)
	_w["reco_panel"] = pan
	var v := _mk_vbox(2)
	pan.add_child(v)
	var cond := _mk_hbox(8)
	var wl := Style.label("DRY 0.00", 12, Style.MUTED, "monob")
	_w["cond"] = wl
	cond.add_child(wl)
	var scl := Style.label("", 12, Style.AMBER, "monob")
	_w["sc_chip"] = scl
	cond.add_child(scl)
	v.add_child(cond)
	v.add_child(Style.label("OPTIMIZER RECOMMENDATION", 10, Style.MUTED, "ui"))
	var act := Style.label("--", 34, Style.GREEN, "display")
	_w["reco_action"] = act
	v.add_child(act)
	var sub := Style.label("", 12, Style.INK)
	_w["reco_sub"] = sub
	v.add_child(sub)
	var adv := Style.label("", 11, Style.MUTED)
	_w["reco_adv"] = adv
	v.add_child(adv)
	var note := Style.label("Proposal only: executed when the simulation boxes the car.", 10, Style.MUTED)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size = Vector2(270, 0)
	v.add_child(note)


func _build_selected_card() -> void:
	var pan := Style.panel(0.86)
	pan.custom_minimum_size = Vector2(290, 0)
	root.add_child(pan)
	_pin(pan, 0.0, 1.0, 12, -12)
	_w["sel_panel"] = pan
	var v := _mk_vbox(4)
	pan.add_child(v)
	var top := _mk_hbox(8)
	var name_l := Style.label("--", 22, Style.INK, "display")
	_w["sel_name"] = name_l
	top.add_child(name_l)
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(sp)
	var pos := Style.label("P-", 30, Style.INK, "display")
	_w["sel_pos"] = pos
	top.add_child(pos)
	v.add_child(top)
	var kind := Style.label("", 10, Style.MUTED, "ui")
	_w["sel_kind"] = kind
	v.add_child(kind)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 14)
	for k in ["tyre", "age", "fuel", "last", "stops", "gap"]:
		var cell := _mk_vbox(0)
		cell.add_child(Style.label(k.to_upper(), 9, Style.MUTED, "ui"))
		var l := Style.label("--", 12, Style.INK)
		_w["sel_" + k] = l
		cell.add_child(l)
		grid.add_child(cell)
	v.add_child(grid)


func _build_lap_strip() -> void:
	var pan := Style.panel(0.7)
	pan.custom_minimum_size = Vector2(380, 0)
	root.add_child(pan)
	_pin(pan, 0.5, 0.0, 40, 78)
	var h := _mk_hbox(2)
	h.name = "LapStrip"
	pan.add_child(h)
	_w["lap_strip"] = h


func _build_toast() -> void:
	_toast = Style.label("", 20, Style.INK, "display")
	_toast.add_theme_stylebox_override("normal", Style.box(Color(0.14, 0.03, 0.05, 0.94), Style.RED, 4))
	_toast.visible = false
	root.add_child(_toast)
	_pin(_toast, 0.5, 0.0, 40, 120)


func _build_offline() -> void:
	var l := Style.label("Connecting to the strategy backend on %s\nStart it:  python -m uvicorn app.main:app --port 8000   (from backend/)" % Backend.host, 18, Style.INK, "ui")
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.set_anchors_preset(Control.PRESET_CENTER)
	l.grow_horizontal = Control.GROW_DIRECTION_BOTH
	l.grow_vertical = Control.GROW_DIRECTION_BOTH
	l.add_theme_stylebox_override("normal", Style.box(Color(0.14, 0.03, 0.05, 0.92), Style.RED, 6))
	_w["offline"] = l
	root.add_child(l)


func _build_wheel() -> void:
	_wheel = WheelButton.new()
	root.add_child(_wheel)
	_pin(_wheel, 0.5, 1.0, 0, -12)
	_wheel.offset_left = -55
	_wheel.offset_right = 55
	_wheel.offset_top = -122
	_wheel.offset_bottom = -12
	_wheel.pressed.connect(func() -> void: open_console(not console_open))


# ------------------------------------------------------------------ console
func _build_console() -> void:
	_console = PanelContainer.new()
	_console.add_theme_stylebox_override("panel", Style.box(Color(0.19, 0.05, 0.08, 0.96), Color(1, 0.43, 0.48, 0.5), 14, 1))
	_console.custom_minimum_size = Vector2(1120, 440)
	_console.visible = false
	root.add_child(_console)
	_console.anchor_left = 0.5
	_console.anchor_right = 0.5
	_console.anchor_top = 1.0
	_console.anchor_bottom = 1.0
	_set_console_y(-150.0)
	var v := _mk_vbox(4)
	_console.add_child(v)
	var head := _mk_hbox(10)
	head.add_child(Style.label("RACE CONTROL / LIVE TELEMETRY", 24, Style.INK, "display"))
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(sp)
	var close := Style.button("✕ Close")
	close.pressed.connect(func() -> void: open_console(false))
	head.add_child(close)
	v.add_child(head)
	_tabs = TabContainer.new()
	_tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_tabs.add_theme_font_override("font_selected", Style.font("ui"))
	_tabs.add_theme_font_override("font_unselected", Style.font("ui"))
	_tabs.add_theme_font_size_override("font_size", 17)
	_tabs.add_theme_color_override("font_selected_color", Color.WHITE)
	_tabs.add_theme_color_override("font_unselected_color", Style.MUTED)
	_tabs.add_theme_color_override("font_hovered_color", Color.WHITE)
	_tabs.add_theme_stylebox_override("panel", Style.box(Color(0.1, 0.02, 0.04, 0.35), Style.LINE, 8))
	_tabs.add_theme_stylebox_override("tab_selected", Style.box(Color(0.55, 0.14, 0.2, 0.9), Style.RED, 4))
	_tabs.add_theme_stylebox_override("tab_unselected", Style.box(Color(0.22, 0.06, 0.09, 0.8), Style.LINE, 4))
	_tabs.add_theme_stylebox_override("tab_hovered", Style.box(Color(0.35, 0.09, 0.14, 0.9), Style.LINE, 4))
	v.add_child(_tabs)
	_tabs.add_child(_tab_telemetry())
	_tabs.add_child(_tab_strategy())
	_tabs.add_child(_tab_timeline())
	_tabs.add_child(_tab_analytics())
	_tabs.add_child(_tab_events())
	for i in TAB_NAMES.size():
		_tabs.set_tab_title(i, TAB_NAMES[i])
	_tabs.tab_changed.connect(_on_tab_changed)


## Console rests with its bottom edge `bottom` pixels from the screen bottom (negative = above).
func _set_console_y(bottom: float) -> void:
	_console.offset_left = -560.0
	_console.offset_right = 560.0
	_console.offset_bottom = bottom
	_console.offset_top = bottom - 440.0


func _console_y() -> float:
	return _console.offset_bottom


func open_console(v: bool) -> void:
	if v == console_open:
		return
	console_open = v
	_wheel.set_open(v)
	if main:
		main.set_drawer_open(v)
	if _console_tween:
		_console_tween.kill()
	_console_tween = create_tween().set_parallel(true).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	if v:
		_console.visible = true
		_console.modulate.a = 0.0
		_set_console_y(-110.0)
		_console_tween.tween_method(_set_console_y, -110.0, -150.0, 0.35)
		_console_tween.tween_property(_console, "modulate:a", 1.0, 0.25)
		_refresh_console()
		_on_tab_changed(_tabs.current_tab)
	else:
		_console_tween.tween_method(_set_console_y, _console_y(), -110.0, 0.25)
		_console_tween.tween_property(_console, "modulate:a", 0.0, 0.2)
		_console_tween.chain().tween_callback(func() -> void: _console.visible = false)
	if v and not s.is_empty():
		_wheel.badge = ""


func set_tab(i: int) -> void:
	_tabs.current_tab = clampi(i, 0, TAB_NAMES.size() - 1)


func _on_tab_changed(i: int) -> void:
	_refresh_console()
	if i == 3:
		_load_benchmark()


func _section(title: String) -> VBoxContainer:
	var v := _mk_vbox(4)
	v.add_child(Style.label(title.to_upper(), 11, Style.MUTED, "ui"))
	return v


func _stat(box: Control, title: String, key: String, size: int = 22) -> Label:
	var c := _mk_vbox(0)
	c.add_child(Style.label(title.to_upper(), 9, Style.MUTED, "ui"))
	var l := Style.label("--", size, Style.INK, "display")
	_w[key] = l
	c.add_child(l)
	box.add_child(c)
	return l


func _bar(key: String, col: Color) -> ProgressBar:
	var b := ProgressBar.new()
	b.min_value = 0
	b.max_value = 100
	b.show_percentage = false
	b.custom_minimum_size = Vector2(0, 12)
	var bg := Style.box(Color(0.3, 0.08, 0.12, 0.9), Color.TRANSPARENT, 3, 0)
	var fg := Style.box(col, Color.TRANSPARENT, 3, 0)
	b.add_theme_stylebox_override("background", bg)
	b.add_theme_stylebox_override("fill", fg)
	_w[key] = b
	_w[key + "_fill"] = fg
	return b


func _tab_telemetry() -> Control:
	var h := _mk_hbox(30)
	h.name = "Telemetry"
	var tyres := _section("Tyres")
	h.add_child(tyres)
	tyres.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 24)
	g.add_theme_constant_override("v_separation", 8)
	tyres.add_child(g)
	_stat(g, "Compound", "t_comp", 34)
	_stat(g, "Wear", "t_wear", 34)
	_stat(g, "Age", "t_age")
	_stat(g, "Pit stops", "t_stops")
	tyres.add_child(_bar("t_wear_bar", Style.GREEN))
	tyres.add_child(Style.label("TYRE SETS AVAILABLE", 9, Style.MUTED, "ui"))
	var sets := RichTextLabel.new()
	sets.bbcode_enabled = true
	sets.fit_content = true
	sets.scroll_active = false
	sets.add_theme_font_override("normal_font", Style.font("mono"))
	_w["t_sets"] = sets
	tyres.add_child(sets)

	var fuel := _section("Fuel and lap times")
	fuel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(fuel)
	_stat(fuel, "Fuel remaining", "t_fuel", 34)
	fuel.add_child(_bar("t_fuel_bar", Style.GREEN))
	var fs := Style.label("", 11, Style.MUTED)
	_w["t_fuel_note"] = fs
	fuel.add_child(fs)
	var g2 := GridContainer.new()
	g2.columns = 2
	g2.add_theme_constant_override("h_separation", 24)
	fuel.add_child(g2)
	_stat(g2, "Last lap", "t_last")
	_stat(g2, "Best lap", "t_best")

	var cond := _section("Conditions")
	cond.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(cond)
	var g3 := GridContainer.new()
	g3.columns = 2
	g3.add_theme_constant_override("h_separation", 24)
	cond.add_child(g3)
	_stat(g3, "Track", "t_track", 30)
	_stat(g3, "Rain intensity", "t_rain", 30)
	cond.add_child(_bar("t_wet_bar", Style.BLUE))
	var lights := RichTextLabel.new()
	lights.bbcode_enabled = true
	lights.fit_content = true
	lights.scroll_active = false
	lights.add_theme_font_override("normal_font", Style.font("mono"))
	_w["t_lights"] = lights
	cond.add_child(lights)
	var lapbd := RichTextLabel.new()
	lapbd.bbcode_enabled = true
	lapbd.fit_content = true
	lapbd.scroll_active = false
	lapbd.add_theme_font_override("normal_font", Style.font("mono"))
	lapbd.add_theme_font_size_override("normal_font_size", 11)
	_w["t_break"] = lapbd
	cond.add_child(lapbd)
	return h


func _rich(key: String, size: int = 12) -> RichTextLabel:
	var r := RichTextLabel.new()
	r.bbcode_enabled = true
	r.fit_content = false
	r.scroll_active = true
	r.add_theme_font_override("normal_font", Style.font("mono"))
	r.add_theme_font_override("bold_font", Style.font("monob"))
	r.add_theme_font_size_override("normal_font_size", size)
	r.add_theme_font_size_override("bold_font_size", size)
	_w[key] = r
	return r


func _tab_strategy() -> Control:
	var h := _mk_hbox(24)
	h.name = "Strategy engine"
	var left := _mk_vbox(6)
	left.custom_minimum_size = Vector2(330, 0)
	h.add_child(left)
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", Style.box(Color(0.1, 0.4, 0.2, 0.2), Style.GREEN, 4))
	_w["s_card"] = card
	left.add_child(card)
	var cv := _mk_vbox(0)
	card.add_child(cv)
	cv.add_child(Style.label("RECOMMENDED ACTION", 10, Style.MUTED, "ui"))
	var big := Style.label("--", 46, Style.GREEN, "display")
	_w["s_action"] = big
	cv.add_child(big)
	var sub := Style.label("", 12, Style.INK)
	sub.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	sub.custom_minimum_size = Vector2(300, 0)
	_w["s_sub"] = sub
	cv.add_child(sub)
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 24)
	g.add_theme_constant_override("v_separation", 6)
	left.add_child(g)
	_stat(g, "Projected finish", "s_fin", 20)
	_stat(g, "Current plan finish", "s_cur", 20)
	_stat(g, "Advantage vs alt.", "s_adv", 20)
	_stat(g, "Plans checked", "s_plans", 20)
	_stat(g, "Futures sampled", "s_fut", 20)
	_stat(g, "Decision latency", "s_lat", 20)
	var mid := _mk_vbox(6)
	mid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(mid)
	var plans := _rich("s_plans_txt", 12)
	plans.custom_minimum_size = Vector2(0, 110)
	mid.add_child(plans)
	var expl := _rich("s_expl", 12)
	expl.size_flags_vertical = Control.SIZE_EXPAND_FILL
	mid.add_child(expl)
	var right := _mk_vbox(4)
	right.custom_minimum_size = Vector2(290, 0)
	h.add_child(right)
	right.add_child(Style.label("TOP CANDIDATES (expected finish, p10-p90)", 10, Style.MUTED, "ui"))
	var cands := _rich("s_cands", 12)
	cands.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right.add_child(cands)
	return h


func _tab_timeline() -> Control:
	var v := _mk_vbox(8)
	v.name = "Timeline"
	var tl := TimelineView.new()
	tl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tl.custom_minimum_size = Vector2(0, 180)
	_w["timeline"] = tl
	v.add_child(tl)
	v.add_child(Style.label("The baseline lane shows only what the fixed-stint car has actually done under the same events.", 11, Style.MUTED))
	return v


func _tab_analytics() -> Control:
	var v := _mk_vbox(8)
	v.name = "Analytics"
	v.add_child(Style.label("Solid lines: measured simulation output.   Dashed cyan: optimizer projection.   Benchmark: simulated paired races.", 11, Style.MUTED))
	var h := _mk_hbox(10)
	v.add_child(h)
	var wear := Plot.new()
	wear.title = "Tyre wear vs lap"
	wear.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	wear.y_scale = 100.0
	wear.y_suffix = "%"
	wear.hline_label = "wear limit"
	_w["plot_wear"] = wear
	h.add_child(wear)
	var lt := Plot.new()
	lt.title = "Lap time vs lap (pit loss excluded)"
	lt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	lt.y_suffix = "s"
	_w["plot_lap"] = lt
	h.add_child(lt)
	var bench := _rich("bench", 12)
	bench.size_flags_vertical = Control.SIZE_EXPAND_FILL
	bench.custom_minimum_size = Vector2(0, 120)
	v.add_child(bench)
	return v


func _tab_events() -> Control:
	var h := _mk_hbox(18)
	h.name = "Events & controls"
	var left := _mk_vbox(8)
	left.custom_minimum_size = Vector2(430, 0)
	h.add_child(left)
	left.add_child(Style.label("RACE CONTROLS", 10, Style.MUTED, "ui"))
	left.add_child(_race_buttons(true))
	left.add_child(Style.label("INJECT EVENTS (apply from the next lap; the optimizer replans immediately)", 10, Style.MUTED, "ui"))
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 6)
	g.add_theme_constant_override("v_separation", 6)
	left.add_child(g)
	var evs := [["Light rain", "RAIN", 0.4, Style.BLUE, "rain_light"], ["Heavy rain", "RAIN", 0.8, Style.BLUE, "rain_heavy"], ["Clear rain", "CLEAR", -1.0, Color.TRANSPARENT, "clear"],
		["Deploy safety car", "SC_DEPLOY", -1.0, Style.AMBER, "sc_deploy"], ["Withdraw safety car", "SC_WITHDRAW", -1.0, Style.AMBER, "sc_withdraw"]]
	for e in evs:
		var b := Style.button(e[0], false, e[3])
		b.pressed.connect(func() -> void: Backend.event(e[1], e[2]))
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		g.add_child(b)
		_w["ev_" + str(e[4])] = b
	var rb := Style.button("Force strategy refresh")
	rb.pressed.connect(func() -> void: Backend.get_json("/api/strategy/recommendation?refresh=true", func(_r: Variant, ok: bool) -> void:
		if not ok:
			_on_api_error("refresh failed")))
	g.add_child(rb)
	var err := Style.label("", 11, Style.RED)
	err.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_w["err"] = err
	left.add_child(err)
	var log := _rich("log", 11)
	log.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	log.size_flags_vertical = Control.SIZE_EXPAND_FILL
	h.add_child(log)
	return h


# ------------------------------------------------------------------ updates
func on_state(state: Dictionary) -> void:
	if _w.has("demo_opt"):
		var ci: int = (_w["demo_cfgs"] as Array).find(str(state.get("config_name", "")))
		if ci >= 0 and (_w["demo_opt"] as OptionButton).selected != ci:
			(_w["demo_opt"] as OptionButton).select(ci)
	s = state
	var status: String = state["status"]
	var col := {"idle": Style.MUTED, "running": Style.GREEN, "paused": Style.AMBER, "finished": Style.CYAN}.get(status, Style.INK) as Color
	_w["status"].text = status.to_upper()
	_w["status"].add_theme_color_override("font_color", col)
	_w["lap"].text = "%02d/%d" % [int(state["lap"]), int(state["total_laps"])]
	_w["elapsed"].text = Style.fmt_clock(float(state["elapsed_s"]))
	var b: Variant = state.get("baseline")
	var gap := float(b["gap_s"]) if typeof(b) == TYPE_DICTIONARY else 0.0
	_w["gap"].text = "--" if int(state["lap"]) == 0 else "%+.1fs" % gap
	_w["gap"].add_theme_color_override("font_color", Style.GREEN if gap > 0.05 else (Style.RED if gap < -0.05 else Style.INK))
	var opt := _w["speed_opt"] as OptionButton
	for i in opt.item_count:
		if absf(float(opt.get_item_metadata(i)) - float(state["speed"])) < 1e-6:
			opt.select(i)
	_w["btn_start"].disabled = status != "idle"
	_w["btn_pause"].disabled = status != "running"
	_w["btn_resume"].disabled = status != "paused"
	_w["btn_step"].disabled = not (status == "idle" or status == "paused")
	_w["btn_finish"].disabled = status == "finished"
	for k in ["start", "pause", "resume", "step", "finish"]:
		var cb: Button = _w.get("btn_" + k + "_c")
		if cb:
			cb.disabled = (_w["btn_" + k] as Button).disabled
	var cond: Dictionary = state["conditions"]
	_w["cond"].text = "%s %.2f" % [str(cond["weather"]), float(cond["track_wetness"])]
	_w["cond"].add_theme_color_override("font_color", Style.MUTED if cond["weather"] == "DRY" else Style.BLUE)
	_w["sc_chip"].text = "SAFETY CAR" if cond["safety_car"] else ""
	_update_reco()
	_update_lap_strip()
	_refresh_selected()
	_update_events()
	if console_open:
		_refresh_console()
	# badge on the wheel while the console is closed and the optimizer wants a stop
	var r: Variant = state.get("recommendation")
	_wheel.badge = "BOX" if (not console_open and typeof(r) == TYPE_DICTIONARY and r["action"] == "BOX_THIS_LAP" and status != "finished") else ""


func _pit_window() -> Variant:
	var r: Variant = s.get("recommendation")
	if typeof(r) != TYPE_DICTIONARY or (r["top_candidates"] as Array).is_empty():
		return null
	var best: float = float(r["top_candidates"][0]["expected_s"])
	var laps: Array = []
	for c in r["top_candidates"]:
		if (c["plan"] as Array).size() > 0 and float(c["expected_s"]) - best <= 1.5:
			laps.append(int(c["plan"][0]["lap"]))
	if laps.is_empty():
		return null
	return [laps.min(), laps.max()]


func _update_reco() -> void:
	var r: Variant = s.get("recommendation")
	if typeof(r) != TYPE_DICTIONARY:
		return
	var done: bool = s["status"] == "finished"
	var box: bool = r["action"] == "BOX_THIS_LAP"
	var planned: bool = (not box) and r["pit_lap"] != null
	var headline := "RACE OVER" if done else ("BOX THIS LAP" if box else ("PIT LAP %d" % int(r["pit_lap"]) if planned else "STAY OUT"))
	var colr := Style.MUTED if done else (Style.RED if box else (Style.AMBER if planned else Style.GREEN))
	var w: Variant = _pit_window()
	var comp: String = str(r["compound"]) if r["compound"] != null else ""
	_w["reco_action"].text = headline
	_w["reco_action"].add_theme_color_override("font_color", colr)
	var win_txt := "no stop planned"
	if w != null:
		win_txt = "window L%d" % w[0] + ("-L%d" % w[1] if w[1] > w[0] else "")
	_w["reco_sub"].text = ("%s  %s" % [comp, win_txt]).strip_edges()
	_w["reco_sub"].add_theme_color_override("font_color", Style.compound_color(comp) if comp != "" else Style.INK)
	_w["reco_adv"].text = "advantage vs next best: %.1fs" % float(r["time_advantage_s"])
	var pan: PanelContainer = _w["reco_panel"]
	pan.add_theme_stylebox_override("panel", Style.box(Color(0.17, 0.045, 0.07, 0.88), colr, 8))
	# flash when the recommendation actually changes
	var sig := "%s|%s" % [str(r["action"]), str(r["plan"])]
	if sig != _rec_sig:
		if _rec_sig != "":
			_flash_t = 1.0
		_rec_sig = sig


func _update_lap_strip() -> void:
	var strip: HBoxContainer = _w["lap_strip"]
	var n: int = int(s["total_laps"])
	if _lap_cells.size() != n:
		for c in strip.get_children():
			c.queue_free()
		_lap_cells.clear()
		for i in n:
			var cell := Label.new()
			cell.custom_minimum_size = Vector2(12, 16)
			cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			cell.add_theme_font_size_override("font_size", 9)
			cell.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			cell.mouse_filter = Control.MOUSE_FILTER_PASS
			cell.tooltip_text = "Lap %d" % (i + 1)
			strip.add_child(cell)
			_lap_cells.append(cell)
	var executed: Array = []
	for l in s["laps"]:
		if l["pitted"]:
			executed.append(int(l["lap"]))
	var proposed: Array = []
	var r: Variant = s.get("recommendation")
	if typeof(r) == TYPE_DICTIONARY:
		for p in r["plan"]:
			proposed.append(int(p["lap"]))
	var w: Variant = _pit_window()
	var lap: int = int(s["lap"])
	for i in n:
		var lapn := i + 1
		var cell2: Label = _lap_cells[i]
		var bg := Color(0.54, 0.23, 0.29) if lapn <= lap else Color(0.23, 0.08, 0.11)
		var txt := ""
		var fg := Color.WHITE
		var border := Color.TRANSPARENT
		if executed.has(lapn):
			bg = Style.GREEN
			txt = "P"
			fg = Color.BLACK
		elif proposed.has(lapn) and lapn > lap:
			txt = "P?"
			fg = Style.RED
			border = Style.RED
		elif w != null and lapn >= w[0] and lapn <= w[1] and lapn > lap:
			border = Style.AMBER
		if lapn == lap + 1 and s["status"] != "finished":
			border = Color.WHITE
		cell2.text = txt
		cell2.add_theme_color_override("font_color", fg)
		cell2.add_theme_stylebox_override("normal", Style.box(bg, border, 1, 1 if border != Color.TRANSPARENT else 0))


func _refresh_selected() -> void:
	if s.is_empty() or main == null:
		return
	var sel_id: String = main.selected_id
	var sel: Dictionary = {}
	for c in s["cars"]:
		if c["id"] == sel_id:
			sel = c
	if sel.is_empty():
		return
	_w["sel_name"].text = "%s  %s" % [sel["code"], sel["name"]]
	_w["sel_pos"].text = "P%d" % int(sel["position"])
	_w["sel_kind"].text = "STRATEGY-CONTROLLED (optimizer)" if sel["is_primary"] else "Simulated competitor (rule-based AI)"
	(_w["sel_panel"] as PanelContainer).add_theme_stylebox_override("panel", Style.box(Color(0.17, 0.045, 0.07, 0.88), Color(sel["color"]), 8))
	var comp: String = sel["compound"]
	_w["sel_tyre"].text = "%s %d%%" % [comp, int(round(float(sel["tyre_wear"]) * 100.0))]
	_w["sel_tyre"].add_theme_color_override("font_color", Style.compound_color(comp))
	_w["sel_age"].text = "%d laps" % int(sel["tyre_age"])
	_w["sel_fuel"].text = "%.1f kg" % float(sel["fuel_kg"])
	_w["sel_last"].text = Style.fmt_lap(sel["last_lap_s"])
	_w["sel_stops"].text = str(int(sel["pit_stops"]))
	_w["sel_gap"].text = "leader" if int(sel["position"]) == 1 else "+%.1fs" % float(sel["gap_to_leader_s"])


func _update_events() -> void:
	var evs: Array = s["events"]
	if evs.is_empty():
		_last_event_id = 0
		return
	var newest: int = int(evs[evs.size() - 1]["id"])
	if newest < _last_event_id:
		_last_event_id = 0
	var hit: Dictionary = {}
	for e in evs:
		if int(e["id"]) > _last_event_id:
			var t: String = e["type"]
			if t.begins_with("RAIN_") or t.begins_with("SC_") or t == "PIT_STOP" or t == "FORCED_PIT":
				hit = e
	if _last_event_id != 0 and not hit.is_empty():
		var t2: String = hit["type"]
		var col := Style.BLUE if t2.begins_with("RAIN") else (Style.AMBER if t2.begins_with("SC") else Style.RED)
		_show_toast(str(hit["message"]), col)
	_last_event_id = newest


func _show_toast(text: String, col: Color) -> void:
	_toast.text = "  " + text.to_upper() + "  "
	_toast.add_theme_color_override("font_color", Color.WHITE)
	_toast.add_theme_stylebox_override("normal", Style.box(Color(0.14, 0.03, 0.05, 0.95), col, 4, 2))
	_toast.visible = true
	_toast.modulate.a = 1.0
	_toast_t = 4.0


func _refresh_console() -> void:
	if s.is_empty() or not console_open:
		return
	match _tabs.current_tab:
		0: _refresh_telemetry()
		1: _refresh_strategy()
		2: (_w["timeline"] as TimelineView).set_state(s)
		3: _refresh_analytics()
		4: _refresh_events_tab()


func _tween_bar(key: String, v: float, col: Color) -> void:
	var b: ProgressBar = _w[key]
	var t := create_tween()
	t.tween_property(b, "value", v, 0.5).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	(_w[key + "_fill"] as StyleBoxFlat).bg_color = col


func _refresh_telemetry() -> void:
	var car: Dictionary = s["car"]
	var cond: Dictionary = s["conditions"]
	var comp: String = car["compound"]
	_w["t_comp"].text = comp
	_w["t_comp"].add_theme_color_override("font_color", Style.compound_color(comp))
	var wear := float(car["tyre_wear"])
	var maxw := float(s["max_wear"])
	_w["t_wear"].text = "%d%%" % int(round(wear * 100.0))
	_w["t_age"].text = "%d laps" % int(car["tyre_age"])
	_w["t_stops"].text = str(int(car["pit_stops"]))
	var frac := wear / maxw
	_tween_bar("t_wear_bar", minf(frac, 1.0) * 100.0, Style.RED if frac > 0.85 else (Style.AMBER if frac > 0.6 else Style.GREEN))
	var sets: Dictionary = car["tyres_available"]
	var txt := ""
	for c in ["SOFT", "MEDIUM", "HARD", "WET"]:
		txt += "[color=#%s]%s x%d[/color]   " % [Style.compound_color(c).to_html(false), c.substr(0, 1), int(sets.get(c, 0))]
	_w["t_sets"].text = txt
	var fs: String = car["fuel_status"]
	var fcol := Style.GREEN if fs == "OK" else (Style.AMBER if fs == "LOW" else Style.RED)
	_w["t_fuel"].text = "%.1f kg" % float(car["fuel_kg"])
	_tween_bar("t_fuel_bar", float(car["fuel_kg"]) / float(car["fuel_initial_kg"]) * 100.0, fcol)
	_w["t_fuel_note"].text = "%s  |  projected at flag %.1f kg  |  reserve %.1f kg" % [fs, float(car["fuel_projected_end_kg"]), float(s["fuel_reserve_kg"])]
	_w["t_last"].text = Style.fmt_lap(car["last_lap_s"])
	_w["t_best"].text = Style.fmt_lap(car["best_lap_s"])
	_w["t_track"].text = str(cond["weather"])
	_w["t_track"].add_theme_color_override("font_color", Style.INK if cond["weather"] == "DRY" else Style.BLUE)
	_w["t_rain"].text = "%.2f" % float(cond["rain_intensity"]) if float(cond["rain_intensity"]) > 0.0 else "none"
	_tween_bar("t_wet_bar", float(cond["track_wetness"]) * 100.0, Style.BLUE)
	var sc: bool = cond["safety_car"]
	var rn: bool = float(cond["rain_intensity"]) > 0.0
	_w["t_lights"].text = "%s   %s\n%s   race %s, lap %d of %d" % [
		"[color=#ffb020]●[/color] safety car OUT" if sc else "[color=#6b4a50]●[/color] safety car in",
		"[color=#2f8bff]●[/color] rain falling" if rn else "[color=#6b4a50]●[/color] no rain",
		"[color=#2fe08a]●[/color]" if s["status"] == "running" else "[color=#6b4a50]●[/color]", s["status"], int(s["lap"]), int(s["total_laps"])]
	var laps: Array = s["laps"]
	if laps.size() > 0:
		var comps: Dictionary = laps[laps.size() - 1]["components"]
		var parts: Array = []
		for k in comps:
			if k != "base" and absf(float(comps[k])) > 0.005:
				parts.append("%s %.2f" % [k, float(comps[k])])
		_w["t_break"].text = "last lap, seconds over base:  " + "  ".join(parts)
	else:
		_w["t_break"].text = "no laps completed yet"


func _plan_bb(plan: Variant) -> String:
	if plan == null:
		return "n/a"
	if (plan as Array).is_empty():
		return "[color=#cfb0b4]no further stop[/color]"
	var out: Array = []
	for p in plan:
		out.append("[color=#%s][b]L%d %s[/b][/color]" % [Style.compound_color(p["compound"]).to_html(false), int(p["lap"]), p["compound"]])
	return "  ".join(out)


func _refresh_strategy() -> void:
	var r: Variant = s.get("recommendation")
	if typeof(r) != TYPE_DICTIONARY:
		return
	var done: bool = s["status"] == "finished"
	var box: bool = r["action"] == "BOX_THIS_LAP"
	var planned: bool = (not box) and r["pit_lap"] != null
	var colr := Style.MUTED if done else (Style.RED if box else (Style.AMBER if planned else Style.GREEN))
	_w["s_action"].text = "RACE OVER" if done else ("BOX THIS LAP" if box else ("PIT LAP %d" % int(r["pit_lap"]) if planned else "STAY OUT"))
	_w["s_action"].add_theme_color_override("font_color", colr)
	var comp: String = str(r["compound"]) if r["compound"] != null else ""
	_w["s_sub"].text = "No further decisions" if done else (("Pit now for %s" % comp) if box else (("Stay out until lap %d, then fit %s" % [int(r["pit_lap"]), comp]) if planned else "No further stop planned"))
	(_w["s_card"] as PanelContainer).add_theme_stylebox_override("panel", Style.box(Color(colr, 0.16 + 0.35 * _flash_t), colr, 4, 2 if _flash_t > 0.0 else 1))
	_w["s_fin"].text = Style.fmt_clock(float(r["projected_finish_s"]))
	_w["s_cur"].text = Style.fmt_clock(float(r["current_plan_projected_finish_s"])) if r["current_plan_projected_finish_s"] != null else "n/a"
	_w["s_adv"].text = "%.1fs" % float(r["time_advantage_s"])
	_w["s_plans"].text = "%d / %d" % [int(r["candidates_evaluated"]), int(r["candidates_feasible"])]
	_w["s_fut"].text = str(int(r["scenarios"]))
	_w["s_lat"].text = "%.0f ms" % float(r["decision_ms"])
	var t := "[b]Optimized plan[/b]    %s\n" % _plan_bb(r["plan"])
	t += "[b]Current plan[/b]      %s   %s\n" % [_plan_bb(r["current_plan"]), Style.fmt_clock(float(r["current_plan_projected_finish_s"])) if r["current_plan_projected_finish_s"] != null else ""]
	var alt: Variant = r.get("best_alternative")
	t += "[b]Best alternative[/b]  %s   %s\n" % [_plan_bb(alt["plan"]) if typeof(alt) == TYPE_DICTIONARY else "none", Style.fmt_clock(float(alt["expected_s"])) if typeof(alt) == TYPE_DICTIONARY else ""]
	for o in r["action_options"]:
		t += "[b]%s[/b]   %s   %s\n" % ["If box now   " if o["action"] == "BOX_THIS_LAP" else "If stay out  ", _plan_bb(o["best_plan"]), Style.fmt_clock(float(o["projected_finish_s"])) if o["projected_finish_s"] != null else ""]
	t += "[color=#cfb0b4]trigger: %s   |   better in %d/%d sampled futures[/color]" % [str(r["trigger"]).replace("_", " "), int(round(float(r["scenario_win_share"]) * int(r["scenarios"]))), int(r["scenarios"])]
	_w["s_plans_txt"].text = t
	var ex := str(r["explanation"])
	var warns: Array = r["warnings"]
	ex += "\n\n" + ("[color=#2fe08a]No feasibility warnings.[/color]" if warns.is_empty() else "[color=#ffb020]" + "\n".join(warns) + "[/color]")
	_w["s_expl"].text = ex
	var ct := ""
	var i := 0
	for c in r["top_candidates"]:
		ct += "%s  [b]%s[/b]\n   [color=#cfb0b4]p10 %s  p90 %s[/color]\n" % [("[color=#2fe08a]★[/color]" if i == 0 else " "), _plan_bb(c["plan"]) + "  " + Style.fmt_clock(float(c["expected_s"])), Style.fmt_clock(float(c["p10_s"])), Style.fmt_clock(float(c["p90_s"]))]
		i += 1
	_w["s_cands"].text = ct


func _refresh_analytics() -> void:
	var n: float = float(s["total_laps"])
	var laps: Array = s["laps"]
	var wear_series: Array = []
	var lap_series: Array = []
	var shade: Array = []
	var vl: Array = []
	var cur_c := ""
	var wpts := PackedVector2Array()
	var lpts := PackedVector2Array()
	var lmin := 1e9
	var lmax := -1e9
	for i in laps.size():
		var l: Dictionary = laps[i]
		var c: String = l["compound"]
		if c != cur_c:
			if cur_c != "":
				wear_series.append({"pts": wpts, "color": Style.compound_color(cur_c), "dots": true})
				lap_series.append({"pts": lpts, "color": Style.compound_color(cur_c), "dots": true})
			cur_c = c
			wpts = PackedVector2Array()
			lpts = PackedVector2Array()
			if i > 0:   # connect across the stop
				wpts.append(Vector2(float(laps[i - 1]["lap"]), float(laps[i - 1]["wear_end"])))
				lpts.append(Vector2(float(laps[i - 1]["lap"]), float(laps[i - 1]["lap_time_s"]) - float(laps[i - 1]["pit_loss_s"])))
		wpts.append(Vector2(float(l["lap"]), float(l["wear_end"])))
		var lt := float(l["lap_time_s"]) - float(l["pit_loss_s"])
		lpts.append(Vector2(float(l["lap"]), lt))
		lmin = minf(lmin, lt)
		lmax = maxf(lmax, lt)
		if l["safety_car"]:
			shade.append({"x0": float(l["lap"]) - 0.5, "x1": float(l["lap"]) + 0.5, "color": Color(1, 0.69, 0.13, 0.16)})
		if float(l["wetness"]) >= 0.5:
			shade.append({"x0": float(l["lap"]) - 0.5, "x1": float(l["lap"]) + 0.5, "color": Color(0.18, 0.55, 1.0, 0.14)})
		if l["pitted"]:
			vl.append({"x": float(l["lap"]), "color": Color(1, 0.23, 0.28, 0.5)})
	if cur_c != "":
		wear_series.append({"pts": wpts, "color": Style.compound_color(cur_c), "dots": true})
		lap_series.append({"pts": lpts, "color": Style.compound_color(cur_c), "dots": true})
	var rec: Variant = s.get("recommendation")
	if typeof(rec) == TYPE_DICTIONARY:
		var pw := PackedVector2Array()
		var pl := PackedVector2Array()
		for p in rec["projection"]:
			pw.append(Vector2(float(p["lap"]), float(p["wear"])))
			pl.append(Vector2(float(p["lap"]), float(p["lap_time_s"])))
			lmin = minf(lmin, float(p["lap_time_s"]))
			lmax = maxf(lmax, float(p["lap_time_s"]))
		wear_series.append({"pts": pw, "color": Style.CYAN, "dashed": true, "width": 2.0})
		lap_series.append({"pts": pl, "color": Style.CYAN, "dashed": true, "width": 2.0})
	if lmin > lmax:
		lmin = 88.0
		lmax = 100.0
	(_w["plot_wear"] as Plot).set_data(wear_series, shade, vl, n, 0.0, 1.0, float(s["max_wear"]))
	(_w["plot_lap"] as Plot).set_data(lap_series, shade, vl, n, floorf(lmin - 1.0), ceilf(lmax + 1.0))


func _load_benchmark() -> void:
	(_w["bench"] as RichTextLabel).text = "[color=#cfb0b4]loading saved benchmark results…[/color]"
	Backend.get_json("/api/evaluation/results", func(res: Variant, ok: bool) -> void:
		var b := _w["bench"] as RichTextLabel
		if not ok or typeof(res) != TYPE_DICTIONARY:
			b.text = "[color=#cfb0b4]No benchmark results yet. Run one in the web app or with: python -m app.evaluation (from backend/).[/color]"
			return
		var m: Dictionary = res["summary"]
		var t := "[b]Paired benchmark[/b]  %d trials, %s seeds %d+, %d futures per decision\n" % [int(m["trials"]), m["seed_set"], int(m["seed_start"]), int(m["scenarios"])]
		t += "baseline mean %s   adaptive mean %s   mean saved [color=#2fe08a][b]%.2fs[/b][/color] (95%% CI %.1f to %.1f)   improvement %.3f%%\n" % [
			Style.fmt_clock(float(m["baseline_mean_s"])), Style.fmt_clock(float(m["adaptive_mean_s"])), float(m["mean_saved_s"]),
			float(m["ci95_saved_s"][0]), float(m["ci95_saved_s"][1]), float(m["pct_improvement"])]
		t += "win rate %.1f%% (%dW/%dL/%dT)   invalid plans %d   tyre-limit violations %d (baseline %d)   decision %.0f ms mean\n" % [
			float(m["win_rate"]) * 100.0, int(m["wins"]), int(m["losses"]), int(m["ties"]), int(m["invalid_plans"]), int(m["tyre_violations"]), int(m["baseline_tyre_violations"]), float(m["mean_decision_ms"])]
		for k in m["by_category"]:
			var c: Dictionary = m["by_category"][k]
			t += "  %-12s n=%-3d saved %+6.2fs   win %3.0f%%  loss %3.0f%%\n" % [str(k), int(c["n"]), float(c["mean_saved_s"]), float(c["win_rate"]) * 100.0, float(c["loss_rate"]) * 100.0]
		b.text = t)


func _refresh_events_tab() -> void:
	var evs: Array = s["events"]
	var out := ""
	for i in range(evs.size() - 1, -1, -1):
		var e: Dictionary = evs[i]
		var col: String = EVENT_COLORS.get(e["type"], "#cfb0b4")
		out += "[color=#cfb0b4]L%02d %s[/color]  [color=%s][b]%s[/b][/color]  %s\n" % [int(e["lap"]), Style.fmt_clock(float(e["sim_time_s"])), col, str(e["type"]).replace("_", " "), e["message"]]
	(_w["log"] as RichTextLabel).text = out
	var over: bool = s["status"] == "finished"
	var raining: bool = float(s["conditions"]["rain_intensity"]) > 0.0
	var sc: bool = s["conditions"]["safety_car"]
	for key in _w.keys():
		if str(key).begins_with("ev_"):
			(_w[key] as Button).disabled = over
	(_w["ev_clear"] as Button).disabled = over or not raining
	(_w["ev_sc_deploy"] as Button).disabled = over or sc
	(_w["ev_sc_withdraw"] as Button).disabled = over or not sc


# ------------------------------------------------------------------ per frame
func _process(dt: float) -> void:
	if _toast_t > 0.0:
		_toast_t -= dt
		_toast.modulate.a = clampf(_toast_t / 0.6, 0.0, 1.0)
		if _toast_t <= 0.0:
			_toast.visible = false
	if _flash_t > 0.0:
		_flash_t = maxf(0.0, _flash_t - dt)
		if console_open and _tabs.current_tab == 1:
			_refresh_strategy()
	_tower_t -= dt
	if _tower_t <= 0.0 and not s.is_empty() and main != null:
		_tower_t = 0.12
		_update_tower()
	# glide timing rows to their slots
	var i := 0
	var order: Array = _w.get("tower_order", [])
	for id in order:
		var row: Control = _rows.get(id)
		if row:
			row.position.y = lerpf(row.position.y, i * 29.0, 1.0 - exp(-12.0 * dt))
		i += 1


func _update_tower() -> void:
	var n: int = int(s["total_laps"])
	var list: Array = []
	for c in s["cars"]:
		var pose: Variant = main.poses.get(c["id"])
		var raw := float(pose["place"]["total"]) if pose != null else -float(c["grid_slot"]) * 1e-3
		var fin: bool = raw >= n and (c["laps"] as Array).size() >= n
		list.append({"c": c, "t": (n + 1 - float(c["elapsed_s"]) * 1e-6) if fin else raw, "fin": fin})
	list.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if absf(float(a["t"]) - float(b["t"])) > 1e-9:
			return float(a["t"]) > float(b["t"])
		return int(a["c"]["grid_slot"]) < int(b["c"]["grid_slot"]))
	var lead: float = float(list[0]["t"])
	var order: Array = []
	var lap_no := 1
	for i in list.size():
		var it: Dictionary = list[i]
		var c: Dictionary = it["c"]
		order.append(c["id"])
		var gap := ""
		var d := lead - float(it["t"])
		if i == 0:
			gap = "WINNER" if it["fin"] else "LEADER"
		elif it["fin"] and list[0]["fin"]:
			gap = "+%.1f" % float(c["gap_to_leader_s"])
		elif d >= 1.0:
			gap = "+%d LAP" % int(d)
		else:
			gap = "+%.1f" % (d * (float(c["last_lap_s"]) if c["last_lap_s"] != null else 92.0))
		if c["is_primary"]:
			lap_no = clampi(int(floorf(maxf(0.0, float(it["t"])))) + 1, 1, n)
		var row: PanelContainer = _rows.get(c["id"])
		if row == null:
			row = _make_tower_row(c)
			_rows[c["id"]] = row
			_tower.add_child(row)
			row.position.y = i * 29.0
		_style_tower_row(row, c, i + 1, gap)
	_w["tower_order"] = order
	_w["tower_lap"].text = "LAP %d/%d" % [lap_no, n]


func _make_tower_row(c: Dictionary) -> PanelContainer:
	var row := PanelContainer.new()
	row.size = Vector2(210, 27)
	row.custom_minimum_size = Vector2(210, 27)
	row.mouse_filter = Control.MOUSE_FILTER_STOP
	var h := _mk_hbox(6)
	row.add_child(h)
	for k in ["pos", "code", "tyre", "gap"]:
		var l := Style.label("", 14, Style.INK, "display" if k != "gap" else "mono")
		l.name = k
		if k == "gap":
			l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			l.add_theme_font_size_override("font_size", 11)
		if k == "tyre":
			l.text = "●"
		h.add_child(l)
	var id: String = c["id"]
	row.gui_input.connect(func(e: InputEvent) -> void:
		if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			main.select_car(id))
	return row


func _style_tower_row(row: PanelContainer, c: Dictionary, pos: int, gap: String) -> void:
	var h := row.get_child(0)
	(h.get_node("pos") as Label).text = str(pos)
	var code := h.get_node("code") as Label
	code.text = str(c["code"])
	code.add_theme_color_override("font_color", Style.RED if c["is_primary"] else Style.INK)
	var tyre := h.get_node("tyre") as Label
	tyre.add_theme_color_override("font_color", Style.compound_color(c["compound"]))
	(h.get_node("gap") as Label).text = gap
	var selected: bool = main.selected_id == c["id"]
	var bg := Color(1, 1, 1, 0.14) if selected else (Color(1.0, 0.23, 0.28, 0.2) if c["is_primary"] else Color(0, 0, 0, 0.0))
	var sb := Style.box(bg, Color.TRANSPARENT, 2, 0)
	sb.border_width_left = 3
	sb.border_color = Color(c["color"])
	sb.content_margin_top = 1
	sb.content_margin_bottom = 1
	row.add_theme_stylebox_override("panel", sb)
