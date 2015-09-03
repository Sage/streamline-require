"use strict";
/// !doc
/// 
/// # Server-side require handler
/// 
/// Handles require requests coming from the client.
/// 
var fs = require('streamline-fs');
var depend = require("./depend");
var fspath = require('path');
var globals = require('streamline/lib/globals');
var flows = require('streamline/lib/util/flows');

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

function _exists(_, fname) {
	return fs.exists(fname, _);
}

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
	var root = fspath.join(__dirname, "../../..");
	var cache = config.nocache ? dontCache : doCache;
	var shadowPrefix = config.shadowPrefix || "shadow-modules/node_modules/";
	depend.loadOptions.shadowPrefix = shadowPrefix; // clean this hack later


	function uncache(location) {
		if (location.substring(0, shadowPrefix.length) === shadowPrefix) 
			location = location.substring(shadowPrefix.length);
		return location;
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
			response.end(endMarker);
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
					return depend.missingDependencies(_, root, path, known);
				});
				var locale = request.headers['accept-language'];
				doMultipart(_, depend.etag(), Object.keys(missing), function(_, path) {
					var resolvedAs = missing[path];
					var location = uncache(path.substring(root.length + 1));
					return cache(_, depend.etag(), "part:" + location, function(_) {
						checkWhiteList(location);
						return {
							location: location,
							contentType: "application/javascript",
							data: require("streamline/lib/compiler/compile").loadFile(_, resolvedAs, depend.loadOptions) + //
							(config.getResources ? "; if (module) module.__resources=" + config.getResources(_, resolvedAs, locale) + ";" : ""),
						};
					});
				});
			} else {
				var locale = qs["localize"];
				var missing = [],
					processed = [];
				while (known.length > 0) {
					path = known[0];
					missing = depend.missingDependencies(_, root, path, processed);
					processed.push(known.splice(0, 1)[0]);
					doMultipart(_, depend.etag(), Object.keys(missing), function(_, path) {
						var resolvedAs = missing[path];
						var location = uncache(path.substring(root.length + 1));
						checkWhiteList(location);
						return {
							location: location,
							contentType: "application/json",
							data: config.getResources(_, resolvedAs, locale),
						};
					});
				}
			}
		} catch (ex) {
			console.error(ex.stack);
			return _replyError(response, 500, "require request failed. Check with your administrator");
		}
	};
};