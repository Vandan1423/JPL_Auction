import mongoose from 'mongoose';
import Player from '../models/Player.js';
import { JERSEY_SIZES, POOL_STATUSES } from '../config/constants.js';
import { escapeRegex, toInt } from '../utils/format.js';
import { fileFor } from '../middleware/upload.js';
import { deleteImage, imageUrl, uploadImage } from '../services/cloudinary.js';
import { nextAuctionOrder, nextPlayerNumber } from '../services/tournamentSetup.js';
import { getAuctionState } from '../services/auction.js';

const trim = (value, max = 120) => String(value ?? '').trim().slice(0, max);

/**
 * Validate player input against the tournament's own roles, categories and
 * field settings (each optional field can be required, optional or hidden).
 */
export function parsePlayerInput(body, tournament) {
	const fields = tournament.playerFields || {};
	const mode = (key) => fields[key] || 'optional';
	const visible = (key) => mode(key) !== 'hidden';

	const data = {
		name: trim(body.name, 80),
		role: trim(body.role, 40),
		category: trim(body.category, 40),
		phone: visible('phone') ? trim(body.phone, 20).replace(/[\s-]/g, '') : '',
		jerseySize: visible('jerseySize') ? trim(body.jerseySize, 5).toUpperCase() : '',
		jerseyNumber: visible('jerseyNumber') ? trim(body.jerseyNumber, 4) : '',
		age: visible('age') ? toInt(body.age) : null,
	};

	const errors = [];
	if (!data.name) errors.push('Name is required');
	if (!data.role) errors.push('Role is required');
	else if (!tournament.roles.includes(data.role)) errors.push(`"${data.role}" is not a role in this tournament`);
	if (!data.category) errors.push('Category is required');
	else if (!mongoose.isValidObjectId(data.category) || !tournament.getCategory(data.category)) {
		errors.push('Pick a valid category');
	}

	if (mode('phone') === 'required' && !data.phone) errors.push('Phone number is required');
	if (data.phone && !/^\+?\d{6,15}$/.test(data.phone)) errors.push('Phone number should be 6–15 digits');

	if (mode('jerseySize') === 'required' && !data.jerseySize) errors.push('Jersey size is required');
	if (data.jerseySize && !JERSEY_SIZES.includes(data.jerseySize)) errors.push('Pick a valid jersey size');

	if (mode('jerseyNumber') === 'required' && !data.jerseyNumber) errors.push('Jersey number is required');
	if (data.jerseyNumber && !/^\d{1,3}$/.test(data.jerseyNumber)) errors.push('Jersey number should be 0–999');

	if (mode('age') === 'required' && data.age === null) errors.push('Age is required');
	if (data.age !== null && (data.age < 5 || data.age > 90)) errors.push('Age should be between 5 and 90');

	return { data, errors };
}

/** Is this phone number already registered to another player in the tournament? */
async function phoneTaken(tournament, phone, exceptId = null) {
	if (!phone) return null;
	return Player.findOne({
		tournament: tournament._id,
		phone,
		...(exceptId ? { _id: { $ne: exceptId } } : {}),
	})
		.select('name')
		.lean();
}

const formOptions = (tournament) => ({
	roles: tournament.roles,
	categories: tournament.categories,
	jerseySizes: JERSEY_SIZES,
	fields: tournament.playerFields || {},
});

// ───────────────────────── List ─────────────────────────

export const getAllPlayers = async (req, res, next) => {
	try {
		const t = req.tournament;
		const { category, status, search, role } = req.query;

		const query = { tournament: t._id, isOwner: false };
		if (category && category !== 'all' && mongoose.isValidObjectId(category)) query.category = category;
		if (status && status !== 'all') query.status = status === 'pool' ? { $in: POOL_STATUSES } : status;
		if (role && role !== 'all') query.role = role;
		if (search) query.name = { $regex: escapeRegex(search), $options: 'i' };

		const [players, statusRows] = await Promise.all([
			Player.find(query).populate('soldTo', 'name color').sort({ playerNumber: 1 }).lean(),
			Player.aggregate([
				{ $match: { tournament: t._id, isOwner: false } },
				{ $group: { _id: '$status', n: { $sum: 1 } } },
			]),
		]);
		const statusCounts = { total: 0, available: 0, unsold: 0, sold: 0, withdrawn: 0 };
		statusRows.forEach((r) => {
			statusCounts[r._id] = r.n;
			statusCounts.total += r.n;
		});

		res.render('admin/players', {
			title: 'Players',
			players: players.map((p) => ({ ...p, photoThumb: imageUrl(p.photo, 'thumb') })),
			statusCounts,
			appliedFilters: { category: category || 'all', status: status || 'all', role: role || 'all', search: search || '' },
		});
	} catch (error) {
		next(error);
	}
};

// ───────────────────────── Add ─────────────────────────

export const showAddPlayerForm = (req, res) => {
	res.render('admin/add-player', {
		title: 'Add Player',
		values: { category: req.query.category || '' },
		errors: [],
		...formOptions(req.tournament),
	});
};

export const addPlayer = async (req, res, next) => {
	const t = req.tournament;
	const renderWithErrors = (values, errors) =>
		res.status(400).render('admin/add-player', { title: 'Add Player', values, errors, ...formOptions(t) });

	try {
		const { data, errors } = parsePlayerInput(req.body, t);
		if (req.uploadError) errors.push(req.uploadError);
		const duplicate = await phoneTaken(t, data.phone);
		if (duplicate) errors.push(`Phone number ${data.phone} is already registered to ${duplicate.name}`);
		if (errors.length) return renderWithErrors(data, errors);

		const photoFile = fileFor(req, 'photo');
		let photo;
		if (photoFile) {
			try {
				photo = await uploadImage(photoFile.buffer, { tournamentId: t._id, kind: 'players' });
			} catch (uploadError) {
				return renderWithErrors(data, [uploadError.message]);
			}
		}

		const player = await Player.create({
			...data,
			tournament: t._id,
			originalCategory: data.category,
			photo,
			playerNumber: await nextPlayerNumber(t._id),
			auctionOrder: await nextAuctionOrder(t._id),
		});

		req.session.success = `${player.name} added as #${player.playerNumber}`;
		// Keep the category selected: players are usually entered category by category.
		return res.redirect(`/admin/players/add?category=${data.category}`);
	} catch (error) {
		next(error);
	}
};

// ───────────────────────── Bulk add ─────────────────────────

export const showBulkAddForm = (req, res) => {
	res.render('admin/bulk-add', { title: 'Bulk Add Players', ...formOptions(req.tournament) });
};

/** POST /admin/players/bulk — JSON rows; each valid row is added, the rest are reported. */
export const bulkAddPlayers = async (req, res) => {
	try {
		const t = req.tournament;
		const rows = Array.isArray(req.body.players) ? req.body.players.slice(0, 200) : [];
		if (rows.length === 0) return res.json({ success: false, message: 'No player data provided' });

		const valid = [];
		const failed = [];
		const phones = new Set();
		for (const [index, row] of rows.entries()) {
			const { data, errors } = parsePlayerInput(row, t);
			if (data.phone && phones.has(data.phone)) errors.push('Phone number repeated in this batch');
			const duplicate = !errors.length && (await phoneTaken(t, data.phone));
			if (duplicate) errors.push(`Phone number already registered to ${duplicate.name}`);
			if (errors.length) {
				failed.push({ row: row.row ?? index + 1, name: data.name || '—', reason: errors.join(', ') });
				continue;
			}
			if (data.phone) phones.add(data.phone);
			valid.push(data);
		}

		let number = await nextPlayerNumber(t._id);
		let order = await nextAuctionOrder(t._id);
		const docs = valid.map((data) => ({
			...data,
			tournament: t._id,
			originalCategory: data.category,
			playerNumber: number++,
			auctionOrder: order++,
		}));
		if (docs.length) await Player.insertMany(docs);

		return res.json({
			success: true,
			added: docs.length,
			failed,
			message:
				`Added ${docs.length} player${docs.length === 1 ? '' : 's'}.` +
				(failed.length ? ` ${failed.length} row${failed.length === 1 ? ' needs' : 's need'} fixing.` : ''),
		});
	} catch (error) {
		console.error('Error in bulk add:', error);
		return res.status(500).json({ success: false, message: 'Server error during bulk add: ' + error.message });
	}
};

// ───────────────────────── Edit / delete ─────────────────────────

const findPlayer = (tournament, id) =>
	mongoose.isValidObjectId(id) ? Player.findOne({ _id: id, tournament: tournament._id, isOwner: false }) : null;

export const showEditPlayerForm = async (req, res, next) => {
	try {
		const player = await findPlayer(req.tournament, req.params.id)?.populate('soldTo', 'name');
		if (!player) {
			req.session.error = 'Player not found';
			return res.redirect('/admin/players');
		}
		res.render('admin/edit-player', {
			title: `Edit ${player.name}`,
			player,
			values: { ...player.toObject(), category: String(player.category || '') },
			errors: [],
			...formOptions(req.tournament),
		});
	} catch (error) {
		next(error);
	}
};

export const editPlayer = async (req, res, next) => {
	const t = req.tournament;
	try {
		const player = await findPlayer(t, req.params.id)?.populate('soldTo', 'name');
		if (!player) {
			req.session.error = 'Player not found';
			return res.redirect('/admin/players');
		}

		const { data, errors } = parsePlayerInput(req.body, t);
		if (req.uploadError) errors.push(req.uploadError);
		if (player.status === 'sold' && String(player.category) !== data.category) {
			errors.push('The category of a sold player cannot change. Undo the sale first.');
		}
		const duplicate = await phoneTaken(t, data.phone, player._id);
		if (duplicate) errors.push(`Phone number ${data.phone} is already registered to ${duplicate.name}`);

		const photoFile = fileFor(req, 'photo');
		if (!errors.length && photoFile) {
			try {
				const uploaded = await uploadImage(photoFile.buffer, { tournamentId: t._id, kind: 'players' });
				await deleteImage(player.photo?.publicId);
				player.photo = uploaded;
			} catch (uploadError) {
				errors.push(uploadError.message);
			}
		} else if (!errors.length && req.body.removePhoto === 'on' && player.photo?.publicId) {
			await deleteImage(player.photo.publicId);
			player.photo = undefined;
		}

		if (errors.length) {
			return res.status(400).render('admin/edit-player', {
				title: `Edit ${player.name}`,
				player,
				values: { ...data },
				errors,
				...formOptions(t),
			});
		}

		const categoryChanged = String(player.category) !== data.category;
		player.set(data);
		if (categoryChanged) player.originalCategory = data.category;
		await player.save();

		req.session.success = `${player.name} updated`;
		return res.redirect('/admin/players');
	} catch (error) {
		next(error);
	}
};

export const deletePlayer = async (req, res, next) => {
	try {
		const t = req.tournament;
		const player = await findPlayer(t, req.params.id);
		if (!player) {
			req.session.error = 'Player not found';
			return res.redirect('/admin/players');
		}
		if (player.status === 'sold') {
			req.session.error = `${player.name} is in a squad. Undo the sale before deleting.`;
			return res.redirect('/admin/players');
		}
		const state = await getAuctionState(t._id);
		if (String(state.currentPlayer) === String(player._id)) {
			req.session.error = `${player.name} is under the hammer right now. Mark them unsold first.`;
			return res.redirect('/admin/players');
		}

		await Player.deleteOne({ _id: player._id });
		await deleteImage(player.photo?.publicId);
		req.session.success = `${player.name} deleted`;
		return res.redirect('/admin/players');
	} catch (error) {
		next(error);
	}
};

// ───────────────────────── Auction order ─────────────────────────

export const showReorderPage = async (req, res, next) => {
	try {
		const players = await Player.find({ tournament: req.tournament._id, isOwner: false, status: { $in: POOL_STATUSES } })
			.sort({ auctionOrder: 1, playerNumber: 1 })
			.select('name playerNumber category role auctionOrder status')
			.lean();
		res.render('admin/reorder-players', { title: 'Auction Order', players });
	} catch (error) {
		next(error);
	}
};

export const savePlayerOrder = async (req, res) => {
	try {
		const { playerIds } = req.body;
		if (!Array.isArray(playerIds) || playerIds.length === 0) {
			return res.status(400).json({ success: false, message: 'No player IDs provided' });
		}
		const ids = playerIds.filter((id) => mongoose.isValidObjectId(id));
		await Player.bulkWrite(
			ids.map((id, index) => ({
				updateOne: { filter: { _id: id, tournament: req.tournament._id }, update: { $set: { auctionOrder: index + 1 } } },
			}))
		);
		return res.json({ success: true, message: 'Order saved' });
	} catch (error) {
		console.error('Error saving player order:', error);
		return res.status(500).json({ success: false, message: 'Failed to save order' });
	}
};

/**
 * POST /admin/players/reorder/auto — arrange the whole queue in one click:
 * by category (most expensive first), randomly within each category, or by
 * registration number.
 */
export const autoArrangeOrder = async (req, res, next) => {
	try {
		const t = req.tournament;
		const mode = req.body.mode;
		const players = await Player.find({ tournament: t._id, isOwner: false, status: { $in: POOL_STATUSES } })
			.select('category playerNumber')
			.lean();

		const priceRank = new Map(
			[...t.categories].sort((a, b) => b.basePrice - a.basePrice).map((c, i) => [String(c._id), i])
		);
		const shuffled = players.map((p) => ({ ...p, r: Math.random() }));
		const byCategory = (a, b) => (priceRank.get(String(a.category)) ?? 99) - (priceRank.get(String(b.category)) ?? 99);

		if (mode === 'category') shuffled.sort((a, b) => byCategory(a, b) || a.playerNumber - b.playerNumber);
		else if (mode === 'category-random') shuffled.sort((a, b) => byCategory(a, b) || a.r - b.r);
		else if (mode === 'random') shuffled.sort((a, b) => a.r - b.r);
		else shuffled.sort((a, b) => a.playerNumber - b.playerNumber);

		if (shuffled.length) {
			await Player.bulkWrite(
				shuffled.map((p, i) => ({ updateOne: { filter: { _id: p._id }, update: { $set: { auctionOrder: i + 1 } } } }))
			);
		}
		req.session.success = 'Auction order updated';
		return res.redirect('/admin/players/reorder');
	} catch (error) {
		next(error);
	}
};
