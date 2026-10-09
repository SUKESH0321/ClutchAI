extends SceneTree
## Loads the F1 car through CarView and reports what was built (run headless: --script res://tools/test_f1.gd).
func _initialize() -> void:
	print("f1_available=", CarView.f1_available())
	var cv := CarView.new()
	root.add_child(cv)
	cv.setup("t", "f1", Color("#e0262f"), "TST", true, false, Color("#14161b"))
	print("hi=", cv._hi != null, " lo=", cv._lo != null, " wheels=", cv._wheels.size(), " near=", cv._near)
	for n in [cv._hi, cv._lo]:
		if n == null:
			continue
		var tris := 0
		var meshes := 0
		for mi in (n as Node3D).find_children("*", "MeshInstance3D", true, false):
			meshes += 1
			var m := (mi as MeshInstance3D).mesh
			if m != null:
				for s in m.get_surface_count():
					var arr := m.surface_get_arrays(s)
					tris += (arr[Mesh.ARRAY_INDEX] as PackedInt32Array).size() / 3
		print("  ", n.name, " visible=", (n as Node3D).visible, " meshes=", meshes, " tris=", tris)
	quit()
