extends SceneTree
## Builds the vegetation for each circuit headlessly and reports counts (run: --headless --script res://tools/test_veg.gd).
func _initialize() -> void:
	for id in ["silverstone", "spa"]:
		var c := Circuit.load_from("res://data/%s.json" % id)
		var v := Vegetation.new()
		root.add_child(v)
		var t0 := Time.get_ticks_msec()
		v.build(c, [])
		var gi := 0
		var ti := 0
		for g in v.grass_nodes:
			gi += (g as MultiMeshInstance3D).multimesh.instance_count
		for t in v.tree_nodes:
			ti += (t as MultiMeshInstance3D).multimesh.instance_count
		print("%s: trees %d in %d nodes, grass %d in %d nodes, built in %d ms, grass mesh ok=%s" % [id, ti, v.tree_nodes.size(), gi, v.grass_nodes.size(), Time.get_ticks_msec() - t0, str(v._mesh("grass_0") != null)])
	quit()
