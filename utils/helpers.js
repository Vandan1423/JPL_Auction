import Player from '../models/Player.js';
import Team from '../models/Team.js';

// Category base prices
const CATEGORY_CONFIG = {
	A: { basePrice: 75000 },
	B: { basePrice: 30000 },
	C: { basePrice: 10000 },
};

const CATEGORY_BASE_PRICES = { A: 75000, B: 30000, C: 10000 };

// Categories sorted cheapest-first for tier allocation
const CATEGORIES_BY_PRICE = [
	{ category: 'C', price: 10000 },
	{ category: 'B', price: 30000 },
	{ category: 'A', price: 75000 },
];

// Teams must purchase exactly 9 players (captain is pre-assigned, not bought)
const PLAYERS_TO_BUY = 9;

/**
 * Returns the minimum bid increment for a category given the current bid amount.
 * A: ₹10,000 below ₹2,00,000 — ₹25,000 at or above ₹2,00,000
 * B: ₹5,000 below ₹1,00,000  — ₹10,000 at or above ₹1,00,000
 * C: ₹2,000 below ₹50,000    — ₹5,000 at or above ₹50,000
 */
export const getMinIncrement = (category, currentBid) => {
	switch (category) {
		case 'A':
			return currentBid >= 200000 ? 25000 : 10000;
		case 'B':
			return currentBid >= 100000 ? 10000 : 5000;
		case 'C':
			return currentBid >= 50000 ? 5000 : 2000;
		default:
			return 5000;
	}
};

// ============= RESERVATION-BASED BID CAP (PURSE PROTECTION) =============

/**
 * Get count of unsold players per category.
 * Optionally excludes a specific player (e.g., the one currently being auctioned).
 */
export const getUnsoldPoolCounts = async (excludePlayerId = null) => {
	const matchStage = { status: 'unsold' };
	if (excludePlayerId) {
		const mongoose = (await import('mongoose')).default;
		matchStage._id = { $ne: new mongoose.Types.ObjectId(String(excludePlayerId)) };
	}

	const result = await Player.aggregate([
		{ $match: matchStage },
		{ $group: { _id: '$category', count: { $sum: 1 } } },
	]);

	const counts = { A: 0, B: 0, C: 0 };
	result.forEach((r) => {
		if (counts[r._id] !== undefined) counts[r._id] = r.count;
	});
	return counts;
};

/**
 * Calculate the minimum cost to fill `slotsToFill` from the given pool,
 * greedily picking the cheapest available players first (C → B → A).
 *
 * @param {number} slotsToFill – number of players to buy
 * @param {Object} pool        – { A, B, C } available player counts
 * @returns {number} minimum cost
 */
export const calculateMinCostToFillSlots = (slotsToFill, pool) => {
	if (slotsToFill <= 0) return 0;

	let cost = 0;
	let slotsLeft = slotsToFill;

	for (const { category, price } of CATEGORIES_BY_PRICE) {
		if (slotsLeft <= 0) break;
		const take = Math.min(pool[category] || 0, slotsLeft);
		cost += take * price;
		slotsLeft -= take;
	}

	// If pool is exhausted but slots remain, price them at highest tier (A)
	if (slotsLeft > 0) {
		cost += slotsLeft * CATEGORY_BASE_PRICES.A;
	}

	return cost;
};

/**
 * Calculate how many players of each category a team is *forced* to buy
 * at minimum, given the available pool and its purse constraints.
 *
 * The team will fill slots cheapest-first. Then, for each ₹20k of surplus
 * above the minimum cost, it could "upgrade" one C→B slot (freeing a C player).
 * For each ₹45k of further surplus, it could upgrade one B→A slot.
 *
 * @param {number} remainingPurse – team's purse
 * @param {number} slotsNeeded    – remaining squad slots
 * @param {Object} pool           – { A, B, C } available player counts
 * @returns {Object} { C, B, A } forced reservation counts
 */
export const calculateForcedReservations = (remainingPurse, slotsNeeded, pool) => {
	const forced = { C: 0, B: 0, A: 0 };
	if (slotsNeeded <= 0) return forced;

	// Step 1 — greedily assign slots cheapest-first
	let slotsLeft = slotsNeeded;
	for (const { category } of CATEGORIES_BY_PRICE) {
		if (slotsLeft <= 0) break;
		const take = Math.min(pool[category] || 0, slotsLeft);
		forced[category] = take;
		slotsLeft -= take;
	}
	// If more slots than available players, extra goes to A (highest price)
	if (slotsLeft > 0) {
		forced.A += slotsLeft;
	}

	// Step 2 — calculate minimum cost with this assignment
	const minCost = forced.C * CATEGORY_BASE_PRICES.C
		+ forced.B * CATEGORY_BASE_PRICES.B
		+ forced.A * CATEGORY_BASE_PRICES.A;

	let surplus = Math.max(0, remainingPurse - minCost);

	// Step 3 — upgrade C→B slots (each upgrade costs ₹20,000 extra)
	const upgradeCostCtoB = CATEGORY_BASE_PRICES.B - CATEGORY_BASE_PRICES.C; // 20000
	while (surplus >= upgradeCostCtoB && forced.C > 0) {
		forced.C -= 1;
		forced.B += 1;
		surplus -= upgradeCostCtoB;
	}

	// Step 4 — upgrade B→A slots (each upgrade costs ₹45,000 extra)
	const upgradeCostBtoA = CATEGORY_BASE_PRICES.A - CATEGORY_BASE_PRICES.B; // 45000
	while (surplus >= upgradeCostBtoA && forced.B > 0) {
		forced.B -= 1;
		forced.A += 1;
		surplus -= upgradeCostBtoA;
	}

	return forced;
};

/**
 * Calculate maximum allowed bid for a team using reservation-based pool protection.
 *
 * Algorithm:
 *   1. For every OTHER team, compute forced reservations (most-constrained first).
 *      Subtract each team's forced players from the available pool.
 *   2. With the adjusted pool, compute the minimum cost for THIS team to fill
 *      its remaining (slotsToReserve = remainingSlots - 1) slots.
 *   3. maxBid = remainingPurse − minimumReserve
 *
 * Example – Fresh auction (8 teams × 9 slots, 35C/57B/8A players):
 *   Each team has ₹10,00,000 and 9 slots. For any team, 7 OTHER teams each
 *   need 9 slots. All have huge surplus → forced C = 0 for each → pool unchanged.
 *   This team reserves 8 slots at ₹10,000 each = ₹80,000 → maxBid = ₹9,20,000.
 *
 * After one team buys at ₹9,20,000 (purse=₹80,000, 8 slots left):
 *   That team's forced C = 8 → pool C drops by 8 (35→27) for the next team.
 *   Next team still has full purse, 8 reserve slots → cost from adjusted pool
 *   = 8 × ₹10,000 = ₹80,000 → maxBid = ₹9,20,000 (27 C still enough).
 *
 * @param {string|null} biddingTeamId   – _id of the team we're calculating for
 * @param {number} remainingPurse       – team's current purse
 * @param {number} playersCount         – players already purchased
 * @param {Object} unsoldCounts         – { A, B, C } unsold counts (excl. current player)
 * @param {Array}  allTeams             – all team documents (lean objects)
 */
export const calculateMaxBidWithContext = (biddingTeamId, remainingPurse, playersCount, unsoldCounts, allTeams) => {
	const remainingSlots = Math.max(PLAYERS_TO_BUY - playersCount, 0);
	if (remainingSlots <= 0) return 0;

	const slotsToReserve = remainingSlots - 1; // current bid fills one slot

	// Build list of other teams with their remaining slots and surplus
	const biddingTeamIdStr = biddingTeamId ? String(biddingTeamId) : null;
	const otherTeams = [];

	for (const t of allTeams) {
		if (biddingTeamIdStr && String(t._id) === biddingTeamIdStr) continue;
		const slots = Math.max(PLAYERS_TO_BUY - (t.playersCount ?? 0), 0);
		if (slots <= 0) continue;

		// Compute minimum cost for this team to fill all its slots from the FULL pool
		const minCost = calculateMinCostToFillSlots(slots, unsoldCounts);
		const surplus = Math.max(0, (t.remainingPurse ?? 0) - minCost);

		otherTeams.push({
			remainingPurse: t.remainingPurse ?? 0,
			slotsNeeded: slots,
			surplus,
		});
	}

	// Sort by ascending surplus — most constrained teams reserve first
	otherTeams.sort((a, b) => a.surplus - b.surplus);

	// Subtract each other team's forced reservations from the pool sequentially
	const adjustedPool = { A: unsoldCounts.A || 0, B: unsoldCounts.B || 0, C: unsoldCounts.C || 0 };

	for (const ot of otherTeams) {
		const forced = calculateForcedReservations(ot.remainingPurse, ot.slotsNeeded, adjustedPool);
		adjustedPool.C = Math.max(0, adjustedPool.C - forced.C);
		adjustedPool.B = Math.max(0, adjustedPool.B - forced.B);
		adjustedPool.A = Math.max(0, adjustedPool.A - forced.A);
	}

	// Compute minimum cost for THIS team to fill slotsToReserve from the adjusted pool
	const minimumReserve = calculateMinCostToFillSlots(slotsToReserve, adjustedPool);
	return Math.max(0, remainingPurse - minimumReserve);
};

/**
 * DB-querying version: calculate max bid for a team from just its ID.
 */
export const calculateMaxBid = async (teamId, excludePlayerId = null) => {
	const team = await Team.findById(teamId).lean();
	if (!team) return 0;

	const playersCount = team.playersCount ?? 0;
	if (Math.max(PLAYERS_TO_BUY - playersCount, 0) <= 0) return 0;

	const unsoldCounts = await getUnsoldPoolCounts(excludePlayerId);
	const allTeams = await Team.find().lean();

	return calculateMaxBidWithContext(team._id, team.remainingPurse, playersCount, unsoldCounts, allTeams);
};

/**
 * Simple version without pool awareness (backwards-compat fallback).
 */
export const calculateMaxBidDirect = (remainingPurse, playersCount) => {
	const playersNeeded = Math.max(PLAYERS_TO_BUY - playersCount, 0);
	if (playersNeeded <= 0) return 0;
	const reserveAmount = Math.max(playersNeeded - 1, 0) * CATEGORY_BASE_PRICES.C;
	return Math.max(remainingPurse - reserveAmount, 0);
};

/**
 * Check whether a team can place a specific bid amount.
 * Reservation-aware: considers other teams' forced purchases and available pool.
 *
 * @param {string} teamId          – bidding team
 * @param {number} bidAmount       – proposed bid
 * @param {string|null} currentPlayerId – player currently being auctioned (excluded from pool)
 */
export const canTeamBid = async (teamId, bidAmount, currentPlayerId = null) => {
	const team = await Team.findById(teamId).lean();
	if (!team) {
		return { canBid: false, reason: 'Team not found', maxBid: 0 };
	}

	if ((team.playersCount ?? 0) >= PLAYERS_TO_BUY) {
		return { canBid: false, reason: 'Team already has 9 players (squad full)', maxBid: 0 };
	}

	const unsoldCounts = await getUnsoldPoolCounts(currentPlayerId);
	const allTeams = await Team.find().lean();

	const maxBid = calculateMaxBidWithContext(
		team._id,
		team.remainingPurse,
		team.playersCount ?? 0,
		unsoldCounts,
		allTeams,
	);

	if (bidAmount <= maxBid) {
		return { canBid: true, maxBid };
	}

	return {
		canBid: false,
		reason: `Bid ₹${bidAmount.toLocaleString('en-IN')} exceeds max allowed ₹${maxBid.toLocaleString('en-IN')} (purse protection)`,
		maxBid,
	};
};

export const getCategoryConfig = (category) => CATEGORY_CONFIG[category] || null;


const VALID_PLAYER_TYPES = [
	'Batsman',
	'Bowler',
	'Batting All Rounder',
	'Bowling All Rounder',
	'Wicket Keeper Batsman',
];

export const validatePlayerData = (playerData = {}) => {
	const errors = [];
	const { name, phoneNumber, category, playerType, jerseySize } = playerData;

	if (!name) errors.push('Name is required');
	if (!phoneNumber) errors.push('Phone number is required');
	if (phoneNumber && !/^\d{10}$/.test(phoneNumber)) {
		errors.push('Phone number must be 10 digits');
	}
	if (!category) errors.push('Category is required');
	if (category && !['A', 'B', 'C'].includes(category)) {
		errors.push('Category must be A, B, or C');
	}
	if (!playerType) errors.push('Player type is required');
	if (playerType && !VALID_PLAYER_TYPES.includes(playerType)) {
		errors.push('Invalid player type selected');
	}
	if (!jerseySize) errors.push('Jersey size is required');
	if (jerseySize && !['S', 'M', 'L', 'XL', 'XXL', 'XXXL'].includes(jerseySize)) {
		errors.push('Invalid jersey size selected');
	}

	return { isValid: errors.length === 0, errors };
};

export const formatCurrency = (amount = 0) => {
	const formatter = new Intl.NumberFormat('en-IN', {
		style: 'currency',
		currency: 'INR',
		maximumFractionDigits: 0,
	});

	return formatter.format(amount);
};

export default {
	calculateMaxBid,
	calculateMaxBidDirect,
	calculateMaxBidWithContext,
	calculateMinCostToFillSlots,
	calculateForcedReservations,
	canTeamBid,
	getCategoryConfig,
	getMinIncrement,
	getUnsoldPoolCounts,
	validatePlayerData,
	formatCurrency,
};
