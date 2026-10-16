import mongoose from 'mongoose';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import { getBiddingBoard, getPlayerCounts } from '../services/standings.js';
import { getAuctionState } from '../services/auction.js';
import { imageUrl } from '../services/cloudinary.js';

/** GET /admin/teams — every team with purse, squad and category mix. */
export const getAllTeams = async (req, res, next) => {
	try {
		const t = req.tournament;
		const [board, counts] = await Promise.all([getBiddingBoard(t), getPlayerCounts(t)]);
		const teams = board.teams;

		res.render('admin/teams', {
			title: 'Teams',
			teams,
			totals: {
				spent: teams.reduce((sum, team) => sum + team.spent, 0),
				remaining: teams.reduce((sum, team) => sum + team.remainingPurse, 0),
				sold: counts.sold,
				pool: counts.pool,
				total: counts.total,
			},
		});
	} catch (error) {
		next(error);
	}
};

/** GET /admin/teams/:id — one team's squad and spending. */
export const getTeamDetails = async (req, res, next) => {
	try {
		const t = req.tournament;
		if (!mongoose.isValidObjectId(req.params.id)) return res.redirect('/admin/teams');

		const board = await getBiddingBoard(t);
		const team = board.teams.find((x) => String(x._id) === req.params.id);
		if (!team) {
			req.session.error = 'Team not found';
			return res.redirect('/admin/teams');
		}

		const squad = await Player.find({ tournament: t._id, soldTo: team._id, status: 'sold' })
			.sort({ isOwner: -1, soldAt: 1 })
			.lean();

		const categorySpending = t.categories.map((c) => {
			const inCategory = squad.filter((p) => String(p.category) === String(c._id));
			return { category: c, count: inCategory.length, spent: inCategory.reduce((sum, p) => sum + p.soldPrice, 0) };
		});

		const bought = squad.filter((p) => !p.isOwner);
		const mostExpensive = bought.reduce((max, p) => (!max || p.soldPrice > max.soldPrice ? p : max), null);
		const slotsToMinimum = Math.max(0, t.squad.min - team.playersCount);

		res.render('admin/team-details', {
			title: team.name,
			team,
			squad: squad.map((p) => ({ ...p, photoThumb: imageUrl(p.photo, 'thumb') })),
			categorySpending,
			mostExpensive,
			slotsToMinimum,
			perSlotBudget: slotsToMinimum > 0 ? Math.floor(team.remainingPurse / slotsToMinimum) : 0,
			missingRoles: (t.roleRequirements || [])
				.map((r) => ({ role: r.role, short: r.min - (team.roleCounts?.[r.role] || 0) }))
				.filter((r) => r.short > 0),
		});
	} catch (error) {
		next(error);
	}
};

/**
 * POST /admin/teams/:id/reset — release every player this team bought back
 * into the pool (a playing owner stays).
 */
export const resetTeam = async (req, res, next) => {
	try {
		const t = req.tournament;
		const team = mongoose.isValidObjectId(req.params.id) ? await Team.findOne({ _id: req.params.id, tournament: t._id }) : null;
		if (!team) {
			req.session.error = 'Team not found';
			return res.redirect('/admin/teams');
		}

		const state = await getAuctionState(t._id);
		if (String(state.currentBidder) === String(team._id)) {
			req.session.error = `${team.name} is the highest bidder right now. Finish the current player first.`;
			return res.redirect('/admin/teams');
		}

		const result = await Player.updateMany(
			{ tournament: t._id, soldTo: team._id, isOwner: false },
			{ $set: { status: 'available', soldTo: null, soldPrice: 0, soldAt: null } }
		);
		req.session.success = `${team.name}: ${result.modifiedCount} player(s) returned to the auction pool`;
		res.redirect('/admin/teams');
	} catch (error) {
		next(error);
	}
};
