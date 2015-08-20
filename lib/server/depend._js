"use strict";
//Analyzes require dependencies
var fs = require('streamline-fs');
var fspath = require('path');
var flows = require('streamline/lib/util/flows');

var dependencies = {};

var requireRE = /require(?:\.?(shallow))?\s*\(('|")([\w\W]*?)('|")(\)|,)/mg;

// remove JavaScript comments from a variable containing JavaScript code
// try to obey false comment starts within strings
// known issue:
// the following multiline comment will not be treated correctly:
// var a = "" /*
// /* */
//remove JavaScript comments from a variable containing JavaScript code
//try to obey false comment starts within strings and regular expressions with look like
//comment starts
function removeComments(str) {
    // replace comments where no tricky character (quotation marks, slash) is in same line before comment starts
    str = str.replace(/(^|[\r\n])([^"'\/]*)\/(?:\*[\s\S]*?\*\/|\/.*)/g, "$1$2");
    // if there are still comments, do a more complicated procedure
    if (/\/[\*\/]/.test(str)) {
        var result = "";
        var changes = false; // have parts of 'str' been replaced with null bytes (in order to avoid endless loops)?
        var re;
        var temp = ""; // temporary part: store previous lines when there are false comment starts
        // look for comments and also grab beginning of line
        while (re = /(.*?)\/(\*[\s\S]*?\*\/|\/.*)/.exec(str)) {
            // replace escaped tricky characters (quotation marks, slash, backslash, and null bytes (obtained from replacements below)
            // then remove strings and contents of regular expressions
            var d = re[1].replace(/\\[\\\"\'\/\x00]/g,"").replace(/([\"\']).*?\1|(?:^|[\};]\s*)\/.*?\//g, "");
            // remove number divisions
            d = d.replace(/[\w\)\]\!]\s*\/\s*([\w\$\=])/g, "$1 $2");
            // when there is still a tricky character, then the start of the comment is within 
            // a string or regex and therefore no comment start
            if (/[\"\'\/]/.test(d)) {
                // put a null byte at the position so that the same match will not be found again and repeat the procedure
                // put previous lines into 'temp'
                temp += str.substr(0, re.index);
                str = re[1]+"\x00"+str.substr(re.index+re[1].length+1);
                changes = true;
            } else {
                var ind = re.index+re[1].length;
                // otherwise a comment has been detected: put text before comment to result (replace null bytes with slashes again)
                // and remove text before comment and comment from string which should be regarded
                if (changes) {
                    changes = false;
                    result += (temp+str.substr(0, ind)).replace(/\x00/g, "/");
                    temp = "";
                } else {
                    result += str.substr(0, ind);
                }                
                str = str.substr(re.index+re[0].length);
            }
        }
        // replace remaining null bytes
        if (changes) str = (temp+str).replace(/\x00/g, "/"); 
        return result+str;
    }
    return str;
}

var funnel = flows.funnel(1);

function _exists(_, path) {
	return fs.exists(path, _);
}

function _normalize(path) {
	return path.replace(/\\/g, '/');
}

var modulesDir = _normalize(__dirname).split('/');
modulesDir = modulesDir.slice(0, modulesDir.length - 3).join('/');

function genETag() {
	return (Math.random() + "-" + Math.random()).replace(/\./g, '');
}
var _etag = genETag();
var _watched = {};

function _watcher(stats) {
	//console.log("WATCHER!")
	funnel(null, function() {
		// one of the files changed: regenerate etag and reset cache
		_etag = genETag();
		// unwatch all files because list may change
		Object.keys(_watched).forEach(function(path) {
			fs.unwatchFile(path);
		});
		_watched = {};
		dependencies = {};
	});
	//console.log("WATCHER DONE!")
}

exports.etag = function(suffixes) {
	var et = _etag;
	for (var i in suffixes) {
		et += "-" + suffixes[i];
	}
	return '"' + et + '"';
};

function _watch(file) {
	if (!_watched[file]) {
		_watched[file] = true;
		//fs.watchFile(file, _watcher);
	}
}

exports.loadOptions = {
	cache: true,
	verbose: true,
}

function requireChain(dep, recursing) {
	return (recursing ? dep.resolvedAs : dep.requiredAs) + (dep.requiredBy ? "\n\trequired by " + requireChain(dep.requiredBy, true) : "");
}
function _loadFile(_, dep) {
	var compiler = require("streamline/lib/compiler/compile");
	var path = dep.resolvedAs;
	_watch(path);
	return compiler.loadFile(_, path, exports.loadOptions);
}

function resolveDir(_, dep, path) {
	if (_exists(_, path + '/package.json')) {
		var pkg = JSON.parse(fs.readFile(path + '/package.json', 'utf8', _));
		if (pkg.main) {
			var res = resolveFile(_, dep, path + "/" + pkg.main);
			if (!res) new Error("invalid require path: " + requireChain(dep));
			return path;
		}
	}
	var extra = ['index.js', 'index._js', 'main.js', 'main._js'].filter_(_, function(_, extra) {
		return _exists(_, path + '/' + extra);
	})[0];
	if (extra) {
		dep.resolvedAs = path + "/" + extra;
		return path;
	}
	throw new Error("invalid require path: " + requireChain(dep));
}

function resolveFile(_, dep, path) {
	if (/\._?js$/.test(path) && _exists(_, path) && fs.stat(path, _).isFile()) {
		dep.resolvedAs = path;
		return path;			
	}
	if (_exists(_, path + ".js")) {
		dep.resolvedAs = path + '.js';
		return path;
	}
	if (_exists(_, path + "._js")) {
		dep.resolvedAs = path + '._js';
		return path;
	}
	if (_exists(_, path) && fs.stat(path, _).isDirectory()) {
		return resolveDir(_, dep, path);
	}
	return null;
}

function resolvePath(_, dep) {
	if (dep.requiredAs[0] === '.') {
		var path = fspath.join(fspath.dirname(dep.requiredBy.resolvedAs), dep.requiredAs);
		var res = resolveFile(_, dep, path);
		if (res) return res;
		else throw new Error("invalid require path: " + requireChain(dep));
	}
	var dir = dep.requiredBy ? dep.requiredBy.resolvedAs : dep.root;
	var dir = fspath.join(dir, "node_modules");
	do {
		if (_exists(_, dir)) {
			var res = resolveFile(_, dep, fspath.join(dir, dep.requiredAs));
			if (res) return res;
		}
		dir = fspath.join(dir, '../../node_modules');

	} while (dir.length >= dep.root.length)
	throw new Error("invalid require path: " + requireChain(dep));
}

//Returns all the dependencies of a given js file
//Can be used to build a dependency graph

function _directDependencies(_, dep) {
	var resolvedAs = dep.resolvedAs;
	if (dependencies[resolvedAs]) return dependencies[resolvedAs];
	var result = [];
	dependencies[resolvedAs] = result;
	var str = _loadFile(_, dep);
	str = removeComments(str);
	var match;
	while (match = requireRE.exec(str)) {
		result.push({
			root: dep.root,
			requiredAs: match[3],
			requiredBy: dep,
			opt: match[1],
		});
	}
	return result;
}

//Returns all the dependencies that we reach from path (recursively) but
//the we don't reach from any of the known paths (recursively too).
//Used to return require lists to the client

function _missingDependencies(_, root, path, known) {
	var knownMap = {};
	known.forEach(function(key) {
		knownMap[key] = true;
	});

	function _explore(_, dep, missingMap) {
		var path = resolvePath(_, dep);
		if (knownMap[path]) return;
		if (missingMap) missingMap[path] = dep.resolvedAs;
		knownMap[path] = true;
		if (dep.opt === 'shallow') return;
		var deps = _directDependencies(_, dep);
		deps.forEach_(_, function(_, dependency) {
			_explore(_, dependency, missingMap);
		});
	}

	var missingMap = {};
	// first explore known path, to fill knownMap with all their dependencies
	known.forEach_(_, function(_, cur) {
		var dep = {
			root: root,
			requiredAs: cur,
		};
		var cur = resolveFile(_, dep, cur);
		if (!cur) throw new Error("invalid known require path: " + requireChain(dep));
		_explore(_, dep, null);
	});
	// then fill missing map
	var dep = { 
		root: root, 
		requiredAs: path 
	};
	path = resolveFile(_, dep, path);
	if (!path) throw new Error("invalid require path: " + requireChain(dep));
	_explore(_, dep, missingMap);
	return missingMap;
}

/*
exports.directDependencies = function(_, path) {
	return funnel(_, function(_) {
		return _directDependencies(_, { requiredAs: path });
	});
};
*/
exports.missingDependencies = function(_, root, path, known) {
	return funnel(_, function(_) {
		return _missingDependencies(_, root, path, known);
	});
};