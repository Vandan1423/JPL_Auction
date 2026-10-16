import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
	incrementFor,
	nextBidAmount,
	validateBidAmount,
	minCostToFill,
	forcedReservations,
	maxBidFor,
	evaluateTeam,
	rolesStillNeeded,
} from '../services/bidRules.js';

const SLABS = [
	{ from: 0, step: 2000 },
	{ from: 50000, step: 5000 },
];

// Three categories, cheapest first: C ₹10k, B ₹30k, A ₹75k.
const TIERS = [
	{ id: 'C', price: 10000 },
	{ id: 'B', price: 30000 },
	{ id: 'A', price: 75000 },
];

const team = (id, overrides = {}) => ({
	id,
	remainingPurse: 1000000,
	playersCount: 0,
	categoryCounts: {},
	roleCounts: {},
	...overrides,
});

describe('increments', () => {
	test('picks the slab at or below the current bid', () => {
		assert.equal(incrementFor(SLABS, 10000), 2000);
		assert.equal(incrementFor(SLABS, 49999), 2000);
		assert.equal(incrementFor(SLABS, 50000), 5000);
		assert.equal(incrementFor(SLABS, 120000), 5000);
	});

	test('works with unsorted slabs and bids below the first slab', () => {
		const unsorted = [{ from: 50000, step: 5000 }, { from: 1000, step: 500 }];
		assert.equal(incrementFor(unsorted, 200), 500);
		assert.equal(incrementFor(unsorted, 60000), 5000);
	});

	test('falls back to 1 when no slabs are configured', () => {
		assert.equal(incrementFor([], 5000), 1);
	});
});

describe('opening bid equals the base price (regression)', () => {
	test('first bid on a ₹2,000 player is ₹2,000, not ₹2,000 + increment', () => {
		assert.equal(nextBidAmount({ basePrice: 2000, currentBid: 2000, hasBidder: false, slabs: SLABS }), 2000);
	});

	test('second bid adds the increment', () => {
		assert.equal(nextBidAmount({ basePrice: 2000, currentBid: 2000, hasBidder: true, slabs: SLABS }), 4000);
	});

	test('a custom opening bid at exactly the base price is accepted', () => {
		const check = validateBidAmount({ amount: 2000, basePrice: 2000, currentBid: 2000, hasBidder: false, slabs: SLABS });
		assert.equal(check.ok, true);
	});

	test('a custom bid below the base price is rejected', () => {
		const check = validateBidAmount({ amount: 1500, basePrice: 2000, currentBid: 2000, hasBidder: false, slabs: SLABS });
		assert.deepEqual(check, { ok: false, min: 2000, reason: 'below_min' });
	});

	test('a custom raise must clear the increment', () => {
		const tooLow = validateBidAmount({ amount: 3000, basePrice: 2000, currentBid: 2000, hasBidder: true, slabs: SLABS });
		assert.equal(tooLow.ok, false);
		assert.equal(tooLow.min, 4000);
		const enough = validateBidAmount({ amount: 9000, basePrice: 2000, currentBid: 2000, hasBidder: true, slabs: SLABS });
		assert.equal(enough.ok, true);
	});

	test('non-numeric amounts are invalid', () => {
		assert.equal(validateBidAmount({ amount: NaN, basePrice: 2000, currentBid: 0, hasBidder: false, slabs: SLABS }).reason, 'invalid');
	});
});

describe('minCostToFill', () => {
	test('fills from the cheapest category up', () => {
		assert.equal(minCostToFill(4, { C: 2, B: 5, A: 1 }, TIERS), 2 * 10000 + 2 * 30000);
	});

	test('prices a pool shortfall at the cheapest base price', () => {
		assert.equal(minCostToFill(3, { C: 1 }, TIERS), 3 * 10000);
	});

	test('respects a per-team category allowance', () => {
		assert.equal(minCostToFill(3, { C: 5, B: 5 }, TIERS, { C: 1 }), 10000 + 2 * 30000);
	});

	test('zero slots cost nothing', () => {
		assert.equal(minCostToFill(0, { C: 5 }, TIERS), 0);
	});
});

describe('forcedReservations', () => {
	test('a team with no spare money is forced into the cheapest players', () => {
		assert.deepEqual(forcedReservations(30000, 3, { C: 5, B: 5, A: 0 }, TIERS), { C: 3, B: 0, A: 0 });
	});

	test('a rich team is not forced to take cheap players', () => {
		const forced = forcedReservations(1000000, 3, { C: 5, B: 5, A: 0 }, TIERS);
		assert.equal(forced.C, 0);
	});

	test('upgrades never exceed the players available in the higher category', () => {
		const forced = forcedReservations(1000000, 3, { C: 5, B: 1, A: 0 }, TIERS);
		assert.deepEqual(forced, { C: 2, B: 1, A: 0 });
	});
});

describe('maxBidFor', () => {
	// Same scenario the original JPL rules were documented with:
	// 8 teams × 9 slots, ₹10,00,000 each, pool of 35 C / 57 B / 8 A.
	const squad = { min: 9, max: 9 };
	const pool = { C: 35, B: 57, A: 8 };
	const freshTeams = Array.from({ length: 8 }, (_, i) => team(`t${i}`));

	test('fresh auction: keep 8 × ₹10,000 back → max bid ₹9,20,000', () => {
		assert.equal(maxBidFor('t0', { tiers: TIERS, pool, teams: freshTeams, squad }), 920000);
	});

	test('after a big buy the buyer can only afford base-price players', () => {
		const teams = freshTeams.map((t) => (t.id === 't0' ? { ...t, remainingPurse: 80000, playersCount: 1 } : t));
		const ctx = { tiers: TIERS, pool: { C: 35, B: 56, A: 8 }, teams, squad };
		assert.equal(maxBidFor('t0', ctx), 80000 - 7 * 10000);
		assert.equal(maxBidFor('t1', ctx), 920000);
	});

	test('a playing owner already fills one slot', () => {
		const teams = freshTeams.map((t) => (t.id === 't0' ? { ...t, playersCount: 1 } : t));
		assert.equal(maxBidFor('t0', { tiers: TIERS, pool, teams, squad }), 1000000 - 7 * 10000);
	});

	test('the per-player cap is applied', () => {
		assert.equal(maxBidFor('t0', { tiers: TIERS, pool, teams: freshTeams, squad, maxBidPerPlayer: 200000 }), 200000);
	});

	test('when the minimum squad is reached the whole purse is available', () => {
		const teams = [team('t0', { playersCount: 11, remainingPurse: 50000 }), team('t1')];
		assert.equal(maxBidFor('t0', { tiers: TIERS, pool, teams, squad: { min: 11, max: 15 } }), 50000);
	});

	test('a full squad cannot bid at all', () => {
		const teams = [team('t0', { playersCount: 9 }), team('t1')];
		assert.equal(maxBidFor('t0', { tiers: TIERS, pool, teams, squad }), 0);
	});
});

describe('evaluateTeam', () => {
	const squad = { min: 9, max: 9 };
	const pool = { C: 35, B: 57, A: 8 };
	const base = { tiers: TIERS, pool, squad };

	test('squad full', () => {
		const ctx = { ...base, teams: [team('t0', { playersCount: 9 })] };
		assert.equal(evaluateTeam('t0', ctx, { player: { category: 'C' }, nextBid: 10000 }).reason, 'squad_full');
	});

	test('category limit reached', () => {
		const ctx = { ...base, teams: [team('t0', { playersCount: 1, categoryCounts: { A: 1 } })], categoryLimits: { A: 1 } };
		const verdict = evaluateTeam('t0', ctx, { player: { category: 'A' }, nextBid: 75000 });
		assert.deepEqual([verdict.canBid, verdict.reason], [false, 'category_limit']);
	});

	test('last slot must go to a required role', () => {
		const ctx = { ...base, teams: [team('t0', { playersCount: 8, roleCounts: { Batsman: 8 } })] };
		const roleRequirements = [{ role: 'Wicket-Keeper Batsman', min: 1 }];
		const batsman = evaluateTeam('t0', ctx, { player: { category: 'C', role: 'Batsman' }, nextBid: 10000, roleRequirements });
		assert.equal(batsman.reason, 'role_needed');
		const keeper = evaluateTeam('t0', ctx, { player: { category: 'C', role: 'Wicket-Keeper Batsman' }, nextBid: 10000, roleRequirements });
		assert.equal(keeper.canBid, true);
	});

	test('roles are not restricted while there are spare slots', () => {
		const t = team('t0', { playersCount: 2 });
		assert.deepEqual(rolesStillNeeded(t, 9, [{ role: 'Wicket-Keeper Batsman', min: 1 }]), []);
	});

	test('the leading bidder cannot raise its own bid', () => {
		const ctx = { ...base, teams: [team('t0'), team('t1')] };
		const verdict = evaluateTeam('t0', ctx, { player: { category: 'C' }, nextBid: 12000, currentBidderId: 't0' });
		assert.equal(verdict.reason, 'leading');
	});

	test('a bid above the max bid is blocked by purse protection', () => {
		const ctx = { ...base, teams: [team('t0', { remainingPurse: 90000 }), team('t1')] };
		const verdict = evaluateTeam('t0', ctx, { player: { category: 'C' }, nextBid: 20000 });
		assert.deepEqual([verdict.canBid, verdict.reason, verdict.maxBid], [false, 'purse', 10000]);
	});

	test('a healthy team can bid', () => {
		const ctx = { ...base, teams: [team('t0'), team('t1')] };
		assert.equal(evaluateTeam('t0', ctx, { player: { category: 'B' }, nextBid: 30000 }).canBid, true);
	});
});
