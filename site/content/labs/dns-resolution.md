Before a browser can load `www.example.com` it needs an IP address. The [Domain Name System](#domain-name-system) is the phone book that supplies it, and it works as a hierarchy: ask a nearby resolver, which may have to ask the root servers, then the servers for `.com`, then the servers that actually own `example.com`. Most lookups never get that far. Tick the caches that already know the answer and see how much of the walk disappears.

<div data-widget="dns"></div>

## Try this

1. **Run it with nothing cached.** That is a cold lookup: browser, operating system, resolver, root, TLD, authoritative server. Every step costs a network round trip, and the times add up.
2. **Tick "Resolver has it cached".** The walk stops at the resolver. This is the common case, because a resolver serves many users and keeps popular names warm.
3. **Tick "Browser has it cached".** Now there is no network trip at all. Repeat visits to a site are fast partly for this reason.
4. **Tick only "Resolver already knows the .com servers".** The root server is skipped, since resolvers remember where the top-level servers are. A lookup for a name nobody has asked about recently still avoids the first hop.

## What this shows

- **Caching is what makes DNS fast.** As the README puts it, lower level DNS servers cache mappings, which can become stale because of DNS propagation delays. The time a record may be cached is its **TTL**. See [the disadvantages of DNS](#disadvantages-dns) for the cost of that staleness.
- **That is why changing DNS records is slow.** Anyone who cached the old answer keeps it until its TTL runs out, so lowering the TTL *before* a planned change makes the switch quicker.
- **DNS can do more than translate.** Managed DNS services can route traffic by weight, latency or geography, which is another way to spread load across [servers or regions](#load-balancer).
- Records come in kinds: an **A record** points a name at an address, a **CNAME** points a name at another name, an **NS record** names the servers for a domain, and an **MX record** names the mail servers.

## Changing a record

The walk above is about speed. TTL is about change. Move a site to a new server and every resolver that cached the old answer keeps sending users there until its copy expires.

<div data-widget="dns-ttl"></div>

Try it with a one-day TTL: look the name up, point it at the new server, then let an hour pass and look again. Users still reach the old server. Now reset, choose the one-day TTL, look it up, switch the TTL to 5 minutes and change the record straight away: it does not help, because the cached answer keeps the one-day TTL it was given. The working recipe is to lower the TTL at least one old TTL *before* the move, so that by moving day every cache holds a short-lived answer. Keep the old server running until the old TTL has passed.

## About the numbers

The times (20 ms to the resolver, 30 ms to a root server, and so on) are illustrative, not measurements. Real values depend on where you are, and many steps overlap or are skipped. Use them to compare cases, not to predict a real lookup.
