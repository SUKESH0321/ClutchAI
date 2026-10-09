extends SceneTree
## Renders the four race-car models side by side with a +X arrow to verify colour and facing.
## Run (windowed): Godot.exe --path godot --script res://tools/car_stage.gd -- --shot=<png>

func _init() -> void:
	var root := Node3D.new()
	get_root().add_child(root)
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("#3a1a22")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("#d9c9c6")
	env.ambient_light_energy = 0.5
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	root.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-45, -40, 0)
	sun.light_energy = 1.0
	root.add_child(sun)
	var floor_mi := MeshInstance3D.new()
	var pl := PlaneMesh.new()
	pl.size = Vector2(80, 40)
	floor_mi.mesh = pl
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color("#4a4a52")
	floor_mi.material_override = fm
	root.add_child(floor_mi)

	var models := ["raceCarRed", "raceCarOrange", "raceCarGreen", "raceCarWhite"]
	var colors := [Color("#ff3b47"), Color("#38d9f5"), Color("#22d37a"), Color("#b28cff")]
	for k in models.size():
		var cv := CarView.new()
		cv.setup("t%d" % k, models[k], colors[k], "T%d" % k, k == 0)
		cv.position = Vector3(-12.0 + k * 8.0, 0.0, 0.0)
		root.add_child(cv)
	# arrow along +X from the first car
	var arrow := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(9, 0.15, 0.3)
	arrow.mesh = box
	var am := StandardMaterial3D.new()
	am.albedo_color = Color.YELLOW
	am.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	arrow.material_override = am
	arrow.position = Vector3(-12.0 + 4.5, 0.2, 4.0)
	root.add_child(arrow)

	var cam := Camera3D.new()
	cam.fov = 40
	root.add_child(cam)
	cam.look_at_from_position(Vector3(0, 14, 22), Vector3(0, 0.5, 0))
	cam.current = true

	var path := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			path = a.substr(7)
	await create_timer(0.6).timeout
	await process_frame
	await process_frame
	var img := get_root().get_texture().get_image()
	img.save_png(path if path != "" else "res://tools/car_stage.png")
	print("saved ", path)
	quit()
