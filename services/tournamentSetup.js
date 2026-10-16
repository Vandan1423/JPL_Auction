import Tournament from '../models/Tournament.js';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import AuctionState from '../models/AuctionState.js';
import { TEAM_COLORS } from '../config/constants.js';
import { slugify } from '../utils/format.js';
import { deleteImage, deleteTournamentImages } from './cloudinary.js';

/** A slug for the public display URL that no other tournament uses. */
export async function uniqueSlug(name, season, excludeId = null) {
	const base = slugify([name, season].filter(Boolean).join(' ')) || 'tournament';
	let slug = base;
	for (let n = 2; ; n++) {
		const clash = await Tournament.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
		if (!clash) return slug;
		slug = `${base}-${n}`;
	}
}

/**
 * Make the number of Team documents match tournament.teamCount. New teams get
 * placeholder names and colours for the wizard; surplus teams (and their
 * playing owners) are removed from the end. Only used before the auction starts.
 */
export async function syncTeams(tournament) {
	const teams = await Team.find({ tournament: tournament._id }).sort('order');

	if (teams.length > tournament.teamCount) {
		const surplus = teams.slice(tournament.teamCount);
		const ids = surplus.map((t) => t._id);
		await Player.deleteMany({ tournament: tournament._id, isOwner: true, soldTo: { $in: ids } });
		await Team.deleteMany({ _id: { $in: ids } });
		await Promise.all(surplus.flatMap((t) => [deleteImage(t.logo?.publicId), deleteImage(t.owner?.photo?.publicId)]));
	}

	if (teams.length < tournament.teamCount) {
		const usedColors = new Set(teams.map((t) => t.color));
		const freeColors = TEAM_COLORS.filter((c) => !usedColors.has(c));
		const lastOrder = teams.length ? teams[teams.length - 1].order : 0;
		const toCreate = Array.from({ length: tournament.teamCount - teams.length }, (_, i) => ({
			tournament: tournament._id,
			order: lastOrder + i + 1,
			name: `Team ${lastOrder + i + 1}`,
			color: freeColors[i % freeColors.length] || TEAM_COLORS[(lastOrder + i) % TEAM_COLORS.length],
		}));
		await Team.insertMany(toCreate);
	}
}

/**
 * A playing owner is represented by a sold Player (isOwner: true) so squad
 * lists, counts and exports treat them like any other squad member. This keeps
 * those Player documents in line with each team's owner settings.
 */
export async function syncOwnerPlayers(tournament) {
	const teams = await Team.find({ tournament: tournament._id }).lean();

	for (const team of teams) {
		const plays = team.owner?.isPlaying && team.owner?.name;
		if (!plays) {
			await Player.deleteMany({ tournament: tournament._id, isOwner: true, soldTo: team._id });
			continue;
		}
		const hasPhoto = Boolean(team.owner.photo?.url);
		await Player.findOneAndUpdate(
			{ tournament: tournament._id, isOwner: true, soldTo: team._id },
			{
				$set: {
					name: team.owner.name,
					role: team.owner.role || '',
					status: 'sold',
					soldPrice: tournament.ownerPlayerPrice || 0,
					...(hasPhoto ? { photo: team.owner.photo } : {}),
				},
				...(hasPhoto ? {} : { $unset: { photo: 1 } }),
				$setOnInsert: { tournament: tournament._id, isOwner: true, soldTo: team._id, playerNumber: null },
			},
			{ upsert: true }
		);
	}
}

export async function nextPlayerNumber(tournamentId) {
	const last = await Player.findOne({ tournament: tournamentId, isOwner: false })
		.sort({ playerNumber: -1 })
		.select('playerNumber')
		.lean();
	return (last?.playerNumber || 0) + 1;
}

export async function nextAuctionOrder(tournamentId) {
	const last = await Player.findOne({ tournament: tournamentId }).sort({ auctionOrder: -1 }).select('auctionOrder').lean();
	return (last?.auctionOrder || 0) + 1;
}

/** Delete a tournament with all its teams, players, auction state and images. */
export async function deleteTournament(tournament) {
	await Promise.all([
		Player.deleteMany({ tournament: tournament._id }),
		Team.deleteMany({ tournament: tournament._id }),
		AuctionState.deleteMany({ tournament: tournament._id }),
	]);
	await Tournament.deleteOne({ _id: tournament._id });
	await deleteTournamentImages(tournament._id);
}
