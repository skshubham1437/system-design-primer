import { describe, expect, it } from 'vitest';
import { createTtl, lookupTtl, changeRecord, setTtl, passTime } from '../../src/lib/dns-ttl';

describe('DNS caching and TTL', () => {
  it('keeps serving the old address after a change until the cached TTL runs out', () => {
    let s = lookupTtl(createTtl(60)).state;
    s = changeRecord(s, '198.51.100.7');
    let r = lookupTtl(passTime(s, 30));
    expect(r).toMatchObject({ fromCache: true, stale: true, expiresIn: 30 });
    r = lookupTtl(passTime(r.state, 30));
    expect(r).toMatchObject({ fromCache: false, ip: '198.51.100.7' });
  });

  it('lowering the TTL only helps once the old, long TTL has expired from caches', () => {
    let s = lookupTtl(createTtl(1440)).state;   // cached for a day
    s = setTtl(s, 5);                           // lowered too late
    s = changeRecord(s, '198.51.100.7');
    expect(lookupTtl(passTime(s, 60)).stale).toBe(true);
  });

  it('lowering it a day ahead makes the switch take minutes', () => {
    let s = setTtl(createTtl(1440), 5);
    s = lookupTtl(passTime(s, 1440)).state;     // caches now hold the 5-minute TTL
    s = changeRecord(s, '198.51.100.7');
    expect(lookupTtl(passTime(s, 5)).ip).toBe('198.51.100.7');
  });
});
