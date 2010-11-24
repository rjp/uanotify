var jade = require('jade');
var sys = require('sys');
var uaclient = require('uaclient');
var notifo = require('notifo');
var redisFactory = require('redis-node');
var spawn = require('child_process').spawn;
require('./wordwrap.js');

// create our log as warning or $UANOTIFY_LEVEL
var Log = require('log');
var loglevel = process.env['UANOTIFY_LEVEL'] || 'warning';
var log = new Log(loglevel);

process.on('uncaughtException', function(err) {
    log.critical("uncaught:"+err);
    process.exit(88);
});

var api_keys = require(process.env.HOME + '/.apikeys.js');
require('./Math.uuid.js');

var mail = require('mail').Mail({
    host: keys.smtp.host,
    port: 25,
    username: keys.smtp.user,
    password: keys.smtp.pass
});

// wrapper around try/catch for standardised handling
function catcher(exitcode, callee) {
    try {
        callee();
    } catch(e) {
        log.critical(e);
        process.exit(exitcode);
    }
}

var notifybot; // our UA bot
var my_json = process.argv[2];

var my_hash;
catcher(44, function(){
    my_hash = JSON.parse(my_json);
});

var notify_user = my_hash['notify:dest'];
var notify_type = my_hash['notify:type'];
var url_server = my_hash['url:base'];

// create this up here
var notification;
catcher(43, function() {
    notification = new notifo({
	    'username': keys.notifo.user,
	    'secret': keys.notifo.secret
	})
});

// connect to redis if we can
var redis = redisFactory.createClient();
redis.addListener('noconnection', function(){
    log.critical("No Redis?");
    process.exit(42);
});
redis.addListener('reconnecting', function(){
    log.info("REDIS reconnecting");
});

var username = my_hash['ua:user'];

var safe_username = username.replace(/[^A-Za-z0-9]/g, '_');

// start a new list to avoid collisions / race conditions
function new_list() {
    // allow forcing the UUID for testing purposes
    if (my_hash['force_uuid'] != undefined) {
        return my_hash['force_uuid'];
    } else {
        var nl = Math.uuid();
        redis.set('user:'+my_hash['auth:name']+':currentlist', nl, function(){});
        return nl;
    }
}

// temporary fix for the broken packet handling
// inspired by a smart cheese
function serial_mget (redis, list, final_callback) {
    var ilist = new Array;
    var lsize = list.length;
    var mid_callback = function(err, val){
        if (err) final_callback(err, undefined);
        ilist.push(val);
        if (ilist.length == lsize) {
            final_callback(undefined, ilist);
	    }
    };
    for(var i in list) {
        redis.get(list[i], mid_callback);
    }
}

function buffer_to_strings(x) {
    for(var i in x) {
        if ('buffer' == typeof x[i]) {
            x[i] = x[i].toString('utf8');
        }
    }
    return x;
}

function send_by_notifo(x, uri) {
	    notification.send({
	        title: 'UA New messages',
	        to: notify_user,
	        msg: x.length+' new messages',
	        uri: uri
	    }, function(err, response){
	        if (err) { throw err; }
	        else { console.log(response); }
	    });
}

function send_by_email(x, uri) {
    var boundary = Math.uuid();
    var posts = [];

    // this should be refactored
    for(var i in x) {
        var m;
        try {
            m = JSON.parse(x[i]);
        } catch(e) {
            log.critical("send_by_email: "+x[i]);
            throw(e);
        }
	    d = new Date(m.m_date * 1000);
	    b = d.toLocaleString();
	    c = b.substr(16,5) +', '+ b.substr(0,3) +' '+ b.substr(8,2) +'/' + ('00'+(1+d.getMonth())).substr(-2);
        m.nicedate = c;
        m.flat_text = m.m_text.replace(/\n/g,' &sect; ');
        if (m.flat_text.length > 60) {
            m.flat_text = m.flat_text.substr(0,59) + '...';
        }
        m.to = (m.m_toname == undefined) ? '&nbsp;' : m.m_toname;
        m.wrapped = String
                    .wordwrap(m.text)
                    .replace(/\n\n/g, "<br/><br/>")
                    .replace(/\n>/g,  "<br/>&gt;");
        posts.push(m);
    }

    var l = { posts: posts, notify_user: notify_user, uri: uri, boundary: boundary };

    jade.renderFile('email.txt', { locals: l }, function(err, html) {
        if (err) throw(err);
		mail.message({
		    from: 'UA Notify Bot <uanotify@frottage.org>',
		    to: [notify_user],
		    subject: 'UANotify: '+x.length+' new messages',
	        "content-type": 'multipart/alternative; boundary='+boundary
	    }).body(html)
		  .send(function(err) {
		    if (err) throw err;
	    });
    });
}

function do_notify(x) {
    var old_list = notifybot.list
    var uri = 'http://'+url_server+'/l/'+old_list;

    if (notify_user == undefined) {
        log.info(uri);
    } else {
        if (notify_type == 'Notifo') {
            send_by_notifo(x, uri);
        }
        if (notify_type == 'Email') {
            send_by_email(x, uri);
        }
    }
}

function notify_list(e, x) {
    buffer_to_strings(x);
    do_notify(x);
    notifybot.list = new_list();
}

// convert our list of messageids to messages
function messageids_to_list(err, list) {
    if (err) throw(err);
    serial_mget(redis, list, notify_list);
}

function periodic() {
    old_list = "sorted:" + notifybot.list;
    // if we have items, send them to notify_list
    redis.zcard(old_list, function(e, x) {
        if (x > 0) {
            redis.zrange(old_list, 0, -1, messageids_to_list);
        }
    });
}

notifybot = new uaclient.UAClient(log);
notifybot.id = 0
notifybot.shadow = 256;

function extend(v1, v2) {
    for (var property in v2) {
        v1[property] = v2[property];
    }
    return v1;
}

// semi-flatten an EDF tree into a more usable JS object
function flatten(q, prefix) {
    for(var i=0;i<q.children.length;i++){
        if (prefix === undefined) {
            q[q.children[i].tag] = q.children[i].value
        } else {
            q[prefix + q.children[i].tag] = q.children[i].value
        }
    };
    return q;
}

// <request="folder_list"><searchtype=2/></>
function reply_folder_list(a) {
//    <reply="folder_list"><folder=1><name="test"/><accessmode=7/><subtype=1/><unread=1/></><folder=2><name="private"/><accessmode=263/><subtype=1/></><folder=3><name="chat"/><accessmode=7/><subtype=1/><temp=1/></><numfolders=3/></>
    var f = [];
    for(var i in a.children) {
        var v = a.children[i];
        flatten(v);
        log.info("F "+v.name);
        f.push(v.name);
    }
    notifybot.emit('folders', f);
}

function reply_message_list(a) {
    // hoist the message part into the root with an m_ prefix
    var x = notifybot.getChild(a, 'message');
    flatten(a);
    flatten(x, 'm_');
    extend(a, x);

    var auth = my_hash['auth:name'];
    if (my_hash['ua:markread'] == undefined || ! my_hash['ua:markread']) {
        notifybot.request('message_mark_unread', { messageid: a.message, crossfolder: 1 });
    }

    a.link = Math.uuid();
    var json = JSON.stringify(a);
    redis.set(a.link, json, function(){});

    var us_folder = a.foldername.toUpperCase();
    var c_folder = a.folderid; // this is how UA sorts, we might as well keep it
    // this assumes that a.message is monotonically increasing
    // (at least within a folder, if not globally) and that 
    // it'll stay below 10,000,000 (~ 30 years at current rate)
    var score = 10000000 * c_folder + a.message;
    log.info("adding to sorted list, us_folder="+us_folder+", score="+score);
    redis.zadd('sorted:'+notifybot.list, score, a.link, function(err,x){sys.puts("zadd.err = "+err)});
}

function announce_message_add(a) {
    notifybot.flatten(a);
    var auth = my_hash['auth:name'];

    // is this post in a folder we're uanotify-subscribed to?
    redis.sismember('user:'+auth+':subs', a.foldername, function(err, subscribed){
        if (subscribed === 0) { return; } // do nothing, we're not subscribed here
        log.info("post in a watched folder, "+a.foldername+", from "+a.fromname);
	    // default to requesting message bodies without marking them read
	    var rp = { messageid: a['messageid'], markread: 0 };
	    if (my_hash['ua:markread'] != undefined && my_hash['ua:markread']) {
	        delete rp['markread']; // absence makes the marking readier
	    }
	    notifybot.request('message_list', rp);
    });
}

// TODO need a better way of updating the list without mass delete/insert
function cache_folders(f) {
    redis.del('user:'+my_hash['auth:name']+':folders', function(){
        for(var i in f) {
            log.info("CF "+f[i]);
            redis.sadd('user:'+my_hash['auth:name']+':folders', f[i], function(){});
        }
    });
}

function log_levels() {
    redis.get('log:'+my_hash['auth:name']+':level', function(err, b_level) {
        if (!err && b_level != undefined) {
            var level = b_level.toString('utf8');
            var new_level = Log[level.toUpperCase()]; // fudgy
            if (new_level != log.level) {
                log.warning('changing log level to '+level);
                log.level = new_level;
            }
        }
    });
}

notifybot.addListener("folders", cache_folders);
notifybot.addListener("announce_message_add", announce_message_add);
notifybot.addListener("reply_message_list", reply_message_list);
redis.get('user:'+my_hash['auth:name']+':currentlist', function(err, l){
    if (err) throw(err);
    if (l != undefined) {
        notifybot.list = l;
    } else {
        notifybot.list = new_list();
    }
});

setInterval(log_levels, 90*1000); // change log levels every 30 seconds
setInterval(periodic, my_hash['notify:freq'] * 1000);
notifybot.connect(my_hash['ua:user'], my_hash['ua:pass'], my_hash['ua:server'], my_hash['ua:port']);
