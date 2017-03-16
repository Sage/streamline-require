/// !doc
/// 
/// # Client-side require script
/// 
(function(exports, global) {
	var _modules = {};
	var _sources = {};
	var _known = [];
	var _lastLocale = "";
	var _etag = "";

	var _evaluate = eval("(function() {})") != null ? (function(str) {
		return eval(str);
	}) : function(str) {
			return new Function("return " + str)();
		};

	function _resolve(path, rel, dontFail) {
		var path0 = path, rel0 = rel;
		var cut = path.lastIndexOf('/');
		if (cut >= 0) path = path.substring(0, cut);
		// get rid of leading ./. and ./..
		while (rel.indexOf('./.') === 0) rel = rel.substring(2);
		if (rel.indexOf('../') === 0) return _resolve(path, rel.substring(1));
		// paths are normalized now
		var relative = rel.indexOf('./') === 0;
		function testSource(path, rel) {
			return ['', '/index.js', '/index._js', '/main.js', '/main._js'].filter(function(extra) {
				return _sources[path + rel + extra] != null;
			})[0];
		};
		if (relative) {
			rel = rel.substring(1);
			var extra = testSource(path, rel);
			if (extra != null) return path + rel + extra;
			// if path was a directory we need to give another chance as path + '/' + rel
			extra = testSource(path0, rel);
			if (extra != null) return path0 + rel + extra;

		} else {
			var segs = ('/' + path).split('/');
			while (true) {
				path = segs.length > 0 ? segs.concat('node_modules/').join('/').substring(1) : '';
				var extra = testSource(path, rel);
				if (extra != null) return path + rel + extra;
				if (!segs.length) break;
				segs.pop();
			}
		}
		if (dontFail) return null;
		throw new Error("require error: cannot resolve " + rel0 + " from: " + path0);
	}

	// deprecated. remove later

	function _print(str) {
		console.log(str);
	};

	function _load(key, arg, callback) {
		var url;
		if (key === "sources") {
			if (_sources[arg]) return callback();
			url = "/require?module=" + encodeURIComponent(arg) + "&known=" + _known.join(",");
		} else {
			url = "/require?localize=" + arg + "&known=" + _known.join(",");
		}
		//console.log("require: loading " + arg)
		$.ajax({
			type: "GET",
			url: url,
			dataType: "text",
			headers: _lastLocale ? { 'Accept-Language': _lastLocale } : {},
			data: null,
			success: function(data, statusText, xhr) {
				var contentType = xhr.getResponseHeader("Content-Type");
				_etag = xhr.getResponseHeader("ETag") || _etag;
				var boundary = /.*boundary="([^"]*)".*/.exec(contentType);
				if (!boundary || !boundary[1]) return callback(new Error("no boundary"));
				var parts = data.split("\n--" + boundary[1]);
				if (!parts || parts.length < 1 || parts[parts.length - 1].indexOf("--") != 0) return callback(new Error("end marker missing"));
				for (var i = 1; i < parts.length - 1; i++) {
					var part = parts[i];
					var sep = part.indexOf('\n\n');
					if (sep < 0) return callback(new Error("empty line missing"));
					var headers = {};
					var lines = part.substring(0, sep).split('\n');
					for (var j = 0; j < lines.length; j++) {
						var line = lines[j];
						var pair = line.split(': ');
						headers[pair[0]] = pair[1];
					}
					var body = part.substring(sep + 2);
					var id = headers["Content-ID"];
					if (id == "ERROR") return callback(new Error(body));
					var location = headers["Content-Location"];
					if (!location) return callback(new Error("content location missing"));
					//console.log("require: got source " + location + ": " + body.length + " bytes");
					if (key === "sources") _sources[location] = body;
					else {
						if (_modules[location]) _modules[location].__resources = JSON.parse(body);
						else if (!/^\s*\{\}\s*$/.test(body)) console.error("ignoring localization data for missing module: " + location + ", data=" + body);
					}
				}
				if (key === "sources") _known.push(arg);
				return callback();
			},
			error: function(xhr, message, ex) {
				return callback(new Error(message));
			}
		});
	}

	function _sandbox(path, that, opts) {
		if (_modules[path]) return _modules[path].exports;

		try {
			//console.log("require: creating sandbox " + path);
			// for now assume that directories resolve to main or index
			var source = _sources[path];
			if (source == null) throw new Error("internal error: source missing: " + path);

			// do not add newline (to get correct line numbers)
			source = "(function(require, exports, module, system, print, __filename) {" + source + "})";
			source = source + '\n//# sourceURL=' + window.location.origin + '/' + path + '\n';
			// pass source to global require hook, if any
			source = window.requireSourceHook ? window.requireSourceHook(source, path) : source;
			var factory = _evaluate(source);
			//delete _sources[path]; -- we need it for circular references
			// prepare parameters for source wrapper

			var module = _modules[path] = {
				/// * `id = module.id`  
				///   the `id` of the current module.
				id: path,
				exports: {},
				toString: function() {
					return this.id;
				},
				etag: _etag,
			};
			/// * `module = require(id)`  
			///   _requires_ a module synchronously.  
			///   `id` _must_ be a string literal.
			var require = function(id, that, opts) {
				return _sandbox(_resolve(path, id), that, opts);
			};
			/// * `module = require.async(id, _)`  
			///   _requires_ a module asynchronously.  
			///   `id` may be a variable or an expression.
			require.async = function(id, callback) {
				var p = _resolve(path, id, true);
				if (p !== null && _modules[p]) {
					setTimeout(function() {
						callback(null, _modules[p].exports);
					}, 0);
				} else {
					_load("sources", id, function(err) {
						if (err) return callback(err);
						try {
							_sandbox(id, that);
							return callback(null, _modules[id].exports);
						} catch (ex) {
							return callback(ex);
						}
					});
				}
			};
			/// * `module = require.shallow(id)`  
			///   _requires_ a module in shallow mode, without loading any 
			///   deeper dependencies from the required module's source.  
			///   `id` _must_ be a string literal.
			require.shallow = function(id, that, opts) {
				(opts = opts || {}).shallow = true;
				return require(id, that, opts);
			};

			/// * `require.localize(locale, _)`  
			///   updates localized resources on all modules
			require.localize = function(locale, cb) {
				_lastLocale = locale;
				_load("resources", locale, cb);
			};

			/// * `main = require.main`  
			///   return the main module
			require.main = opts && opts.isMain ? module : null;
			if (opts && opts.shallow) {
				factory.call(global);
				return {};
			} else {
				factory.call(that || {}, require, module.exports, module, null, _print, path);
				return module.exports;
			}
		} catch (ex) {
			console.error("module initialization failed: " + path + ": ex=" + ex.stack);
			throw ex;
		}
	}

	// setup require.main and export it.
	var _require = function(id) {
		console.error("require not allowed in this context. Use require.main");
	};

	/// * `require.main(id)`  
	///   loads main module from HTML page.
	_require.main = function(path, that) {
		_load("sources", path, function(err) {
			if (err) return alert(err.message);
			_sandbox(path, that, {
				isMain: true
			});
		});
	};

	exports.require = _require;
	(global.__streamline = global.__streamline || {}).ffOffset = 12;
})(this, this);