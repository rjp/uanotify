var sys = require('sys');
var uaclient = require('uaclient');
var notifo = require('notifo');
var redis = require('redis');
var connect = require('connect');

notifybot = new uaclient.UAClient;
function announce_message_add(a) {
    sys.puts(sys.inspect(a));
    notifybot.flatten(a);
}
notifybot.addListener("announce_message_add", announce_message_add);
notifybot.connect(process.argv[2], process.argv[3]);
