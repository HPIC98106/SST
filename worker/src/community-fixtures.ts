/**
 * Invented gift and member records for the Membership tab in fixture mode.
 *
 * Generated rather than recorded, from a fixed seed so every run is the same.
 * The shape follows HPIC's pattern: membership dues from spring to autumn,
 * peaking in September; the Annual Fund Drive landing in December; most
 * members renewing and a crop of new ones; grant awards and payments that must
 * stay out of supporter counts. No figure here is HPIC's.
 */

import type { LglMember } from "./community";
import type { LglGift } from "./lgl";

/** The fixture's "now": mid-October 2026, as LGL would stamp it. */
export const COMMUNITY_FIXTURE_DATE = "Wed, 14 Oct 2026 16:00:00 GMT";

/**
 * Invented active members, in HPIC's shape: about twice as many as pay dues,
 * because a household's other members are credited on the one payment.
 */
export function communityFixtureMembers(): LglMember[] {
  const member = (id: number, level: string, start: string): LglMember => ({
    id,
    memberships: [{ membership_level_name: level, date_start: start, finish_date: `${Number(start.slice(0, 4)) + 1}${start.slice(4)}` }],
  });
  return [
    ...Array.from({ length: 240 }, (_, i) => member(5000 + i, "Classic", "2025-06-01")),
    ...Array.from({ length: 80 }, (_, i) => member(6000 + i, "Champion", "2025-09-01")),
    ...Array.from({ length: 130 }, (_, i) => member(6500 + i, "Classic", "2026-05-01")),
    ...Array.from({ length: 40 }, (_, i) => member(7000 + i, "Minor", "2026-05-01")),
  ];
}

/** Small deterministic generator (mulberry32). */
function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dues by month: quiet in winter, building through summer, peaking in September. */
const DUES_WEIGHTS = [1, 1, 5, 5, 9, 12, 9, 10, 20, 8, 2, 1];

export function communityFixtureGifts(): LglGift[] {
  const rand = random(1919);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const gifts: LglGift[] = [];
  let id = 900000;

  const weightedMonth = (weights: number[], lastMonth = 11) => {
    const usable = weights.slice(0, lastMonth + 1);
    let r = rand() * usable.reduce((a, b) => a + b, 0);
    for (let i = 0; i < usable.length; i++) if ((r -= usable[i]) < 0) return i;
    return usable.length - 1;
  };
  const date = (year: number, month0: number, maxDay = 28) =>
    `${year}-${String(month0 + 1).padStart(2, "0")}-${String(1 + Math.floor(rand() * maxDay)).padStart(2, "0")}`;
  const gift = (fields: Partial<LglGift>): void => {
    gifts.push({ id: id++, gift_type_name: "Gift", gift_type_id: 1, ...fields } as LglGift);
  };

  const DUES = [20, 40, 40, 100, 100, 200];
  const members2025 = Array.from({ length: 190 }, (_, i) => 5000 + i);
  for (const person of members2025) {
    gift({ constituent_id: person, campaign_id: 846, campaign_name: "Memberships", received_amount: pick(DUES), received_date: date(2025, weightedMonth(DUES_WEIGHTS)) });
  }
  // About four in five renew by mid-October, and a hundred new members join.
  const renewing = members2025.filter(() => rand() < 0.8);
  const newcomers = Array.from({ length: 105 }, (_, i) => 6000 + i);
  for (const person of [...renewing, ...newcomers]) {
    const month = weightedMonth(DUES_WEIGHTS, 9);
    gift({
      constituent_id: person,
      campaign_id: 846,
      campaign_name: "Memberships",
      received_amount: pick(DUES),
      received_date: date(2026, month, month === 9 ? 13 : 28),
    });
  }

  // The Annual Fund Drive: December last year, and an early start this autumn.
  for (let i = 0; i < 58; i++) {
    gift({ constituent_id: pick(members2025), campaign_id: 872, campaign_name: "Annual Fund Drive", received_amount: pick([50, 100, 250, 500]), received_date: date(2025, 11) });
  }
  for (let i = 0; i < 4; i++) {
    gift({ constituent_id: pick(renewing), campaign_id: 872, campaign_name: "Annual Fund Drive", received_amount: pick([100, 250, 500]), received_date: date(2026, 8 + (i % 2), 13) });
  }

  // Everyday giving through the year.
  for (const year of [2025, 2026]) {
    const lastMonth = year === 2026 ? 9 : 11;
    for (let i = 0; i < 70; i++) {
      const month = Math.floor(rand() * (lastMonth + 1));
      gift({
        constituent_id: 7000 + Math.floor(rand() * 120),
        campaign_id: pick([882, 851, 841]),
        campaign_name: pick(["Individual Giving", "Building Boosters", "Programs"]),
        received_amount: pick([25, 50, 100, 150]),
        received_date: date(year, month, month === 9 && year === 2026 ? 13 : 28),
      });
    }
  }
  gift({ constituent_id: 8001, campaign_id: 887, campaign_name: "Pot Auction", received_amount: 4200, received_date: "2026-04-18" });
  gift({ constituent_id: 8002, campaign_id: 877, campaign_name: "Sponsorships", received_amount: 1000, received_date: "2026-05-02" });

  // Grants: awards (pledges) and payments, which must not count as donors.
  const award = (campaign: [number, string], amount: number, received_date: string, payments: [number, string][]) => {
    const awardId = id;
    gift({ gift_type_name: "Pledge", gift_type_id: 7, gift_category_id: 6031, campaign_id: campaign[0], campaign_name: campaign[1], constituent_id: 9100 + awardId % 50, received_amount: amount, received_date });
    for (const [paid, on] of payments) {
      gift({ gift_category_id: 6076, campaign_id: campaign[0], campaign_name: campaign[1], constituent_id: 9100 + awardId % 50, parent_gift_id: awardId, received_amount: paid, received_date: on });
    }
  };
  award([841, "Programs"], 15000, "2026-02-10", [[7500, "2026-03-15"]]);
  award([841, "Programs"], 8000, "2026-05-01", []);
  award([841, "Programs"], 6000, "2025-06-01", [[6000, "2025-07-20"]]);
  award([871, "Rebuild Project"], 250000, "2025-09-01", [[100000, "2026-02-01"]]);

  // Records that are not money: a soft credit and an in-kind gift.
  gift({ gift_type_name: "Soft Credit", gift_type_id: 9, constituent_id: 5001, campaign_id: 846, campaign_name: "Memberships", received_amount: 100, received_date: "2026-06-01" });
  gift({ gift_type_name: "In Kind", gift_type_id: 8, constituent_id: 8003, campaign_id: 841, campaign_name: "Programs", received_amount: 500, received_date: "2026-06-01" });

  return gifts;
}
