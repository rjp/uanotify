var jade = require('jade');
var sys = require('sys');
var uaclient = require('uaclient');
var notifo = require('notifo');
var redis = require('redis');
var connect = require('connect');
var api_keys = require(process.env.HOME + '/.apikeys.js');

var r = redis.createClient();

var server = connect.createServer(
    connect.logger({ format: ':method :url' }),
    connect.bodyDecoder(),
    connect.router(app),
    connect.errorHandler({ dumpExceptions: true, showStack: true })
);
server.listen(3000);
console.log('Connect server listening on port 3000');

function output_message(req, res, x) {
    a = JSON.parse(x);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    sys.puts("TO="+a.m_toname);
    var to = a.m_toname == undefined ? undefined : a.m_toname;
    d = new Date(a.m_date * 1000);
    b = d.toLocaleString();
    c = b.substr(16,5) +', '+ b.substr(0,3) +' '+ b.substr(8,2) +'/' + ('00'+(1+d.getMonth())).substr(-2);
    summary = a.foldername+'/'+a.message+' ('+a.m_msgpos+'/'+a.nummsgs+') at '+c;
    jade.renderFile('message.html', { locals: {
        summary: summary, from: a.m_fromname, to: to,
        subject: a.m_subject, body: a.m_text
        }}, function(err, html){
        res.end(html);
    });
}

function buffer_to_strings(x) {
    for(i in x) {
        x[i] = x[i].toString('utf8');
    }
    return x;
}

function output_links(req, res, x) {
    // convert our array of buffers to the JSON strings
    buffer_to_strings(x);
    // we're returning HTML, let's tell the browser that
    res.writeHead(200, { 'Content-Type': 'text/html' });

    var posts = [];
    for(i in x) {
        m = JSON.parse(x[i]);
	    d = new Date(m.m_date * 1000);
	    b = d.toLocaleString();
	    c = b.substr(16,5) +', '+ b.substr(0,3) +' '+ b.substr(8,2) +'/' + ('00'+(1+d.getMonth())).substr(-2);
        m.nicedate = c;
        m.flat_text = m.m_text.replace(/\n/g,' &sect; ');
        if (m.flat_text.length > 60) {
            m.flat_text = m.flat_text.substr(0,59) + '...';
        }
        m.to = (m.m_toname == undefined) ? '&nbsp;' : m.m_toname;
        posts.push(m);
    }
    sys.puts(sys.inspect(posts[0]));

    jade.renderFile('list.html', { locals: { posts: posts } },
        function(err, html){ 
        sys.puts(err);
        res.end(html); 
    });
}

function debuffer_hash(h) {
    for(i in h) {
        h[i] = h[i].toString('utf8');
    }
}
function get_user_info(z, callback) {
        r.hgetall('user:zimpenfish', function(err,x){
            sys.puts(sys.inspect(x));
	        debuffer_hash(x);
            r.smembers('user:zimpenfish:folders', function(err, folders){
                debuffer_hash(folders);
                sys.puts(sys.inspect(folders));
                if (err == undefined) {
                    // now we need the subscribed folders
                    r.smembers('user:zimpenfish:subs', function(err, subs){
                        debuffer_hash(subs);
                        // convert the array into a hash for quick existence checking
                        var subhash = {}; for(z in subs) { subhash[subs[z]] = 1; }
                        sys.puts(sys.inspect(subhash));
                        if (err == undefined) {
                            // GRIEF
                            callback(folders, subhash, x, subs);
                        }
                    });
                }
            });
        });
}

function app(app) {
    app.get('/m/:id', function(req, res){
        r.get(req.params.id, function(err, x){
            if (err == undefined) {
                output_message(req, res, x);
            }
        });
        console.log('return message '+req.params.id)
    });
    app.get('/l/:id', function(req, res){
        r.lrange(req.params.id, 0, -1, function(err, x){
            if (err == undefined) {
                output_links(req, res, x);
            }
        });
        console.log('return list '+req.params.id)
    });
    app.get('/profile', function(req,res){
        res.writeHead(200, {'Content-Type':'text/html'});
        get_user_info('zimpenfish', function(folders, subs, profile, sublist){
            jade.renderFile('profile.html', { locals: { profile: profile, folders: folders, subs: subs, sublist: sublist } },
                function(err, html){ 
                sys.puts(err);
                res.end(html); 
            });
        });
    });
    app.post('/update', function(req,res){
        var hash = {};
        hash['ua:user'] = req.body.user;
        hash['ua:pass'] = req.body.pass;
        hash['notify:type'] = req.body.type;
        hash['notify:dest'] = req.body.dest;
        hash['notify:freq'] = req.body.freq;
        for(z in hash) {
            r.hset('user:zimpenfish', z, hash[z], function(){});
        }
        r.del('user:zimpenfish:subs', function(){
            for(z in req.body) {
                if (z.substr(0,4) == 'sub_') {
                    r.sadd('user:zimpenfish:subs', z.substr(4));
                }
            }
        });
        sys.puts(sys.inspect(hash));
        res.writeHead(302, { Location: '/profile' });
        res.end();
    });
    app.get('/settings', function(req,res){
        res.writeHead(200, {'Content-Type':'text/html'});
        // TODO get the user folder subscription somewhere
        get_user_info('zimpenfish', function(folders, subs, profile, sublist){
            var b = []; for(z in folders) b.push(z); b.sort();

            jade.renderFile('settings.html', { locals: { profile: profile, folders: folders, fkeys: b, subs: subs } },
                function(err, html){ 
                sys.puts(err);
                res.end(html); 
            });
        });
    });
}
