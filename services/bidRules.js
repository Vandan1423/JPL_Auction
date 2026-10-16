// Pure bidding rules: no database access, so everything here is unit tested
// (see test/bidRules.test.js). The auction service feeds these functions plain
// objects built from the Tournament, Team and Player documents.

/**
 * @typedef {{ id: string, price: number }} Tier   a category, cheapest first
 * @typedef {Object<string, number>} Counts        counts keyed by category id
 * @typedef {{
 *   id: string,
 *   remainingPurse: number,
 *   playersCount: number,
 *   categoryCounts?: Counts,
 *   roleCounts?: Object<string, number>,
 * }} TeamState
 */

// ───────────────────────────── Increments ─────────────────────────────

/**
 * Raise required on top of `currentBid`: the step of the highest slab whose
 * `from` is at or below the current bid.
 */
export function incrementFor(slabs, currentBid) {
	const sorted = [...(slabs || [])].sort((a, b) => a.from - b.from);
	if (sorted.length === 0) return 1;

	let step = sorted[0].step;
	for (const slab of sorted) {
		if (currentBid >= slab.from) step = slab.step;
	}
	return step;
}

/**
 * Smallest amount the next bid may be. The opening bid is exactly the base
 * price; only from the second bid onwards is the slab increment added.
 */
export function nextBidAmount({ basePrice, currentBid, hasBidder, slabs }) {
	if (!hasBidder) return basePrice;
	return currentBid + incrementFor(slabs, currentBid);
}

/**
 * Check a custom bid typed in by the auctioneer.
 * @returns {{ ok: boolean, min: number, reason?: 'invalid' | 'below_min' }}
 */
export function validateBidAmount({ amount, basePrice, currentBid, hasBidder, slabs }) {
	const min = nextBidAmount({ basePrice, currentBid, hasBidder, slabs });
	if (!Number.isFinite(amount) || amount <= 0) return { ok: false, min, reason: 'invalid' };
	if (amount < min) return { ok: false, min, reason: 'below_min' };
	return { ok: true, min };
}

// ──────────────────────── Purse protection (reserve) ────────────────────────
//
// A team may never bid so much that it can no longer complete its minimum
// squad. "Complete" is priced realistically: the cheapest players still in the
// pool, after setting aside the cheap players that cash-strapped rival teams
// will be forced to take.

const allowanceOf = (allowance, id) => allowance?.[id] ?? Infinity;

/**
 * Cheapest way to buy `slots` players from `pool`, filling from the cheapest
 * category upward. If the pool runs out, the remaining slots are priced at the
 * cheapest base price (more players may still be registered).
 */
export function minCostToFill(slots, pool, tiers, allowance = {}) {
	if (slots <= 0 || tiers.length === 0) return 0;

	let cost = 0;
	let left = slots;
	for (const tier of tiers) {
		if (left <= 0) break;
		const take = Math.min(pool[tier.id] || 0, allowanceOf(allowance, tier.id), left);
		cost += take * tier.price;
		left -= take;
	}
	if (left > 0) cost += left * tiers[0].price;
	return cost;
}

/**
 * How many players of each category a team must take to complete `slots`
 * given its purse. A team with spare money is not forced into the cheapest
 * tier: each affordable upgrade moves one slot up a category, which leaves the
 * cheap players available for others.
 */
export function forcedReservations(purse, slots, pool, tiers, allowance = {}) {
	const forced = Object.fromEntries(tiers.map((t) => [t.id, 0]));
	if (slots <= 0 || tiers.length === 0) return forced;

	let left = slots;
	for (const tier of tiers) {
		if (left <= 0) break;
		const take = Math.min(pool[tier.id] || 0, allowanceOf(allowance, tier.id), left);
		forced[tier.id] = take;
		left -= take;
	}

	let surplus = Math.max(0, purse - minCostToFill(slots, pool, tiers, allowance));

	for (let i = 0; i < tiers.length - 1; i++) {
		const from = tiers[i];
		const to = tiers[i + 1];
		const diff = to.price - from.price;
		const room = Math.min(
			(pool[to.id] || 0) - forced[to.id],
			allowanceOf(allowance, to.id) - forced[to.id]
		);
		const affordable = diff > 0 ? Math.floor(surplus / diff) : Infinity;
		const moves = Math.min(forced[from.id], room, affordable);
		if (moves <= 0) continue;

		forced[from.id] -= moves;
		forced[to.id] += moves;
		surplus -= moves * Math.max(diff, 0);
	}

	return forced;
}

/** Remaining buys allowed per limited category for a team. */
export function categoryAllowance(team, categoryLimits = {}) {
	const allowance = {};
	for (const [categoryId, limit] of Object.entries(categoryLimits)) {
		if (limit === null || limit === undefined) continue;
		allowance[categoryId] = Math.max(0, limit - (team.categoryCounts?.[categoryId] || 0));
	}
	return allowance;
}

/**
 * Highest amount `teamId` may bid for `player` (or for "a player" when none is
 * selected) without endangering its minimum squad.
 *
 * @param {string} teamId
 * @param {{
 *   tiers: Tier[],
 *   pool: Counts,
 *   teams: TeamState[],
 *   squad: { min: number, max: number },
 *   categoryLimits?: Counts,
 *   maxBidPerPlayer?: number | null,
 * }} ctx
 * @param {{ category: string } | null} player
 */
export function maxBidFor(teamId, ctx, player = null) {
	const team = ctx.teams.find((t) => t.id === String(teamId));
	if (!team) return 0;

	const openSlots = ctx.squad.max - team.playersCount;
	if (openSlots <= 0) return 0;

	const myAllowance = categoryAllowance(team, ctx.categoryLimits);
	if (player?.category && allowanceOf(myAllowance, player.category) <= 0) return 0;
	if (player?.category && myAllowance[player.category] !== undefined) {
		myAllowance[player.category] -= 1; // buying this player uses one of the allowance
	}

	// Rival teams that still need players reserve what they are forced to take,
	// most cash-strapped first.
	const rivals = ctx.teams
		.filter((t) => t.id !== team.id)
		.map((t) => {
			const need = Math.max(0, ctx.squad.min - t.playersCount);
			const allowance = categoryAllowance(t, ctx.categoryLimits);
			const surplus = t.remainingPurse - minCostToFill(need, ctx.pool, ctx.tiers, allowance);
			return { ...t, need, allowance, surplus };
		})
		.filter((t) => t.need > 0)
		.sort((a, b) => a.surplus - b.surplus);

	const adjustedPool = { ...ctx.pool };
	for (const rival of rivals) {
		const forced = forcedReservations(rival.remainingPurse, rival.need, adjustedPool, ctx.tiers, rival.allowance);
		for (const [categoryId, count] of Object.entries(forced)) {
			adjustedPool[categoryId] = Math.max(0, (adjustedPool[categoryId] || 0) - count);
		}
	}

	// Buying this player fills one slot; reserve enough for the rest of the minimum squad.
	const slotsToReserve = Math.max(0, ctx.squad.min - team.playersCount - 1);
	const reserve = minCostToFill(slotsToReserve, adjustedPool, ctx.tiers, myAllowance);

	let maxBid = Math.max(0, team.remainingPurse - reserve);
	if (ctx.maxBidPerPlayer) maxBid = Math.min(maxBid, ctx.maxBidPerPlayer);
	return maxBid;
}

/**
 * Roles a team still has to fill, when its open slots are no more than the
 * number of role slots still missing. Returns [] when the team is free to buy
 * any role.
 */
export function rolesStillNeeded(team, squadMax, roleRequirements = []) {
	const missing = roleRequirements
		.map((r) => ({ role: r.role, short: r.min - (team.roleCounts?.[r.role] || 0) }))
		.filter((r) => r.short > 0);
	const missingSlots = missing.reduce((sum, r) => sum + r.short, 0);
	const openSlots = squadMax - team.playersCount;
	return missingSlots > 0 && missingSlots >= openSlots ? missing.map((r) => r.role) : [];
}

/**
 * Everything the control panel needs to know about one team for the player
 * under the hammer.
 *
 * @returns {{
 *   canBid: boolean,
 *   maxBid: number,
 *   reason: null | 'squad_full' | 'category_limit' | 'role_needed' | 'leading' | 'purse',
 *   rolesNeeded: string[],
 * }}
 */
export function evaluateTeam(teamId, ctx, { player = null, nextBid = 0, currentBidderId = null, roleRequirements = [] } = {}) {
	const team = ctx.teams.find((t) => t.id === String(teamId));
	const result = { canBid: false, maxBid: 0, reason: null, rolesNeeded: [] };
	if (!team) return result;

	result.maxBid = maxBidFor(teamId, ctx, player);

	if (ctx.squad.max - team.playersCount <= 0) return { ...result, reason: 'squad_full' };
	if (!player) return { ...result, canBid: false };

	const allowance = categoryAllowance(team, ctx.categoryLimits);
	if (player.category && allowanceOf(allowance, player.category) <= 0) {
		return { ...result, reason: 'category_limit' };
	}

	const rolesNeeded = rolesStillNeeded(team, ctx.squad.max, roleRequirements);
	if (rolesNeeded.length && !rolesNeeded.includes(player.role)) {
		return { ...result, reason: 'role_needed', rolesNeeded };
	}

	if (currentBidderId && String(currentBidderId) === team.id) {
		return { ...result, reason: 'leading' };
	}

	if (result.maxBid < nextBid) return { ...result, reason: 'purse' };

	return { ...result, canBid: true };
}
