class_name Quality
extends RefCounted
## Rendering quality presets for the Godot client. Every field changes a real rendering cost.
## Default is picked from the GPU (integrated -> performance, discrete -> balanced); Q cycles at runtime;
## `-- --quality=performance|balanced|high|ultra` forces one. Main steps the preset down automatically when the
## frame rate stays well under the display refresh (the Compatibility renderer has no 3D render-scale).

const LEVELS := ["performance", "balanced", "high", "ultra"]

const PRESETS := {
	"performance": {
		"msaa": 0, "shadows": false, "splits": 1, "shadow_dist": 0.0, "shadow_size": 1024,
		"glow": false, "trees": 0.3, "corner_labels": false, "lod_m": 55.0, "car_shadows": false,
		"props_shadows": false, "fog": false,
	},
	"balanced": {
		"msaa": 0, "shadows": true, "splits": 2, "shadow_dist": 320.0, "shadow_size": 2048,
		"glow": false, "trees": 0.65, "corner_labels": true, "lod_m": 95.0, "car_shadows": true,
		"props_shadows": false, "fog": true,
	},
	"high": {
		"msaa": 2, "shadows": true, "splits": 3, "shadow_dist": 650.0, "shadow_size": 4096,
		"glow": true, "trees": 1.0, "corner_labels": true, "lod_m": 150.0, "car_shadows": true,
		"props_shadows": true, "fog": true,
	},
	"ultra": {
		"msaa": 4, "shadows": true, "splits": 4, "shadow_dist": 1400.0, "shadow_size": 4096,
		"glow": true, "trees": 1.0, "corner_labels": true, "lod_m": 260.0, "car_shadows": true,
		"props_shadows": true, "fog": true,
	},
}


static func default_level() -> String:
	# Fewest frames lost by default: integrated GPUs share memory bandwidth with the CPU (performance), discrete GPUs
	# get balanced. "high" and "ultra" add shadow passes over every prop and glow/MSAA, so they are opt-in (Q key).
	var t := RenderingServer.get_video_adapter_type()
	return "performance" if t == RenderingDevice.DEVICE_TYPE_INTEGRATED_GPU or t == RenderingDevice.DEVICE_TYPE_CPU else "balanced"


static func msaa_enum(v: int) -> int:
	match v:
		2: return Viewport.MSAA_2X
		4: return Viewport.MSAA_4X
		8: return Viewport.MSAA_8X
	return Viewport.MSAA_DISABLED
