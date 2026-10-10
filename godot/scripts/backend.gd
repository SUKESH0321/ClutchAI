extends Node
## Connection to the Python race backend (autoload "Backend").
## - Live state arrives over WebSocket /ws/race (one JSON message per simulated lap / event).
## - Commands go over REST and their responses are fed through the same state path.

signal state_received(state: Dictionary)
signal connection_changed(online: bool)
signal api_error(message: String)

var host: String = "127.0.0.1:8000"
var state: Dictionary = {}
var online: bool = false

var _ws: WebSocketPeer
var _retry: float = 0.0
var _version: int = -1


func _ready() -> void:
	# allow `--host 192.168.x.x:8000` style override:  godot ... -- --host=...
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--host="):
			host = a.substr(7)
	_connect()


func _connect() -> void:
	_ws = WebSocketPeer.new()
	_ws.inbound_buffer_size = 8 * 1024 * 1024   # a state message carries every car's lap history
	_ws.max_queued_packets = 256
	var err := _ws.connect_to_url("ws://%s/ws/race" % host)
	if err != OK:
		push_warning("WebSocket connect failed to start: %s" % err)


func _process(delta: float) -> void:
	_ws.poll()
	match _ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if not online:
				online = true
				connection_changed.emit(true)
			while _ws.get_available_packet_count() > 0:
				_handle(_ws.get_packet().get_string_from_utf8())
		WebSocketPeer.STATE_CLOSED:
			if online:
				online = false
				connection_changed.emit(false)
			_retry -= delta
			if _retry <= 0.0:
				_retry = 2.0
				_connect()


func _handle(text: String) -> void:
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	apply_state(parsed)


func apply_state(s: Dictionary) -> void:
	var v: int = int(s.get("version", 0))
	# versions are monotone within a backend run; a big drop means the backend restarted
	if v < _version and _version - v < 50:
		return
	_version = v
	state = s
	state_received.emit(s)


## Fire a REST command. `path` like "/api/race/start". Race endpoints return a full state.
func api(method: int, path: String, body: Variant = null) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(_on_request_done.bind(req))
	var headers := PackedStringArray()
	var payload := ""
	if body != null:
		headers.append("Content-Type: application/json")
		payload = JSON.stringify(body)
	var err := req.request("http://%s%s" % [host, path], headers, method, payload)
	if err != OK:
		req.queue_free()
		api_error.emit("request failed to start (%s)" % err)


func _on_request_done(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray, req: HTTPRequest) -> void:
	req.queue_free()
	if result != HTTPRequest.RESULT_SUCCESS:
		api_error.emit("backend unreachable (is it running on %s?)" % host)
		return
	var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
	if code >= 400:
		var detail := "HTTP %d" % code
		if typeof(parsed) == TYPE_DICTIONARY and parsed.has("detail"):
			detail = str(parsed["detail"])
		api_error.emit(detail)
		return
	if typeof(parsed) == TYPE_DICTIONARY and parsed.has("cars") and parsed.has("version"):
		apply_state(parsed)


## GET a JSON endpoint and hand the parsed result to `cb(result: Variant, ok: bool)`.
func get_json(path: String, cb: Callable) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, body: PackedByteArray) -> void:
		req.queue_free()
		if result != HTTPRequest.RESULT_SUCCESS or code >= 400:
			cb.call(null, false)
			return
		cb.call(JSON.parse_string(body.get_string_from_utf8()), true))
	if req.request("http://%s%s" % [host, path]) != OK:
		req.queue_free()
		cb.call(null, false)


# ---- convenience wrappers (same endpoints the web UI uses) ----
func start() -> void: api(HTTPClient.METHOD_POST, "/api/race/start")
func pause() -> void: api(HTTPClient.METHOD_POST, "/api/race/pause")
func resume() -> void: api(HTTPClient.METHOD_POST, "/api/race/resume")
func step() -> void: api(HTTPClient.METHOD_POST, "/api/race/step")
func finish() -> void: api(HTTPClient.METHOD_POST, "/api/race/finish")
func reset(config_name: String = "demo", circuit: String = "") -> void:
	var b := {"config_name": config_name}
	if circuit != "":
		b["circuit"] = circuit
	api(HTTPClient.METHOD_POST, "/api/race/reset", b)
func set_speed(v: float) -> void: api(HTTPClient.METHOD_POST, "/api/race/speed", {"speed": v})
func event(type: String, intensity: float = -1.0) -> void:
	var b := {"type": type}
	if intensity > 0.0:
		b["intensity"] = intensity
	api(HTTPClient.METHOD_POST, "/api/race/event", b)
