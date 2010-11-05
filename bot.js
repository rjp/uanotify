var jade = require('jade');
var sys = require('sys');
var uaclient = require('uaclient');
var notifo = require('notifo');
var redisFactory = require('redis-node');
var connect = require('connect');
var spawn = require('child_process').spawn;
require('./wordwrap.js');

// create our log as warning or $UANOTIFY_LEVEL
var Log = require('log');
var loglevel = process.env['UANOTIFY_LEVEL'] || 'warning';
var log = new Log(loglevel);

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
// TODO this should pick up the existing list from redis
// TODO this should just return the list name, not assign it
function new_list() {
    // allow forcing the UUID for testing purposes
    if (my_hash['force_uuid'] != undefined) {
        return my_hash['force_uuid'];
    } else {
        return Math.uuid();
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
        m.wrapped = String.wordwrap(m.text);
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
    for(var i in x) {
        item = JSON.parse(x[i]);
    }
    do_notify(x);
    notifybot.list = new_list();
}

function periodic() {
    old_list = notifybot.list;
    // if we have items, send them to notify_list
    redis.llen(old_list, function(e, x) {
        if (x > 0) {
            redis.lrange(old_list, 0, -1, notify_list);
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
        if (prefix == undefined) {
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
    x = notifybot.getChild(a, 'message');
    flatten(a);
    flatten(x, 'm_');
    extend(a, x);
    var auth = my_hash['auth:name'];
    if (my_hash['ua:markread'] == undefined || ! my_hash['ua:markread']) {
        notifybot.request('message_mark_unread', { messageid: a.message, crossfolder: 1 });
    }
    redis.smembers('user:'+auth+':subs', function(err, folders){
        buffer_to_strings(folders);
        var q = {}; for(var z in folders) { q[folders[z]] = 1 }
        log.info(sys.inspect(q));

        if (q[a.foldername] == 1) {
            log.info("post in a watched folder, "+a.foldername+", from "+a.fromname);
            link = Math.uuid();
            a.link = link;
            redis.rpush(notifybot.list, JSON.stringify(a), function(){});
            redis.set(link, JSON.stringify(a), function(){});
        }
    });
}

function announce_message_add(a) {
    notifybot.flatten(a);
    // default to requesting message bodies without marking them read
    var rp = { messageid: a['messageid'], markread: 0 };
    if (my_hash['ua:markread'] != undefined && my_hash['ua:markread']) {
        delete rp['markread']; // absence makes the marking readier
    }
    notifybot.request('message_list', rp);
}

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
            var new_level = Log[level.toUpperCase()];
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
notifybot.list = new_list();

setInterval(log_levels, 30*1000); // change log levels every 30 seconds
setInterval(periodic, my_hash['notify:freq'] * 1000);
notifybot.connect(my_hash['ua:user'], my_hash['ua:pass'], my_hash['ua:server'], my_hash['ua:port']);
