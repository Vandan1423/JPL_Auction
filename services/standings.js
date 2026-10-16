import mongoose from 'mongoose';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import { POOL_STATUSES } from '../config/constants.js';
import { evaluateTeam, nextBidAmount } from './bidRules.js';

const toId = (value) => (value ? String(value) : null);

export const basePriceOf = (tournament, player) => tournament.getCategory(player?.category)?.basePrice ?? 0;

/**
 * Teams with squad numbers derived from their sold players (playing owners
 * included): playersCount, spent, remainingPurse, slotsLeft and per-category
 * and per-role counts.
 */
export async function getTeamStats(tournament) {
	const [teams, soldRows] = await Promise.all([
		Team.find({ tournament: tournament._id }).sort('order').lean(),
		Player.aggregate([
			{ $match: { tournament: tournament._id, status: 'sold' } },
			{
				$group: {
					_id: { team: '$soldTo', category: '$category', role: '$role' },
					count: { $sum: 1 },
					spent: { $sum: '$soldPrice' },
				},
			},
		]),
	]);

	const stats = new Map(
		teams.map((t) => [String(t._id), { playersCount: 0, spent: 0, categoryCounts: {}, roleCounts: {} }])
	);
	for (const row of soldRows) {
		const s = stats.get(toId(row._id.team));
		if (!s) continue;
		s.playersCount += row.count;
		s.spent += row.spent;
		const categoryId = toId(row._id.category);
		if (categoryId) s.categoryCounts[categoryId] = (s.categoryCounts[categoryId] || 0) + row.count;
		if (row._id.role) s.roleCounts[row._id.role] = (s.roleCounts[row._id.role] || 0) + row.count;
	}

	return teams.map((team) => {
		const s = stats.get(String(team._id));
		return {
			...team,
			...s,
			remainingPurse: tournament.purse - s.spent,
			slotsLeft: Math.max(0, tournament.squad.max - s.playersCount),
		};
	});
}

/** Players still in the auction pool, counted per category. */
export async function getPoolCounts(tournament, excludePlayerId = null) {
	const match = { tournament: tournament._id, isOwner: false, status: { $in: POOL_STATUSES } };
	if (excludePlayerId) match._id = { $ne: new mongoose.Types.ObjectId(String(excludePlayerId)) };

	const rows = await Player.aggregate([{ $match: match }, { $group: { _id: '$category', count: { $sum: 1 } } }]);
	return Object.fromEntries(rows.filter((r) => r._id).map((r) => [String(r._id), r.count]));
}

/** Plain-object context for services/bidRules.js. */
export function rulesContext(tournament, teamStats, pool) {
	return {
		tiers: tournament.categoriesByPrice().map((c) => ({ id: String(c._id), price: c.basePrice })),
		pool,
		teams: teamStats.map((t) => ({
			id: String(t._id),
			remainingPurse: t.remainingPurse,
			playersCount: t.playersCount,
			categoryCounts: t.categoryCounts,
			roleCounts: t.roleCounts,
		})),
		squad: { min: tournament.squad.min, max: tournament.squad.max },
		categoryLimits: Object.fromEntries(
			tournament.categories
				.filter((c) => c.maxPerTeam !== null && c.maxPerTeam !== undefined)
				.map((c) => [String(c._id), c.maxPerTeam])
		),
		maxBidPerPlayer: tournament.maxBidPerPlayer || null,
	};
}

/**
 * Every team with its bidding verdict for the player under the hammer (or
 * just max bids when no player is selected), plus the next valid bid amount.
 */
export async function getBiddingBoard(tournament, { auctionState = null, player = null } = {}) {
	const [teamStats, pool] = await Promise.all([
		getTeamStats(tournament),
		getPoolCounts(tournament, player?._id),
	]);
	const ctx = rulesContext(tournament, teamStats, pool);

	let nextBid = 0;
	if (player) {
		const basePrice = basePriceOf(tournament, player);
		nextBid = nextBidAmount({
			basePrice,
			currentBid: auctionState?.currentBid || basePrice,
			hasBidder: Boolean(auctionState?.currentBidder),
			slabs: tournament.incrementsFor(player.category),
		});
	}

	const playerInfo = player ? { category: toId(player.category), role: player.role } : null;
	const teams = teamStats.map((team) => {
		const verdict = evaluateTeam(String(team._id), ctx, {
			player: playerInfo,
			nextBid,
			currentBidderId: toId(auctionState?.currentBidder),
			roleRequirements: tournament.roleRequirements,
		});
		return {
			...team,
			maxBidAllowed: verdict.maxBid,
			canBid: verdict.canBid,
			blockReason: verdict.reason,
			rolesNeeded: verdict.rolesNeeded,
		};
	});

	return { teams, nextBid };
}

/** Player counts by status (owners excluded). */
export async function getPlayerCounts(tournament) {
	const rows = await Player.aggregate([
		{ $match: { tournament: tournament._id, isOwner: false } },
		{ $group: { _id: '$status', count: { $sum: 1 } } },
	]);
	const counts = { available: 0, unsold: 0, sold: 0, withdrawn: 0 };
	rows.forEach((r) => {
		counts[r._id] = r.count;
	});
	counts.total = counts.available + counts.unsold + counts.sold + counts.withdrawn;
	counts.pool = counts.available + counts.unsold;
	return counts;
}
