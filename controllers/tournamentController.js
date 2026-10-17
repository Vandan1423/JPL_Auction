import mongoose from 'mongoose';
import Tournament from '../models/Tournament.js';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import { formatMoney } from '../utils/format.js';
import { deleteTournament as deleteTournamentCascade } from '../services/tournamentSetup.js';

/** GET /admin/tournaments — every tournament, newest first. */
export const listTournaments = async (req, res, next) => {
	try {
		const tournaments = await Tournament.find().sort({ updatedAt: -1 }).lean();
		const ids = tournaments.map((t) => t._id);
		const [teamCounts, playerCounts] = await Promise.all([
			Team.aggregate([{ $match: { tournament: { $in: ids } } }, { $group: { _id: '$tournament', n: { $sum: 1 } } }]),
			Player.aggregate([
				{ $match: { tournament: { $in: ids }, isOwner: false } },
				{
					$group: {
						_id: '$tournament',
						total: { $sum: 1 },
						sold: { $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] } },
					},
				},
			]),
		]);
		const teamsBy = new Map(teamCounts.map((r) => [String(r._id), r.n]));
		const playersBy = new Map(playerCounts.map((r) => [String(r._id), r]));

		res.render('admin/tournaments', {
			title: 'Tournaments',
			tournaments: tournaments.map((t) => ({
				...t,
				teamTotal: teamsBy.get(String(t._id)) || 0,
				playerTotal: playersBy.get(String(t._id))?.total || 0,
				soldTotal: playersBy.get(String(t._id))?.sold || 0,
				purseLabel: formatMoney(t.purse, t.currency),
			})),
			currentId: req.session.tournamentId || null,
		});
	} catch (error) {
		next(error);
	}
};

/** POST /admin/tournaments/:id/open — make this the tournament the admin works on. */
export const openTournament = async (req, res, next) => {
	try {
		const { id } = req.params;
		const tournament = mongoose.isValidObjectId(id) ? await Tournament.findById(id) : null;
		if (!tournament) {
			req.session.error = 'Tournament not found';
			return res.redirect('/admin/tournaments');
		}
		req.session.tournamentId = String(tournament._id);
		if (tournament.status === 'setup') return res.redirect(`/admin/setup/${tournament.setupStep || 1}`);
		return res.redirect('/admin/dashboard');
	} catch (error) {
		next(error);
	}
};

/** POST /admin/tournaments/:id/status — mark completed / reopen. */
export const setTournamentStatus = async (req, res, next) => {
	try {
		const tournament = mongoose.isValidObjectId(req.params.id) ? await Tournament.findById(req.params.id) : null;
		if (!tournament || tournament.status === 'setup') return res.redirect('/admin/tournaments');
		tournament.status = req.body.status === 'completed' ? 'completed' : 'active';
		await tournament.save();
		req.session.success = tournament.status === 'completed' ? `${tournament.name} marked as completed` : `${tournament.name} reopened`;
		return res.redirect('/admin/tournaments');
	} catch (error) {
		next(error);
	}
};

/** POST /admin/tournaments/:id/delete — requires typing the tournament name. */
export const deleteTournament = async (req, res, next) => {
	try {
		const tournament = mongoose.isValidObjectId(req.params.id) ? await Tournament.findById(req.params.id) : null;
		if (!tournament) {
			req.session.error = 'Tournament not found';
			return res.redirect('/admin/tournaments');
		}
		if (String(req.body.confirmName || '').trim() !== tournament.name) {
			req.session.error = 'The name you typed did not match, so nothing was deleted.';
			return res.redirect('/admin/tournaments');
		}

		const removed = await deleteTournamentCascade(tournament);
		if (req.session.tournamentId === String(tournament._id)) delete req.session.tournamentId;
		const parts = [`${removed.teams} teams`, `${removed.players} players`, 'the auction history'];
		if (removed.images.ok && removed.images.deleted) parts.push(`${removed.images.deleted} images`);
		const summary = `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
		if (removed.images.ok) {
			req.session.success = `${tournament.name} was deleted: ${summary}.`;
		} else {
			req.session.error = `${tournament.name} was deleted (${summary}), but its images could not be removed from Cloudinary. ${removed.images.message} You can delete the folder ${removed.images.folder} in the Cloudinary Media Library later.`;
		}
		return res.redirect('/admin/tournaments');
	} catch (error) {
		next(error);
	}
};
