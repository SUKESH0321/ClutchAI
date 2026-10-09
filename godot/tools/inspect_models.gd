extends SceneTree
## Prints bounding boxes and node layout of the imported Kenney models.
## Run: Godot_console.exe --headless --path godot --script res://tools/inspect_models.gd

func _init() -> void:
	for n in ["raceCarRed", "raceCarWhite", "treeLarge", "grandStand", "barrierRed", "pitsGarage", "pitsOffice", "lightPostLarge", "overhead", "flagCheckers", "tent", "billboard", "pylon"]:
		var ps: PackedScene = load("res://assets/kenney/%s.glb" % n)
		if ps == null:
			print(n, " FAILED TO LOAD")
			continue
		var root := ps.instantiate()
		var box := _aabb(root, Transform3D.IDENTITY)
		print("%s  size=(%.2f, %.2f, %.2f) center=(%.2f, %.2f, %.2f) children=%d" % [n, box.size.x, box.size.y, box.size.z, box.get_center().x, box.get_center().y, box.get_center().z, root.get_child_count()])
		root.free()
	quit()

func _aabb(node: Node, xf: Transform3D) -> AABB:
	var out := AABB()
	var first := true
	if node is MeshInstance3D:
		var m := node as MeshInstance3D
		out = xf * m.get_aabb()
		first = false
	for c in node.get_children():
		if c is Node3D:
			var b := _aabb(c, xf * (c as Node3D).transform)
			if first:
				out = b
				first = false
			else:
				out = out.merge(b)
	return out
