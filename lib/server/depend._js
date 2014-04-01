"use strict";
//Analyzes require dependencies
var fs = require('streamline-fs');
var fspath = require('path');
var flows = require('streamline/lib/util/flows');

var dependencies = {};

var requireRE = /require\s*\(('|")([\w\W]*?)('|")\)/mg;

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

function _combine(path, rel) {
	var cut = path.lastIndexOf('/');
	if (cut <= 0) throw new Error("too many parent dirs" + rel);
	path = path.substring(0, cut);
	while (rel.indexOf('./.') == 0) // get rid of leading ./. and ./..
		rel = rel.substring(2);
	if (rel.indexOf('../') == 0) return _combine(path, rel.substring(1));
	if (rel.indexOf('./') != 0) return modulesDir + "/" + rel;
	return path + rel.substring(1);
}

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

exports.etag = function() {
	return "" + _etag;
};

function _watch(file) {
	if (!_watched[file]) {
		_watched[file] = true;
		//fs.watchFile(file, _watcher);
	}
}

function _loadFile(_, path) {
	var js = path + ".js";
	var js_ = path + "_.js";
	var _js = path + "._js";
	if (_exists(_, _js)) {
		_watch(_js);
		return require("streamline/lib/compiler/compile").loadFile(_, _js);
	} else if (_exists(_, js_)) {
		_watch(js_);
		return require("streamline/lib/compiler/compile").loadFile(_, js);
	} else if (_exists(_, js)) {
		_watch(js);
		return require("streamline/lib/compiler/compile").loadFile(_, js);
	} else throw new Error("invalid require path: " + path);
}

function _extendPath(_, path) {
	if (!_exists(_, path + ".js") && _exists(_, path) && fs.stat(path, _).isDirectory()) {
		// should read package.json here -- see later
		if (_exists(_, path + "/main.js")) return path + "/main";
		else if (_exists(_, path + "/index.js")) return path + "/index";
	}
	return path;
}

//Returns all the dependencies of a given js file
//Can be used to build a dependency graph

function _directDependencies(_, path) {
	if (dependencies[path]) return dependencies[path];
	var result = [];
	dependencies[path] = result;
	var str = _loadFile(_, path);
	str = removeComments(str);
	var match;
	while (match = requireRE.exec(str)) {
		result.push(_combine(path, match[2]));
	}
	return result;
}

//Returns all the dependencies that we reach from path (recursively) but
//the we don't reach from any of the known paths (recursively too).
//Used to return require lists to the client

function _missingDependencies(_, path, known) {
	var knownMap = {};
	known.forEach(function(key) {
		knownMap[key] = true;
	});

	function _explore(_, path, missingMap) {
		path = _extendPath(_, path);
		if (knownMap[path]) return;
		if (missingMap) missingMap[path] = true;
		knownMap[path] = true;
		var dependencies = _directDependencies(_, path);
		dependencies.forEach_(_, function(_, dependency) {
			_explore(_, dependency, missingMap);
		});
	}

	var missingMap = {};
	// first explore known path, to fill knownMap with all their dependencies
	known.forEach_(_, function(_, cur) {
		_explore(_, cur, null);
	});
	// then fill missing map
	_explore(_, path, missingMap);
	return Object.keys(missingMap);
}

exports.directDependencies = function(_, path) {
	return funnel(_, function(_) {
		return _directDependencies(_, path);
	});
};
exports.missingDependencies = function(_, path, known) {
	return funnel(_, function(_) {
		return _missingDependencies(_, path, known);
	});
};