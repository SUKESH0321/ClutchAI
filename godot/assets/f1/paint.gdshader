shader_type spatial;
// Recolourable bodywork for the F1 car: team colour, a centre stripe and front-wing tips in the secondary colour.
uniform vec4 base : source_color = vec4(0.8, 0.1, 0.1, 1.0);
uniform vec4 second : source_color = vec4(0.08, 0.08, 0.1, 1.0);
uniform float rough = 0.34;
uniform float alpha = 1.0;
varying vec3 lp;

void vertex() {
	lp = VERTEX;
}

void fragment() {
	float stripe = (1.0 - smoothstep(0.05, 0.075, abs(lp.x))) * step(-0.9, lp.z);
	float tip = smoothstep(2.05, 2.15, lp.z);
	ALBEDO = mix(base.rgb, second.rgb, max(stripe, tip));
	ROUGHNESS = rough;
	METALLIC = 0.15;
	CLEARCOAT = 1.0;
	CLEARCOAT_ROUGHNESS = 0.08;
	ALPHA = alpha;
}
