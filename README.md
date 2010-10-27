UA Notifier Bot
===============

> Let's say I'm running a Blackberry / Android UA rich client that
> received new message notifications (what's that Skippy? No native
> Symbian push API for Symbian?), by which I mean simple "there are
> new messages" ping that causes the unread message counts to refresh
> using a folder list. Now my inclusive data tariff isn't all that so
> I probably have different requirements compared to being sat at home
> using qUAck over WiFi / broadband. I might only be interested in
> knowing when new messages turn up in Private, London-Chat and Quiz for
> example but not the other 50 folders that I read when I've got time.
> So the gateway picks up all the new message notifications and issues a
> push to you if the message is in a folder that's part of your roaming
> profile. Now granted nothing in the UA server supports the concept
> subscription filtering but you could achieve the same thing by storing
> the information as client data which UA does support.

HOWTO
-----
First you need a JSON configuration file:

    { "ua_host":"some.host.org", "ua_port":2334,
      "url_base":"localhost:3000", "port":3000,
      "frequency":{"7200":"Two hours","180":"Three minutes"} 
    }
    
Pass that as the only argument to the server.

    > node server.js config.js
