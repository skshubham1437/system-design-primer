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

## About the numbers

The milliseconds are illustrative round trips (15 ms to a nearby edge, 40 to 190 ms to the origin depending on where you are). They show the shape of the benefit, which grows with distance.
