### SSL termination at the balancer

Encrypting and decrypting traffic costs processor time, and every server behind a load balancer would otherwise repeat that work. With SSL termination the balancer decrypts each incoming request and encrypts the response, so the backend servers receive and send plain requests. Only the balancer needs the certificate, so you do not have to install an X.509 certificate on every server either.

The trade-off is inside your network. Traffic between the balancer and a backend server is no longer encrypted unless you encrypt it again on that hop, which matters when the servers sit on networks you do not fully control.
