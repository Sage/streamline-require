// Tests for removeComment function

// remove JavaScript comments from a variable containing JavaScript code
// try to obey false comment starts within strings and regular expressions
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


// test function receives a piece of JavaScript code without comment. It puts a one-line comment after the piece of code and
// tests whether the comments are correctly removed.
// Then the same test with multiline comments before and after the piece of code
function test(str) {
  if (removeComments(str+"// coment") !== str || removeComments('/* start\n  " */' +str+"/* end ' \n */") !== str) {
    console.log("Wrong extraction "+str);
} else console.log("OK "+str);
}

test("/ab/.test(x) && y ");
test("/ab\\//.test(x) && y");
test('var a = "/ab/.test(x) // /* \\"\'" && y ');
test('/\\/*ab*/ ');
test("/'\\/*/.test('/\"/*\\'')");
test("a /= 2");
test("a = b(3)/2");
test("a=b['zzz']/x(1)");
test("a='//';b='//';c='//';");
test("a='////////////////////////////////' ");