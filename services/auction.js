import mongoose from 'mongoose';
import AuctionState from '../models/AuctionState.js';
import Player from '../models/Player.js';
import Team from '../models/Team.js';
import { POOL_STATUSES } from '../config/constants.js';
import { validateBidAmount } from './bidRules.js';
import { basePriceOf, getBiddingBoard, getPlayerCounts } from './standings.js';
import { imageUrl } from './cloudinary.js';
import { BLOCK_REASONS, formatMoney } from '../utils/format.js';
import logger from '../utils/logger.js';

/** Socket.IO room for one tournament's live auction. */
export const roomFor = (tournamentId) => `tournament:${tournamentId}`;

/** An expected, user-facing failure (shown as a toast, not logged as a crash). */
export class AuctionError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
		this.expected = true;
	}
}

export async function getAuctionState(tournamentId) {
	return AuctionState.findOneAndUpdate(
		{ tournament: tournamentId },
		{ $setOnInsert: { tournament: tournamentId } },
		{ upsert: true, new: true }
	);
}

/**
 * Atomically replace the live state, but only if nobody changed it since we
 * read it (compare-and-swap on the version key). Returns false on a clash.
 */
async function swapState(state, changes) {
	const updated = await AuctionState.findOneAndUpdate(
		{ _id: state._id, __v: state.__v },
		{ ...changes, $inc: { __v: 1, ...(changes.$inc || {}) } },
		{ new: true }
	);
	return Boolean(updated);
}

const CLEARED = {
	currentPlayer: null,
	currentBid: 0,
	currentBidder: null,
	isActive: false,
	bidHistory: [],
};

// ───────────────────────── Client payloads ─────────────────────────

export function publicPlayer(tournament, player) {
	if (!player) return null;
	const category = tournament.getCategory(player.category);
	return {
		_id: player._id,
		name: player.name,
		playerNumber: player.playerNumber,
		role: player.role,
		age: player.age,
		jerseyNumber: player.jerseyNumber,
		status: player.status,
		timesUnsold: player.timesUnsold || 0,
		category: category
			? { _id: category._id, name: category.name, color: category.color, basePrice: category.basePrice }
			: null,
		basePrice: category?.basePrice ?? 0,
		photo: imageUrl(player.photo, 'card'),
		photoThumb: imageUrl(player.photo, 'thumb'),
	};
}

export function publicTeam(team) {
	return {
		_id: team._id,
		order: team.order,
		name: team.name,
		shortName: team.shortName,
		color: team.color,
		logo: imageUrl(team.logo, 'logo'),
		logoSmall: imageUrl(team.logo, 'logoSm'),
		ownerName: team.owner?.name || '',
		remainingPurse: team.remainingPurse,
		spent: team.spent,
		playersCount: team.playersCount,
		slotsLeft: team.slotsLeft,
		maxBidAllowed: team.maxBidAllowed,
		canBid: team.canBid,
		blockReason: team.blockReason,
		blockLabel: team.blockReason ? BLOCK_REASONS[team.blockReason] : '',
		rolesNeeded: team.rolesNeeded || [],
	};
}

/**
 * Everything a control panel or display screen needs to render the live
 * auction. Every socket event carries one of these, so clients have a single
 * render path and can never drift out of sync.
 */
export async function getSnapshot(tournament) {
	const state = await getAuctionState(tournament._id);
	let player = state.currentPlayer ? await Player.findById(state.currentPlayer).lean() : null;

	if (state.currentPlayer && (!player || !POOL_STATUSES.includes(player.status))) {
		// The player was deleted or changed elsewhere; drop the stale selection.
		await swapState(state, { $set: CLEARED });
		state.set(CLEARED);
		player = null;
	}

	const [board, counts, recent] = await Promise.all([
		getBiddingBoard(tournament, { auctionState: state, player }),
		getPlayerCounts(tournament),
		Player.find({ tournament: tournament._id, isOwner: false, status: 'sold' })
			.sort({ soldAt: -1 })
			.limit(8)
			.populate('soldTo', 'name color')
			.lean(),
	]);
	const teams = board.teams.map(publicTeam);
	const currentBidder = state.currentBidder
		? teams.find((t) => String(t._id) === String(state.currentBidder)) || null
		: null;

	return {
		auction: {
			isActive: state.isActive && Boolean(player),
			currentBid: state.currentBid,
			nextBid: board.nextBid,
			roundNumber: state.roundNumber,
			currentBidder,
			bidHistory: [...(state.bidHistory || [])].reverse().slice(0, 30),
		},
		player: publicPlayer(tournament, player),
		teams,
		counts,
		squad: { min: tournament.squad.min, max: tournament.squad.max },
		// Same shape as a socket event (minus the snapshot) for polling screens.
		lastEvent: state.lastEvent?.id
			? { id: state.lastEvent.id, type: state.lastEvent.type, ...(state.lastEvent.details || {}) }
			: null,
		recentSales: recent.map((p) => ({
			playerId: p._id,
			playerName: p.name,
			photoThumb: imageUrl(p.photo, 'thumb'),
			teamName: p.soldTo?.name || '',
			teamColor: p.soldTo?.color || '',
			price: p.soldPrice,
		})),
	};
}

// ───────────────────────── Operations ─────────────────────────

const loadPoolPlayer = async (tournament, playerId) => {
	if (!mongoose.isValidObjectId(playerId)) throw new AuctionError('Player not found', 404);
	const player = await Player.findOne({ _id: playerId, tournament: tournament._id, isOwner: false });
	if (!player) throw new AuctionError('Player not found', 404);
	if (!POOL_STATUSES.includes(player.status)) throw new AuctionError(`${player.name} is not available for auction`);
	if (!tournament.getCategory(player.category)) {
		throw new AuctionError(`${player.name} has no category. Edit the player and pick one first.`);
	}
	return player;
};

/** Put a player under the hammer. Opening bid = base price, no bidder yet. */
export async function startPlayer(tournament, playerId) {
	const state = await getAuctionState(tournament._id);
	const alreadyUp = state.isActive && String(state.currentPlayer) === String(playerId);
	if (state.isActive && state.currentBidder && !alreadyUp) {
		throw new AuctionError('The current player already has bids. Mark them SOLD or UNSOLD first.');
	}

	const player = await loadPoolPlayer(tournament, playerId);
	if (alreadyUp) return { player }; // re-selecting must not wipe the bids
	const basePrice = basePriceOf(tournament, player);

	const ok = await swapState(state, {
		$set: {
			currentPlayer: player._id,
			currentBid: basePrice,
			currentBidder: null,
			isActive: true,
			lastBidTime: new Date(),
			bidHistory: [],
		},
	});
	if (!ok) throw new AuctionError('The auction changed at the same moment. Please try again.', 409);

	logger.auction('Player up', { tournament: tournament.name, player: player.name, basePrice });
	return { player };
}

/** Pick the next player in queue order (or at random), optionally within one category. */
export async function startNextPlayer(tournament, { random = false, categoryId = null } = {}) {
	const filter = { tournament: tournament._id, isOwner: false, status: { $in: POOL_STATUSES } };
	if (categoryId && mongoose.isValidObjectId(categoryId)) filter.category = categoryId;

	let next;
	if (random) {
		const [sample] = await Player.aggregate([{ $match: filter }, { $sample: { size: 1 } }]);
		next = sample;
	} else {
		next = await Player.findOne(filter).sort({ auctionOrder: 1, playerNumber: 1 }).lean();
	}
	if (!next) throw new AuctionError('No players left in the auction pool' + (categoryId ? ' for this category' : ''));
	return startPlayer(tournament, next._id);
}

/**
 * Place a bid. Without `amount` the bid is the next valid amount: the base
 * price for the opening bid, then current bid + slab increment.
 */
export async function placeBid(tournament, teamId, amount = null) {
	const state = await getAuctionState(tournament._id);
	if (!state.isActive || !state.currentPlayer) throw new AuctionError('No player is up for auction');
	if (!mongoose.isValidObjectId(teamId)) throw new AuctionError('Team not found', 404);

	const [player, team] = await Promise.all([
		Player.findById(state.currentPlayer).lean(),
		Team.findOne({ _id: teamId, tournament: tournament._id }).lean(),
	]);
	if (!player) throw new AuctionError('Current player not found', 404);
	if (!team) throw new AuctionError('Team not found', 404);

	const board = await getBiddingBoard(tournament, { auctionState: state, player });
	const entry = board.teams.find((t) => String(t._id) === String(team._id));
	const currency = tournament.currency;

	let bid = board.nextBid;
	if (amount !== null && amount !== undefined && amount !== '') {
		const check = validateBidAmount({
			amount: Number(amount),
			basePrice: basePriceOf(tournament, player),
			currentBid: state.currentBid,
			hasBidder: Boolean(state.currentBidder),
			slabs: tournament.incrementsFor(player.category),
		});
		if (!check.ok) {
			throw new AuctionError(
				check.reason === 'invalid'
					? 'Enter a valid bid amount'
					: state.currentBidder
						? `Bid must be at least ${formatMoney(check.min, currency)}`
						: `Opening bid must be at least the base price, ${formatMoney(check.min, currency)}`
			);
		}
		bid = Number(amount);
	}

	if (!entry.canBid && entry.blockReason === 'leading') {
		throw new AuctionError(`${team.name} is already the highest bidder`);
	}
	if (!entry.canBid && entry.blockReason !== 'purse') {
		const detail =
			entry.blockReason === 'role_needed' ? ` (${entry.rolesNeeded.join(' or ')})` : '';
		throw new AuctionError(`${team.name}: ${BLOCK_REASONS[entry.blockReason]}${detail}`);
	}
	if (bid > entry.maxBidAllowed) {
		throw new AuctionError(
			`${team.name} can bid at most ${formatMoney(entry.maxBidAllowed, currency)} so it can still complete its squad`
		);
	}

	const ok = await swapState(state, {
		$set: { currentBid: bid, currentBidder: team._id, lastBidTime: new Date() },
		$push: { bidHistory: { teamId: team._id, teamName: team.name, bidAmount: bid, bidTime: new Date() } },
	});
	if (!ok) throw new AuctionError('Another bid landed at the same moment. Check the current bid and try again.', 409);

	return { bid, team };
}

/** Sell the current player to the highest bidder. */
export async function markSold(tournament) {
	const state = await getAuctionState(tournament._id);
	if (!state.currentPlayer) throw new AuctionError('No player is up for auction');
	if (!state.currentBidder) throw new AuctionError('No bids yet. Mark UNSOLD instead.');

	const { currentPlayer, currentBidder, currentBid } = state;
	const ok = await swapState(state, { $set: CLEARED, $inc: { roundNumber: 1 } });
	if (!ok) throw new AuctionError('The auction changed at the same moment. Please try again.', 409);

	const player = await Player.findOneAndUpdate(
		{ _id: currentPlayer, tournament: tournament._id, status: { $in: POOL_STATUSES } },
		{ $set: { status: 'sold', soldTo: currentBidder, soldPrice: currentBid, soldAt: new Date() } },
		{ new: true }
	).lean();
	if (!player) throw new AuctionError('This player is no longer available');

	const team = await Team.findById(currentBidder).lean();
	logger.auction('Sold', { tournament: tournament.name, player: player.name, team: team?.name, price: currentBid });
	return { player, team, price: currentBid };
}

/** Category a player moves to when unsold, per the tournament's unsold policy. */
function categoryAfterUnsold(tournament, categoryId) {
	const tiers = tournament.categoriesByPrice();
	if (tournament.unsoldPolicy === 'move_lowest') return tiers[0]?._id ?? categoryId;
	if (tournament.unsoldPolicy === 'move_down') {
		const index = tiers.findIndex((c) => String(c._id) === String(categoryId));
		return index > 0 ? tiers[index - 1]._id : categoryId;
	}
	return categoryId;
}

/** No sale: the player goes back to the end of the queue (maybe a category lower). */
export async function markUnsold(tournament) {
	const state = await getAuctionState(tournament._id);
	if (!state.currentPlayer) throw new AuctionError('No player is up for auction');

	const player = await Player.findOne({ _id: state.currentPlayer, tournament: tournament._id });
	const ok = await swapState(state, { $set: CLEARED, $inc: { roundNumber: 1 } });
	if (!ok) throw new AuctionError('The auction changed at the same moment. Please try again.', 409);
	if (!player) throw new AuctionError('Player not found', 404);

	const fromCategory = tournament.getCategory(player.category);
	const lastInQueue = await Player.findOne({ tournament: tournament._id }).sort({ auctionOrder: -1 }).select('auctionOrder').lean();

	player.category = categoryAfterUnsold(tournament, player.category);
	player.status = 'unsold';
	player.timesUnsold = (player.timesUnsold || 0) + 1;
	player.auctionOrder = (lastInQueue?.auctionOrder || 0) + 1;
	await player.save();

	const toCategory = tournament.getCategory(player.category);
	logger.auction('Unsold', { tournament: tournament.name, player: player.name });
	return {
		player,
		movedFrom: fromCategory && toCategory && String(fromCategory._id) !== String(toCategory._id) ? fromCategory.name : null,
		movedTo: toCategory?.name || null,
	};
}

/** Take a player out of the auction (and off the stage if they were up). */
export async function withdrawPlayer(tournament, playerId) {
	const player = await loadPoolPlayer(tournament, playerId);
	player.status = 'withdrawn';
	await player.save();

	const state = await getAuctionState(tournament._id);
	if (String(state.currentPlayer) === String(player._id)) {
		await swapState(state, { $set: CLEARED });
	}
	return { player };
}

/** Reverse the most recent sale; the player returns to the top of the queue. */
export async function undoLastSale(tournament) {
	const player = await Player.findOne({ tournament: tournament._id, isOwner: false, status: 'sold' }).sort({
		soldAt: -1,
	});
	if (!player) throw new AuctionError('There is no sale to undo');

	const team = await Team.findById(player.soldTo).lean();
	const firstInQueue = await Player.findOne({ tournament: tournament._id }).sort({ auctionOrder: 1 }).select('auctionOrder').lean();
	const refund = player.soldPrice;

	player.status = 'available';
	player.soldTo = null;
	player.soldPrice = 0;
	player.soldAt = null;
	player.auctionOrder = (firstInQueue?.auctionOrder || 0) - 1;
	await player.save();

	logger.auction('Sale undone', { tournament: tournament.name, player: player.name, team: team?.name, refund });
	return { player, team, refund };
}

/**
 * Return every auctioned player to the pool, restoring any category they were
 * moved out of. Teams, owners and withdrawn players stay as they are.
 */
export async function resetAuction(tournament) {
	const players = await Player.find({ tournament: tournament._id, isOwner: false, status: { $ne: 'withdrawn' } });
	if (players.length === 0) {
		await AuctionState.updateOne({ tournament: tournament._id }, { $set: { ...CLEARED, roundNumber: 0 }, $inc: { __v: 1 } });
		return;
	}
	await Player.bulkWrite(
		players.map((p) => ({
			updateOne: {
				filter: { _id: p._id },
				update: {
					$set: {
						status: 'available',
						soldTo: null,
						soldPrice: 0,
						soldAt: null,
						timesUnsold: 0,
						category: p.originalCategory || p.category,
					},
				},
			},
		}))
	);
	await AuctionState.updateOne({ tournament: tournament._id }, { $set: { ...CLEARED, roundNumber: 0 }, $inc: { __v: 1 } });
	logger.auction('Auction reset', { tournament: tournament.name });
}

/** True once any player has been sold or passed unsold at auction. */
export async function hasAuctionStarted(tournament) {
	const started = await Player.exists({
		tournament: tournament._id,
		isOwner: false,
		status: { $in: ['sold', 'unsold'] },
	});
	return Boolean(started);
}
