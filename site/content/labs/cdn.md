Distance costs time. A user in Asia reaching a server in the United States waits on a long round trip every time. A [content delivery network](#content-delivery-network) puts copies of your files on servers near users, so most requests never travel that far. Here the origin sits in the United States. Request the same file from three regions and compare.

<div data-widget="cdn"></div>

## Try this

1. **Start with "No CDN".** Request from Asia and from the United States. The only difference is distance, and the far user pays for it on every request.
2. **Switch to "Pull CDN" and request from Europe twice.** The first request is slower than having no CDN at all, because the edge has to fetch the file from the origin before it can answer. The second is fast. That is the README's point: a pull CDN gives a slower request until the content is cached.
3. **Request from another region.** Each edge fills on its own, so the first user in every region pays the cost once.
4. **Let ticks pass beyond the TTL and request again.** The copy has expired, so the edge goes back to the origin. A short TTL keeps content fresh but sends more traffic to the origin. A long one does the opposite.
5. **Switch to "Push CDN".** Every edge starts with the file, so even the first request in each region is fast, and nothing expires on its own. Press "Purge the edges" to remove the copies; the next request has to go back to the origin.

## What this shows

- **A CDN helps in two ways**, as the README says: users get content from a nearby data centre, and your own servers do not have to serve the requests the CDN fulfils. See [the CDN section](#content-delivery-network).
- **[Push CDNs](#push-cdns)** suit sites with little traffic or content that rarely changes: it is placed once rather than re-pulled at intervals. You take on responsibility for uploading it.
- **[Pull CDNs](#pull-cdns)** suit busy sites, where only recently requested content stays on the CDN. They can create redundant traffic when files expire before they have actually changed.
- **Staleness is the cost.** Content may be out of date if it changes before its TTL expires. See [the disadvantages of CDNs](#disadvantages-cdn).

## Watch the hit ratio

The counters under the map are what a CDN is judged by. Request each region a few times with a pull CDN: the hit ratio climbs as the edges fill, the origin sees only the first request per region per TTL, and the average time falls towards the 15 ms of a nearby edge. Shorten the TTL and the ratio drops, because copies expire before they are reused.

Purging is the blunt way to publish a new version of a file. The usual alternative is **versioned URLs**: put a hash of the content in the file name (`app.3f9a1c.js`), give it a very long TTL, and change the name when the content changes. Nothing ever has to be purged, and a cached old version can never be served for the new name.

## About the numbers

The milliseconds are illustrative round trips (15 ms to a nearby edge, 40 to 190 ms to the origin depending on where you are). They show the shape of the benefit, which grows with distance.
