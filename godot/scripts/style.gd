class_name Style
extends RefCounted
## Maroon-red motorsport theme shared by every HUD widget (mirrors the web UI palette).

const BG := Color("#1c070b")
const PANEL := Color(0.19, 0.05, 0.08, 0.90)
const PANEL_SOLID := Color("#34121a")
const LINE := Color(1.0, 0.45, 0.5, 0.30)
const INK := Color("#fff4f1")
const MUTED := Color("#cfb0b4")
const RED := Color("#ff3b47")
const AMBER := Color("#ffb020")
const GREEN := Color("#2fe08a")
const CYAN := Color("#4fe0f7")
const BLUE := Color("#2f8bff")

const COMPOUND := {
	"SOFT": Color("#ff3b3b"), "MEDIUM": Color("#ffd12e"), "HARD": Color("#ededed"), "WET": Color("#2f8bff"),
}

static var _fonts: Dictionary = {}


static func font(kind: String) -> Font:
	if _fonts.has(kind):
		return _fonts[kind]
	var path := ""
	match kind:
		"display": path = "res://assets/fonts/BarlowCondensed-BoldItalic.woff2"
		"ui": path = "res://assets/fonts/BarlowCondensed-SemiBold.woff2"
		"mono": path = "res://assets/fonts/JetBrainsMono-Regular.woff2"
		"monob": path = "res://assets/fonts/JetBrainsMono-SemiBold.woff2"
	var f: Font = null
	if ResourceLoader.exists(path):
		f = load(path)
	if f == null:
		f = ThemeDB.fallback_font
	_fonts[kind] = f
	return f


static func compound_color(c: String) -> Color:
	return COMPOUND.get(c, INK)


static func box(bg: Color, border: Color = LINE, radius: int = 6, border_w: int = 1) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(border_w)
	s.set_corner_radius_all(radius)
	s.content_margin_left = 10
	s.content_margin_right = 10
	s.content_margin_top = 6
	s.content_margin_bottom = 6
	return s


static func label(text: String, size: int = 13, color: Color = INK, kind: String = "mono") -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font(kind))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


static func button(text: String, primary: bool = false, accent: Color = Color.TRANSPARENT) -> Button:
	var b := Button.new()
	b.text = text.to_upper()
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_override("font", font("ui"))
	b.add_theme_font_size_override("font_size", 16)
	b.add_theme_color_override("font_color", INK)
	b.add_theme_color_override("font_hover_color", Color.WHITE)
	b.add_theme_color_override("font_disabled_color", Color(1, 1, 1, 0.3))
	var base := Color(0.34, 0.10, 0.16, 0.95)
	var border := Color(0.78, 0.30, 0.38, 0.9)
	if primary:
		base = Color(0.93, 0.18, 0.25, 1.0)
		border = Color(1.0, 0.42, 0.46, 1.0)
	elif accent != Color.TRANSPARENT:
		border = accent
	b.add_theme_stylebox_override("normal", box(base, border, 4))
	b.add_theme_stylebox_override("hover", box(base.lightened(0.18), border.lightened(0.2), 4))
	b.add_theme_stylebox_override("pressed", box(base.darkened(0.2), border, 4))
	b.add_theme_stylebox_override("disabled", box(base.darkened(0.35), border.darkened(0.5), 4))
	return b


static func panel(alpha: float = 0.88, border: Color = LINE, radius: int = 8) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", box(Color(0.17, 0.045, 0.07, alpha), border, radius))
	return p


static func fmt_clock(s: float) -> String:
	var m := int(s / 60.0)
	return "%02d:%04.1f" % [m, s - m * 60.0]


static func fmt_lap(s: Variant) -> String:
	if s == null:
		return "-:--.---"
	var v := float(s)
	var m := int(v / 60.0)
	return "%d:%06.3f" % [m, v - m * 60.0]
