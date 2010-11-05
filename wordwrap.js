// stolen from marak's node-mailer
// http://github.com/Marak/node_mailer/blob/master/lib/node_mailer.js
(function(){
    String.wordwrap = function(str){
	    var m = 80;
	    var b = "\r\n";
	    var c = false;
	    var i, j, l, s, r;
	    str += '';
	    if (m < 1) {
	      return str;
	    }
	    for (i = -1, l = (r = str.split(/\r\n|\n|\r/)).length; ++i < l; r[i] += s) {
	      for(s = r[i], r[i] = ""; s.length > m; r[i] += s.slice(0, j) + ((s = s.slice(j)).length ? b : "")){
	        j = c == 2 || (j = s.slice(0, m + 1).match(/\S*(\s)?$/))[1] ? m : j.input.length - j[0].length || c == 1 && m || j.input.length + (j = s.slice(m).match(/^\S*/)).input.length;
	      }
	    }
	    return r.join("\n");
	}
})();
