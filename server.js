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

//    sys.puts(x);
    sys.puts(sys.inspect(a));
    sys.puts(a.message);

    d = new Date(a.m_date * 1000);
    b = d.toLocaleString();
    c = b.substr(16,5) +', '+ b.substr(0,3) +' '+ b.substr(8,2) +'/' + ('00'+(1+d.getMonth())).substr(-2);
    summary = a.foldername+'/'+a.message+' ('+a.m_msgpos+'/'+a.nummsgs+') at '+c;
    jade.renderFile('message.html', { locals: {
        summary: summary, from: a.m_fromname, to: a.m_toname,
        subject: a.m_subject, body: a.m_text
        }}, function(err, html){
        res.end(html);
    });
}

function output_links(req, res, x) {
    // convert our array of buffers to the JSON strings
    buffer_to_strings(x);
    // we're returning HTML, let's tell the browser that
    res.writeHead(200, { 'Content-Type': 'text/html' });
    // for each message, we output a link
    for(i in x) {
        m = JSON.parse(x[i]);
        sys.puts(x[i]);
        title = m.m_subject;
        res.write('<a href="/m/'+m.link+'">'+title+'</a><br/>');
    }
    // and send
    res.end('<em>FISH</em>');
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
}
