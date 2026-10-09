extends SceneTree
## Lists unique material names across every model in assets/kenney.

func _init() -> void:
	var seen := {}
	var dir := DirAccess.open("res://assets/kenney")
	for f in dir.get_files():
		if not f.ends_with(".glb"):
			continue
		var i := Assets.info(f.get_basename())
		if i.is_empty():
			continue
		var mesh: Mesh = i["mesh"]
		for s in mesh.get_surface_count():
			var m := mesh.surface_get_material(s)
			var nm := m.resource_name if m else "<none>"
			var c: Color = (m as BaseMaterial3D).albedo_color if m is BaseMaterial3D else Color.WHITE
			if not seen.has(nm):
				seen[nm] = {"color": c, "models": []}
			seen[nm]["models"].append(f.get_basename())
	for k in seen:
		print("%-16s %s  used by %d models e.g. %s" % [k, seen[k]["color"].to_html(false), seen[k]["models"].size(), seen[k]["models"][0]])
	for n in ["raceCarRed", "raceCarWhite", "raceCarOrange", "raceCarGreen"]:
		var mesh2: Mesh = Assets.info(n)["mesh"]
		var names: Array = []
		for s in mesh2.get_surface_count():
			names.append(mesh2.surface_get_material(s).resource_name)
		print(n, " surfaces: ", names)
	quit()
