import Player from '../models/Player.js';
import { POOL_STATUSES } from '../config/constants.js';
import {
	AuctionError,
	getSnapshot,
	markSold,
	markUnsold,
	placeBid,
	startNextPlayer,
	startPlayer,
	undoLastBid,
	undoLastSale,
	withdrawPlayer,
} from '../services/auction.js';
import { broadcast } from '../socket/index.js';
import { formatMoney } from '../utils/format.js';
import { imageUrl } from '../services/cloudinary.js';

/** Players still waiting to be auctioned, in queue order. */
async function getQueue(tournament) {
	const players = await Player.find({ tournament: tournament._id, isOwner: false, status: { $in: POOL_STATUSES } })
		.sort({ auctionOrder: 1, playerNumber: 1 })
		.select('name playerNumber category role status photo timesUnsold')
		.lean();
	return players.map((p) => ({
		_id: p._id,
		name: p.name,
		playerNumber: p.playerNumber,
		category: p.category ? String(p.category) : null,
		role: p.role,
		status: p.status,
		timesUnsold: p.timesUnsold || 0,
		photoThumb: imageUrl(p.photo, 'thumb'),
	}));
}

/** GET /auction/control — the auctioneer's control panel. */
export const showAuctionControl = async (req, res, next) => {
	try {
		const t = req.tournament;
		const [snapshot, queue] = await Promise.all([getSnapshot(t), getQueue(t)]);
		res.render('admin/auction-control', {
			title: `Auction · ${t.name}`,
			snapshot,
			queue,
			categories: t.categoriesByPrice().reverse().map((c) => ({
				_id: String(c._id),
				name: c.name,
				color: c.color,
				basePrice: c.basePrice,
			})),
		});
	} catch (error) {
		next(error);
	}
};

/** GET /auction/api/queue — refreshed by the control panel after each sale. */
export const apiQueue = async (req, res, next) => {
	try {
		res.json({ success: true, queue: await getQueue(req.tournament) });
	} catch (error) {
		next(error);
	}
};

/**
 * Run an auction operation, broadcast the outcome to every screen watching
 * this tournament, and reply with the same event.
 */
const handle = (operation) => async (req, res) => {
	try {
		const { type, details, message } = await operation(req);
		const event = await broadcast(req.io, req.tournament, type, details);
		res.json({ success: true, message, event });
	} catch (error) {
		const status = error instanceof AuctionError ? error.status : 500;
		if (!(error instanceof AuctionError)) console.error('Auction operation failed:', error);
		res.status(status).json({ success: false, message: error.message || 'Something went wrong' });
	}
};

const money = (req, amount) => formatMoney(amount, req.tournament.currency);

export const apiStartPlayer = handle(async (req) => {
	const { player } = await startPlayer(req.tournament, req.body.playerId);
	return { type: 'player-selected', details: { playerId: player._id }, message: `${player.name} is up` };
});

export const apiNextPlayer = handle(async (req) => {
	const { player } = await startNextPlayer(req.tournament, {
		random: Boolean(req.body.random),
		categoryId: req.body.categoryId || null,
	});
	return { type: 'player-selected', details: { playerId: player._id }, message: `${player.name} is up` };
});

export const apiPlaceBid = handle(async (req) => {
	const { bid, team } = await placeBid(req.tournament, req.body.teamId, req.body.amount ?? null);
	return {
		type: 'bid',
		details: { teamId: team._id, amount: bid },
		message: `${team.name} bid ${money(req, bid)}`,
	};
});

export const apiUndoBid = handle(async (req) => {
	const { undone, previous } = await undoLastBid(req.tournament);
	const now = previous ? `${previous.teamName} leads at ${money(req, previous.bidAmount)}` : 'back to base price with no bids';
	return {
		type: 'bid-undone',
		details: { teamId: undone.teamId, amount: undone.bidAmount },
		message: `Bid of ${money(req, undone.bidAmount)} by ${undone.teamName} removed; ${now}`,
	};
});

export const apiMarkSold = handle(async (req) => {
	const { player, team, price } = await markSold(req.tournament);
	return {
		type: 'sold',
		details: {
			sale: {
				playerId: player._id,
				playerName: player.name,
				photo: imageUrl(player.photo, 'card'),
				teamId: team?._id,
				teamName: team?.name,
				teamColor: team?.color,
				teamLogo: imageUrl(team?.logo, 'logo'),
				price,
			},
		},
		message: `${player.name} SOLD to ${team?.name} for ${money(req, price)}`,
	};
});

export const apiMarkUnsold = handle(async (req) => {
	const { player, movedFrom, movedTo } = await markUnsold(req.tournament);
	const move = movedFrom ? ` (moved from ${movedFrom} to ${movedTo})` : '';
	return {
		type: 'unsold',
		details: {
			unsold: { playerId: player._id, playerName: player.name, photo: imageUrl(player.photo, 'card'), movedFrom, movedTo },
		},
		message: `${player.name} UNSOLD${move}`,
	};
});

export const apiWithdrawPlayer = handle(async (req) => {
	const { player } = await withdrawPlayer(req.tournament, req.body.playerId);
	return { type: 'withdrawn', details: { playerId: player._id }, message: `${player.name} withdrawn` };
});

export const apiUndoSale = handle(async (req) => {
	const { player, team, refund } = await undoLastSale(req.tournament);
	return {
		type: 'undo',
		details: { playerId: player._id },
		message: `Sale reversed: ${player.name} returned to the pool, ${money(req, refund)} refunded to ${team?.name}`,
	};
});

/** GET /auction/api/state — fresh snapshot (used after reconnecting). */
export const apiState = async (req, res, next) => {
	try {
		res.json({ success: true, snapshot: await getSnapshot(req.tournament) });
	} catch (error) {
		next(error);
	}
};
