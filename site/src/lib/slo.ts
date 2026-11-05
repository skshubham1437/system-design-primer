// The arithmetic behind the numbers on the observability page, so the page's claims can be tested.

const DAY_MINUTES = 24 * 60;

/** Minutes of complete failure an availability target allows over a window of days. */
export const budgetMinutes = (target: number, days = 30) => (1 - target) * days * DAY_MINUTES;

/** How long the whole budget lasts at a given burn rate. Burn rate 1 uses it up in exactly the window. */
export const hoursToExhaust = (burnRate: number, days = 30) => (days * 24) / burnRate;

/** The share of a window's budget spent by burning at this rate for this many hours. */
export const budgetSpent = (burnRate: number, hours: number, days = 30) => (burnRate * hours) / (days * 24);

/** The error rate at a burn rate: burn rate 1 is exactly the budget. */
export const errorRateAt = (burnRate: number, target: number) => burnRate * (1 - target);

/** The share of requests that hit at least one slow server when each of `servers` is slow with probability `slowShare`. */
export const fanOutSlowShare = (slowShare: number, servers: number) => 1 - (1 - slowShare) ** servers;

/** One time series per combination of label values. */
export const seriesCount = (...labelValues: number[]) => labelValues.reduce((a, b) => a * b, 1);

/** The average when one share of requests takes `slowMs` and the rest take `fastMs`. */
export const averageOf = (slowShare: number, slowMs: number, fastMs: number) => slowShare * slowMs + (1 - slowShare) * fastMs;
