Networks lose packets. [TCP](#transmission-control-protocol-tcp) and [UDP](#user-datagram-protocol-udp) answer that fact in opposite ways. TCP promises that everything arrives, intact and in order, and pays for the promise with extra round trips and waiting. UDP makes no promise and so never waits. Send the same 16 packets over each and see what you get.

<div data-widget="tcp-udp"></div>

## Try this

1. **Set loss to 0%.** Both protocols deliver everything. TCP finishes later only because of the handshake, a connection set-up that happens before any data flows.
2. **Raise loss to about 15%.** UDP finishes at the same time as before but is missing packets. TCP delivers all 16, with some resent (the orange dots), and takes longer.
3. **Look at the orange bars under the TCP lane.** A packet that arrived is *not* handed to the application until every earlier packet has arrived, so one lost packet holds back everything behind it. This is *head-of-line blocking*, and it is the price of in-order delivery.
4. **Raise the round-trip time.** In this model every recovery waits for a timeout of twice the round trip, so slow links hurt TCP more than UDP. Real TCP usually notices a loss sooner, when later packets arrive and the receiver keeps acknowledging the gap (fast retransmit), but it still needs at least one extra round trip to fill it.
5. **Compare the QUIC lane.** It resends lost packets just like TCP and delivers everything, but its packets belong to four independent streams (think four files on one web page). A loss holds back only the packets of its own stream, so the orange waiting bars are shorter. That is the main reason HTTP/3 runs over QUIC.
6. **Press "Roll the dice again"** to see that which packets get lost is random, but the pattern holds.

## What this shows

- **TCP** is connection-oriented, uses a handshake, and guarantees delivery with sequence numbers, acknowledgements and automatic retransmission. Choose it when you need all the data to arrive intact, such as web pages, database traffic, email or file transfer.
- **UDP** is connectionless. Datagrams may arrive out of order or not at all, but there is no connection to set up and nothing to wait for. Choose it when the lowest latency matters or when late data is worse than lost data: voice and video calls, streaming and real-time games.
- **The deciding question is what you do with a late packet.** In a voice call it is useless by the time it arrives, so waiting for it is the wrong trade. In a file download every byte matters, so skipping it is.
- **QUIC**, the transport under HTTP/3, builds reliable delivery on top of UDP. It keeps separate streams independent, so one lost packet only holds back its own stream instead of everything behind it. Its handshake also sets up encryption in the same round trip, where TCP needs extra round trips for TLS.
- Application protocols such as [HTTP](#hypertext-transfer-protocol-http) sit on top of these. See the [communication](#communication) section for how TCP, UDP, [RPC and REST](#remote-procedure-call-rpc) fit together.

## What the model leaves out

Real TCP also does flow control, congestion control, fast retransmit and window scaling, which change the numbers a lot. The simulation keeps only what explains the trade-off: guaranteed ordered delivery costs waiting, and skipping the guarantee costs completeness.
