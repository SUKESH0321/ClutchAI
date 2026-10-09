shader_type canvas_item;
// Screen-space rain streaks (three parallax layers). `intensity` 0..1 comes from the on-screen track wetness.
uniform float intensity = 0.0;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void fragment() {
	float aspect = SCREEN_PIXEL_SIZE.y / SCREEN_PIXEL_SIZE.x;
	vec2 uv = vec2(UV.x * aspect, UV.y);
	float rain = 0.0;
	for (int layer = 0; layer < 3; layer++) {
		float fl = float(layer);
		float cols = 70.0 + fl * 55.0;
		vec2 p = vec2((uv.x + uv.y * 0.12) * cols, uv.y * (5.0 + fl * 3.0) - TIME * (3.4 + fl * 1.3));
		vec2 id = floor(p);
		vec2 f = fract(p);
		float h = hash(id + fl * 19.0);
		float streak = smoothstep(0.0, 0.08, f.y) * (1.0 - smoothstep(0.25, 0.85, f.y));
		float width = abs(f.x - 0.5);
		float line = (1.0 - smoothstep(0.0, 0.07 + 0.02 * fl, width)) * streak;
		rain += line * step(1.0 - intensity * 0.5, h) * (0.55 - fl * 0.12);
	}
	COLOR = vec4(0.78, 0.88, 1.0, clamp(rain, 0.0, 0.7) * smoothstep(0.0, 0.15, intensity));
}
