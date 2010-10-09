var sys = require('sys');
var uaclient = require('uaclient');
var notifo = require('notifo');
var redis = require('redis');
var connect = require('connect');

var r = redis.createClient();
var username = process.argv[2];

var safe_username = username.replace(/[^A-Za-z0-9]/g, '_');

var token = new Date().getTime().toString(36);
var unikey = [safe_username, process.pid, token].join(':');

var nextid = [unikey, 'nextid'].join(':');
var list = [unikey, 'list', ''].join(':');

// start a new list to avoid collisions / race conditions
function new_list() {
    sys.puts("incrementing "+nextid);
    r.incr(nextid, function(err, id) {
        sys.puts("err is "+err);
        notifybot.id = id;
        sys.puts("storing new items in "+list+id);
    });
}

function buffer_to_strings(x) {
    for(i in x) {
        x[i] = x[i].toString('utf8');
    }
    return x;
}

function notify_list(e, x) {
    buffer_to_strings(x);
    for(i in x) {
        item = JSON.parse(x[i]);
        sys.puts(sys.inspect(item));
    }
    new_list();
}

function periodic() {
    old_list = list + notifybot.id
    // if we have items, send them to notify_list
    r.llen(old_list, function(e, x) {
        if (x > 0) {
            r.lrange(old_list, 0, -1, notify_list);
        }
    });
}

notifybot = new uaclient.UAClient;
notifybot.id = 0

function reply_message_list(a) {
    x = notifybot.getChild(a, 'message');
    notifybot.flatten(a);
    sys.puts(JSON.stringify(a));
    r.rpush(list+notifybot.id, JSON.stringify(a), function(){});
}

function announce_message_add(a) {
    notifybot.flatten(a);
    notifybot.request('message_list', {messageid: a['messageid']});
}

notifybot.addListener("announce_message_add", announce_message_add);
notifybot.addListener("reply_message_list", reply_message_list);

sys.puts("setting "+nextid+" to 0 and starting our count there");
r.set(nextid, 0);
setInterval(periodic, 3*60*1000);
notifybot.connect(process.argv[2], process.argv[3], 'ipz.frottage.org', 8080);
