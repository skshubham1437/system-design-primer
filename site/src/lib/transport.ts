// TCP and UDP over a lossy link. A teaching model: it shows why TCP delivers everything in order (and
// can stall) while UDP delivers fast and leaves gaps. Time is in milliseconds; packets leave 10 ms apart.

import { mulberry32 } from './sim';

export interface Packet {
  n: number;
  lost: boolean;          // the first transmission was dropped
  sentAt: number;
  arrivedAt: number | null;   // when it reached the receiving machine (null: never)
  deliveredAt: number | null; // when the application could use it
  sends: number;          // transmissions needed (TCP retransmits)
}

export interface Result { packets: Packet[]; handshakeMs: number; doneAt: number; delivered: number; retransmits: number; maxStallMs: number }

const GAP = 10;

export type Protocol = 'tcp' | 'udp' | 'quic';
export const QUIC_STREAMS = 4;

/**
 * TCP: reliable, one ordered byte stream, so a loss holds back everything behind it.
 * UDP: no set-up, no retransmission, no order.
 * QUIC (the transport under HTTP/3): reliable like TCP, but each stream is ordered separately, so a loss only holds
 * back its own stream. Packet n belongs to stream n % QUIC_STREAMS here.
 */
export function simulate(protocol: Protocol, count: number, lossPct: number, rttMs: number, seed = 5): Result {
  const rnd = mulberry32(seed);
  const loss = lossPct / 100;
  const oneWay = rttMs / 2;
  const rto = rttMs * 2; // retransmission timeout
  // One round trip (SYN, SYN-ACK) before the client may send data along with its ACK. QUIC's handshake is also one
  // round trip, but that already includes TLS, which TCP needs extra round trips for (not modelled here).
  const handshakeMs = protocol === 'udp' ? 0 : rttMs;
  const packets: Packet[] = [];

  for (let n = 0; n < count; n++) {
    const sentAt = handshakeMs + n * GAP;
    const p: Packet = { n, lost: false, sentAt, arrivedAt: null, deliveredAt: null, sends: 1 };
    if (rnd() < loss) p.lost = true;
    if (protocol === 'udp') {
      p.arrivedAt = p.lost ? null : sentAt + oneWay;
    } else {
      // keep retransmitting until a copy gets through
      let t = sentAt;
      let dropped = p.lost;
      while (dropped) { t += rto; p.sends++; dropped = rnd() < loss; }
      p.arrivedAt = t + oneWay;
    }
    packets.push(p);
  }

  if (protocol === 'udp') {
    for (const p of packets) p.deliveredAt = p.arrivedAt; // the application takes whatever arrives
  } else if (protocol === 'tcp') {
    // in-order delivery: a packet is handed to the application only after every earlier one has arrived
    let high = 0;
    for (const p of packets) { high = Math.max(high, p.arrivedAt!); p.deliveredAt = high; }
  } else {
    // QUIC: in order within each stream only
    const high = new Array(QUIC_STREAMS).fill(0);
    for (const p of packets) { const st = p.n % QUIC_STREAMS; high[st] = Math.max(high[st], p.arrivedAt!); p.deliveredAt = high[st]; }
  }

  const delivered = packets.filter((p) => p.deliveredAt !== null).length;
  const doneAt = Math.max(...packets.map((p) => p.deliveredAt ?? p.sentAt + oneWay));
  const retransmits = packets.reduce((n, p) => n + (p.sends - 1), 0);
  const maxStallMs = Math.max(0, ...packets.map((p) => (p.deliveredAt === null ? 0 : p.deliveredAt - (p.arrivedAt ?? p.deliveredAt))));
  return { packets, handshakeMs, doneAt, delivered, retransmits, maxStallMs };
}
