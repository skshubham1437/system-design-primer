### Authentication and authorization are different questions

**Authentication** asks who you are. **Authorization** asks what you are allowed to do. Systems fail when the two are blurred: a service that checks you are logged in, but never checks the record you asked for belongs to you, lets any user read any other user's data by changing an ID in the URL. Check authorization on the server, on every request, for the specific resource.

### Encrypt everywhere you can

The basics above say to encrypt in transit and at rest. In practice:

- **In transit:** use TLS for all traffic, including calls between your own services. Internal networks are not automatically safe.
- **At rest:** encrypt disks and databases, and keep the encryption keys somewhere other than next to the data, ideally in a managed key service.
- **Passwords:** never store them in plain text. Store a salted hash made with a deliberately slow algorithm such as bcrypt, scrypt or Argon2.

### Treat all input as hostile

Anything that comes from a user, or from another system you do not control, can be an attack. Different problems need different defences, and they are not interchangeable:

- **SQL injection:** use parameterized queries, so data can never be read as part of the query.
- **Cross-site scripting (XSS):** encode output for the place it is shown, and restrict what scripts a page may run with a content security policy.
- **Cross-site request forgery (CSRF):** use anti-forgery tokens or same-site cookies for requests that change state.

### Keep secrets out of code

API keys, database passwords and signing keys do not belong in source control or container images. Load them from a secrets manager, give each service only the secrets it needs, and make rotating them routine so a leak has a short lifespan.

### Limit the damage when something goes wrong

Assume some defence will fail and design so one failure is not the whole story, which is called defence in depth.

- **Least privilege:** each service, job and person gets the minimum access needed. A service that only reads should not hold write credentials.
- **Rate limiting** at the edge blunts password guessing, scraping and abusive clients.
- **Logging and monitoring** make an attack visible while it is happening, and audit logs show afterwards what was touched.
- **Patching** dependencies promptly matters because most attacks use known, already-fixed flaws.

### In a design interview

You do not need depth, but you should show the instinct. When you sketch a system, say how users authenticate (sessions or tokens), that traffic uses TLS, where authorization is enforced, that sensitive data is encrypted and who can read it, and where rate limiting sits. A sentence on each is usually enough.

For a current, maintained list of the most common web application risks, see the [OWASP Top Ten](https://owasp.org/www-project-top-ten/), and the [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) for concrete guidance on each.
