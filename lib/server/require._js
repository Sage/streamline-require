"use strict";
/// !doc
/// 
/// # Server-side require handler
/// 
/// Handles require requests coming from the client.
/// 
var fs = require('fs');
var depend = require("./depend");
var fspath = require('path');
var globals = require('streamline-runtime').globals;
var flows = require('streamline-runtime').flows;

function _replyError(response, statusCode, body) {
	response.writeHead(statusCode, {
		'Content-Type': 'text/plain',
		'Content-Length': body.length
	});
	response.end(body);
}

function _parseQueryString(str) {
	return (str || '').split('&').reduce(function(result, param) {
		var pair = param.split('=');
		result[pair[0]] = decodeURIComponent(pair[1]);
		return result;
	}, {});
}

const _exists = (cb, path) => fs.exists(path, result => cb(null, result));

var doCache = (function() {
	var _etag;
	var _data;
	var _funnel = flows.funnel(1);

	return function(_, etag, key, fn) {
		var data;
		// Use double-checked locking to avoid (minor) funnel overhead
		// First test could be removed, but not second one (inside funnel)
		if (_etag === etag && (data = _data[key])) return data;
		return _funnel(_, function(_) {
			if (_etag === etag && (data = _data[key])) return data;
			var data = fn(_);
			if (_etag !== etag) {
				_etag = etag;
				_data = {};
			}
			_data[key] = data;
			return data;
		});
		return _data[key];
	};
})();

function dontCache(_, etag, key, fn) {
	return fn(_);
}

// request is a GET on /require/module_path?known=known_modules
// response is a multipart document containing the requested module script
// and all its dependencies that are not referenced by any of the known modules.
/// * `dispatcher = require.dispatcher(options)`  
///   returns an HTTP request dispatcher that responds to requests
///   issued by the client-side `require` script.  
///   The dispatcher is called as `dispatcher(_, request, response)`
exports.dispatcher = function(config) {
	config = config || {};
	if (!config.whiteList) throw new Error("white list missing");
	// default root is our parent node_modules
	var root = config.root || fspath.join(__dirname, "../../..");
	var cache = config.nocache ? dontCache : doCache;
	var shadowRoot = config.shadowRoot || fspath.join(root, "../shadow-modules/node_modules/");
	var dependOptions = {
		cacheDir: config.cacheDir,
		root: root,
		shadowRoot: shadowRoot,
	};

	function under(path, ref) {
		return path.substring(0, ref.length) === ref;
	}

	function path2Location(path, packagePaths) {
		var location = packagePaths ? path.replace(packagePaths[1], packagePaths[0]) : path;
		if (under(path, root)) location = location.substring(root.length);
		else if (under(path, shadowRoot)) location = location.substring(shadowRoot.length);
		// remove leading '/' and replace \ by /
		location = location.replace(/\\/g, '/');
		return location[0] === '/' ? location.substring(1) : location;
	}

	return function(_, request, response) {
		function checkWhiteList(location) {
			if (!config.whiteList.some(function(re) {
				return re.test(location);
			})) {
				console.error(location, config.whiteList)
				console.error("module not allowed by white list: " + location);
				throw new Error("access denied");
			}
		}

		function doMultipart(_, etag, parts, readPart) {
			var boundary = (Math.random() + '-' + Math.random()).replace(/\./g, '');
			var endMarker = "\n--" + boundary + "--\n";
			response.writeHead(200, {
				'content-type': 'multipart/related; boundary="' + boundary + '"',
				'etag': etag,
				'expires': (new Date()).toUTCString() // IE9 needs this header in order to manage ETag
			});
			var i = 0;
			parts.forEach_(_, function(_, dep) {
				// security issue: stop on first error to avoid disclosing list of dependencies
				//try {
				var part = readPart(_, dep);
				response.write(_, "\n--" + boundary + "\n" + "Content-ID: FILE " + ++i + "\n" + "Content-Location: " + part.location + "\n" + "Content-Type: " + part.contentType + "\n\n" + part.data + "\n");
				//} catch (ex) {
				//	console.error(ex.message);
				//	response.write(_, "\n--" + boundary + "\n" + "Content-ID: ERROR\n" + "Content-Type: text/plain\n" + "\n" + ex.toString() + "\n");
				//}
			});
			response.write(_, endMarker);
		}
		try {
			var noneMatch = request.headers['if-none-match'];
			if (noneMatch === depend.etag()) {
				response.writeHead(304, {});
				return response.end();
			}
			var parts = request.url.split('?');
			var qs = _parseQueryString(parts[1]);
			var path = qs.module;
			var known = qs.known ? qs.known.split(",") : [];

			if (path) {
				if (path[0] === '.') throw new Error("server require cannot resolve relative path: " + path);
				if (path[0] === '/') throw new Error("invalid require path: " + path);

				var missing = cache(_, depend.etag(), "depend:" + path + '#' + known, function(_) {
					return depend.missingDependencies(_, path, known, dependOptions);
				});
				var locale = request.headers['accept-language'];
				doMultipart(_, depend.etag(), Object.keys(missing), function(_, path) {
					var resolvedAs = missing[path].resolvedAs;
					var location = path2Location(path, missing[path].packagePaths);
					return cache(_, depend.etag(), "part:" + location, function(_) {
						checkWhiteList(location);
						var contents = /[\\\/](deps|build|shadow-modules)[\\\/]/.test(resolvedAs) || /\.es5$/.test(resolvedAs) ? fs.readFile(resolvedAs, 'utf8', _) : require("streamline").transformFile(_, resolvedAs, {
							runtime: "callbacks",
							cacheDir: config.cacheDir,
						}).code;
						return {
							location: location,
							contentType: "application/javascript",
							data: "(function(){" + contents + "\n}).call(this);" + //
							(config.getResources ? "if (module) module.__resources=" + config.getResources(_, resolvedAs, locale) + ";" : ""),
						};
					});
				});
			} else {
				var locale = qs["localize"];
				// list of dependencies can be cached once for all locales
				var missing = cache(_, depend.etag(), "localize#" + known, function(_) {
					var missing = [],
						processed = [];
					while (known.length > 0) {
						path = known.shift();
						var deps = depend.missingDependencies(_, path, processed, dependOptions);
						Object.keys(deps).forEach(function(path) {
							missing.push({
								path: path,
								resolvedAs: deps[path].resolvedAs,
								packagePaths: deps[path].packagePaths,
							});
						});
						processed.push(path);
					}
					return missing;
				});
				doMultipart(_, depend.etag(), missing, function(_, dep) {
					var resolvedAs = dep.resolvedAs;
					var location = path2Location(dep.path, dep.packagePaths);
					checkWhiteList(location);
					return {
						location: location,
						contentType: "application/json",
						data: config.getResources(_, resolvedAs, locale),
					};
				});
			}
			response.end();
		} catch (ex) {
			console.error(ex.stack);
			return _replyError(response, 500, "require request failed. Check with your administrator");
		}
	};
};