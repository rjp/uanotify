var jade = require('jade');
var sys = require('sys');
var uaclient = require('uaclient');
var notifo = require('notifo');
var redis = require('redis');
var connect = require('connect');
var auth = require('connect-auth');
var spawn = require('child_process').spawn;
var api_keys = require(process.env.HOME + '/.apikeys.js');

var r = redis.createClient();

var server = connect.createServer(
    connect.logger({ format: ':method :url' }),
    connect.bodyDecoder(),
    auth([
        auth.Basic({validatePassword: authenticate, realm: 'uanotify'})
    ]),
    connect.router(app),
    connect.errorHandler({ dumpExceptions: true, showStack: true })
);
server.listen(3000);
console.log('Connect server listening on port 3000');

var ua_sessions = {};

function authenticate(user, pass, success, failure) {
    sys.puts('pass is '+pass);
    sys.puts('getting the key auth:'+user);
    r.get('auth:'+user, function(err, result) {
        var real_pass = result.toString('utf8');
        sys.puts('real pass is '+real_pass);
        if (pass == real_pass) {
            sys.puts('AUTHENTICATED, PROCEEDING');
            success();
        } else {
            failure();
        }
    });
}

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

r.smembers('active:users', function(err, users) {
    debuffer_hash(users);
    for(q in users) {
        get_user_info(users[q], function(folders, subs, profile, sublist) {
            var b = []; for(z in folders) b.push(z); b.sort();
            sys.puts("starting a new bot for "+profile['ua:user']+'/'+profile['ua:pass']);
            profile['auth:name'] = users[q];
            ua_sessions[auth] = spawn('node', ['bot.js',JSON.stringify(profile)],{cwd:'/Users/rjp/git/uanotify'});
            // print whatever we get from the bot
            ua_sessions[auth].stdout.on('data', function(data) {
                sys.puts("<"+users[q]+"> "+data);
            });
        });
    }
});

function get_user_info(auth, callback) {
    blank_user = { 
        'ua:user': '', 'ua:pass': '', 'notify:type': 'Notifo', 
        'notify:dest': '', 'notify:freq': 7200
    };
    sys.puts('fetching the hash for user:'+auth);
    r.sismember('active:users', auth, function(err, isactive) {
    r.hgetall('user:'+auth, function(err,x){
        sys.puts(sys.inspect(x));
        debuffer_hash(x);

        // if we don't have a notify:type, this must be a new user
        // create one from our blank template and give them no subs
        // mark them as having no folders for printing in the template
        if (x == undefined || x['notify:type'] == undefined) {
            sys.puts("User doesn't exist in the store, creating a blank one");
            for(z in blank_user) {
                r.hset('user:'+auth, z, blank_user[z], function(){});
            }
            r.del('user:'+auth+':subs', function(){});
            x = blank_user;
        }
        x['active'] = isactive;

        r.smembers('user:'+auth+':folders', function(err, folders){
            debuffer_hash(folders);
            sys.puts(sys.inspect(folders));
            if (err == undefined) {
                // now we need the subscribed folders
                r.smembers('user:'+auth+':subs', function(err, subs){
                    sys.puts('ERROR '+err);
                    debuffer_hash(subs);
                    my_subs = []
                    for (z in subs) { my_subs[z] = subs[z]; }
                    // convert the array into a hash for quick existence checking
                    var subhash = {}; for(z in my_subs) { subhash[my_subs[z]] = 1; }
                    sys.puts(sys.inspect(subhash));
                    if (err == undefined) {
                        // GRIEF
                        callback(folders, subhash, x, my_subs);
                    }
                });
            }
        });
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
    app.get('/profile', function(req,res,params){
        req.authenticate(['basic'], function(err, authx){
            var auth = req.getAuthDetails().user.username;
            sys.puts('AUTHENTICATED AS '+auth);
            res.writeHead(200, {'Content-Type':'text/html'});
            get_user_info(auth, function(folders, subs, profile, sublist){
                jade.renderFile('profile.html', { locals: { profile: profile, folders: folders, subs: subs, sublist: sublist } },
                    function(err, html){ 
                    sys.puts(err);
                    res.end(html); 
                });
            });
        });
    });
    app.post('/updatefolders', function(req,res){
        req.authenticate(['basic'], function(err, authx){
            var auth = req.getAuthDetails().user.username;
            r.del('user:'+auth+':subs', function(){
                for(z in req.body) {
                    sys.puts("parameter "+z+" = "+req.body[z]);
                    if (z.substr(0,4) == 'sub_') {
                        r.sadd('user:'+auth+':subs', req.body[z]);
                    }
                }
            });

            res.writeHead(302, { Location: '/profile' });
            res.end();
        });
    });
    app.post('/update', function(req,res){
        req.authenticate(['basic'], function(err, authx){
            var auth = req.getAuthDetails().user.username;
            var hash = {};
            hash['ua:user'] = req.body.user;
            hash['ua:pass'] = req.body.pass;
            hash['notify:type'] = req.body.type;
            hash['notify:dest'] = req.body.dest;
            hash['notify:freq'] = req.body.freq;
            for(z in hash) {
                r.hset('user:'+auth, z, hash[z], function(){});
            }
            // stop any UA session they have running and start a new one
            if (ua_sessions[auth]) { 
                sys.puts("killing old bot session for "+auth);
                ua_sessions[auth].kill();
            } 
            if (req.body.active) {
                r.sadd('active:users', auth, function(){});
                sys.puts("spawning a new bot for "+hash['ua:user']+'/'+hash['ua:pass']);
                hash['auth:name'] = auth;
                ua_sessions[auth] = spawn('node', ['bot.js',JSON.stringify(hash)],{cwd:'/Users/rjp/git/uanotify'});
                // print whatever we get from the bot
                ua_sessions[auth].stdout.on('data', function(data) {
                    sys.puts("<"+auth+"> "+data);
                });
            } else {
                r.srem('active:users', auth, function(){});
                sys.puts("not spawning a new bot for "+hash['ua:user']);
            }

            sys.puts(sys.inspect(hash));
            res.writeHead(302, { Location: '/profile' });
            res.end();
        });
    });
    app.get('/folders', function(req,res){
        req.authenticate(['basic'], function(err, authx){
            var auth = req.getAuthDetails().user.username;
            res.writeHead(200, {'Content-Type':'text/html'});
            // TODO get the user folder subscription somewhere
            get_user_info(auth, function(folders, subs, profile, sublist){
                var b = []; 
                var safe_folders = {};
                for(z in folders) {
                    var q = folders[z];
                    b.push(q);
                    safe_folders[q] = q.replace(/[^a-zA-Z0-9]/g, ':')                    
                    sys.puts("SF "+q+" = "+safe_folders[q]);
                }
                b.sort();
                jade.renderFile('folders.html', { locals: { profile: profile, folders: folders, fkeys: b, subs: subs, safe: safe_folders } },
                    function(err, html){ 
                    sys.puts(err);
                    res.end(html); 
                });
            });
        });
    });
    app.get('/settings', function(req,res){
        req.authenticate(['basic'], function(err, authx){
            var auth = req.getAuthDetails().user.username;
            res.writeHead(200, {'Content-Type':'text/html'});
            // TODO get the user folder subscription somewhere
            get_user_info(auth, function(folders, subs, profile, sublist){
                var b = []; for(z in folders) b.push(z); b.sort();

                jade.renderFile('settings.html', { locals: { profile: profile, folders: folders, fkeys: b, subs: subs } },
                    function(err, html){ 
                    sys.puts(err);
                    res.end(html); 
                });
            });
        });
    });
    app.get('/noauth', function(req, res) {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('NOT AUTHENTICATED, BUGGER OFF!');
    });
}
