var jade = require('jade');
var sys = require('sys');
var uaclient = require('uaclient');
var notifo = require('notifo');
var redis = require('redis');
var connect = require('connect');
var email = require('mailer');
var spawn = require('child_process').spawn;

var api_keys = require(process.env.HOME + '/.apikeys.js');
require('./Math.uuid.js');

var my_json = process.argv[2];
var my_hash = JSON.parse(my_json);

var notify_user = my_hash['notify:dest'];
var notify_type = my_hash['notify:type'];
var url_server = my_hash['url:base'];

// create this up here
var notification = new notifo({
    'username': keys.notifo.user,
    'secret': keys.notifo.secret
});

var r = redis.createClient();

var username = my_hash['ua:user'];

var safe_username = username.replace(/[^A-Za-z0-9]/g, '_');

var token = new Date().getTime().toString(36);
var unikey = [safe_username, process.pid, token].join(':');

var nextid = [unikey, 'nextid'].join(':');
var list = [unikey, 'list', ''].join(':');


// start a new list to avoid collisions / race conditions
function new_list() {
    notifybot.list = Math.uuid();
}

function buffer_to_strings(x) {
    for(i in x) {
        x[i] = x[i].toString('utf8');
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
    jade.renderFile('email.txt', { locals: {
        x: x, notify_user: notify_user, uri: uri
    }}, function(err, html) {
        var child = spawn('/usr/sbin/sendmail', ['-t']);
        child.stdin.write(html, 'utf8');
        child.stdin.end();
    });
}

function do_notify(x) {
    var old_list = notifybot.list
    var uri = 'http://'+url_server+'/l/'+old_list;

    if (notify_user == undefined) {
        sys.puts(uri);
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
    for(i in x) {
        item = JSON.parse(x[i]);
    }
    do_notify(x);
    new_list();
}

function periodic() {
    old_list = notifybot.list;
    // if we have items, send them to notify_list
    r.llen(old_list, function(e, x) {
        if (x > 0) {
            r.lrange(old_list, 0, -1, notify_list);
        }
    });
}

notifybot = new uaclient.UAClient;
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
    for(i=0;i<q.children.length;i++){
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
    for(i in a.children) {
        var v = a.children[i];
        flatten(v);
        sys.puts("F "+v.name);
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
    if (! my_hash['ua:markread']) {
        notifybot.request('message_mark_unread', { messageid: a.message, crossfolder: 1 });
    }
    r.smembers('user:'+auth+':subs', function(err, folders){
        buffer_to_strings(folders);
        var q = {}; for(z in folders) { q[folders[z]] = 1 }
        sys.puts(sys.inspect(q));

        if (q[a.foldername] == 1) {
            sys.puts("post in a watched folder, "+a.foldername+", from "+a.fromname);
            link = Math.uuid();
            a.link = link;
            r.rpush(notifybot.list, JSON.stringify(a), function(){});
            r.set(link, JSON.stringify(a), function(){});
        }
    });
}

function announce_message_add(a) {
    notifybot.flatten(a);
    // default to requesting message bodies without marking them read
    var rp = { messageid: a['messageid'], markread: 0 };
    if (my_hash['ua:markread']) {
        delete rp['markread']; // absence makes the marking readier
    }
    notifybot.request('message_list', rp);
}

function cache_folders(f) {
    r.del('user:'+my_hash['auth:name']+':folders', function(){
        for(i in f) {
            sys.puts("CF "+f[i]);
            r.sadd('user:'+my_hash['auth:name']+':folders', f[i], function(){});
        }
    });
}

notifybot.addListener("folders", cache_folders);
notifybot.addListener("announce_message_add", announce_message_add);
notifybot.addListener("reply_message_list", reply_message_list);
notifybot.list = Math.uuid();

setInterval(periodic, my_hash['notify:freq'] * 1000);
notifybot.connect(my_hash['ua:user'], my_hash['ua:pass'], my_hash['ua:server'], my_hash['ua:port']);
