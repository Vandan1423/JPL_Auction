import mongoose from 'mongoose';
import Tournament from '../models/Tournament.js';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import {
	CATEGORY_COLORS,
	CURRENCIES,
	DEFAULT_ROLES,
	FIELD_MODES,
	LIMITS,
	PLAYER_FIELDS,
	UNSOLD_POLICIES,
} from '../config/constants.js';
import { toInt } from '../utils/format.js';
import { fileFor } from '../middleware/upload.js';
import { deleteImage, uploadImage } from '../services/cloudinary.js';
import { hasAuctionStarted } from '../services/auction.js';
import { syncOwnerPlayers, syncTeams, uniqueSlug } from '../services/tournamentSetup.js';

export const STEPS = [
	{ n: 1, key: 'basics', title: 'Tournament', icon: 'fa-trophy', hint: 'Name, season and logo' },
	{ n: 2, key: 'squad', title: 'Squad & purse', icon: 'fa-wallet', hint: 'Teams, squad size and budget' },
	{ n: 3, key: 'categories', title: 'Categories & bids', icon: 'fa-layer-group', hint: 'Base prices and bid increments' },
	{ n: 4, key: 'players', title: 'Player form', icon: 'fa-id-card', hint: 'Roles and registration fields' },
	{ n: 5, key: 'teams', title: 'Teams & owners', icon: 'fa-shield-halved', hint: 'Names, logos and owners' },
	{ n: 6, key: 'review', title: 'Rules & review', icon: 'fa-flag-checkered', hint: 'Unsold players and summary' },
];

const isHexColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || ''));
const trim = (value, max = 200) => String(value ?? '').trim().slice(0, max);
// Repeatable form rows arrive as arrays (possibly with holes where a row was
// removed) or objects; normalise to a dense list of row objects.
const rowsOf = (value) =>
	(Array.isArray(value) ? [...value] : Object.values(value || {})).filter((row) => row && typeof row === 'object');

/** Round a suggested price to a tidy figure (e.g. 66,667 → 65,000). */
function tidy(value) {
	if (value >= 10000) return Math.max(5000, Math.round(value / 5000) * 5000);
	if (value >= 1000) return Math.round(value / 500) * 500;
	return Math.max(50, Math.round(value / 50) * 50);
}

/** Starter categories and increments scaled to the purse, shown on an empty step 3. */
function suggestedCategories(tournament) {
	const average = tournament.purse / Math.max(tournament.squad.max, 1);
	const top = tidy(average * 0.75);
	const low = tidy(average * 0.15);
	return {
		categories: [
			{ name: 'A', basePrice: top, color: CATEGORY_COLORS[0], maxPerTeam: null, increments: [] },
			{ name: 'B', basePrice: tidy(average * 0.35), color: CATEGORY_COLORS[1], maxPerTeam: null, increments: [] },
			{ name: 'C', basePrice: low, color: CATEGORY_COLORS[2], maxPerTeam: null, increments: [] },
		],
		bidIncrements: [
			{ from: 0, step: tidy(low * 0.2) },
			{ from: tidy(top * 2), step: tidy(low * 0.5) },
		],
	};
}

/** Parse increment slab rows; returns sorted, de-duplicated slabs starting at 0. */
function parseSlabs(rows) {
	const slabs = rowsOf(rows)
		.map((r) => ({ from: toInt(r?.from), step: toInt(r?.step) }))
		.filter((s) => s.from !== null || s.step !== null);
	const errors = [];
	for (const s of slabs) {
		if (s.from === null || s.from < 0) errors.push('Each increment row needs a "from" amount of 0 or more');
		if (s.step === null || s.step < 1) errors.push('Each increment must be at least 1');
	}
	const unique = [];
	for (const s of slabs.filter((x) => x.from !== null && x.step !== null).sort((a, b) => a.from - b.from)) {
		if (!unique.some((u) => u.from === s.from)) unique.push(s);
	}
	if (unique.length && unique[0].from > 0) unique[0].from = 0;
	return { slabs: unique, errors: [...new Set(errors)] };
}

// ───────────────────────── Form data per step ─────────────────────────

/** Values shown in a step's form, read from the saved tournament. */
async function formDataFor(step, tournament) {
	switch (step) {
		case 1:
			return {
				name: tournament?.name || '',
				shortName: tournament?.shortName || '',
				season: tournament?.season ?? String(new Date().getFullYear()),
				currency: tournament?.currency || 'INR',
				venue: tournament?.venue || '',
				auctionDate: tournament?.auctionDate ? tournament.auctionDate.toISOString().slice(0, 10) : '',
				logo: tournament?.logo,
			};
		case 2:
			return {
				teamCount: tournament.teamCount,
				squadMin: tournament.squad.min,
				squadMax: tournament.squad.max,
				purse: tournament.purse,
				maxBidPerPlayer: tournament.maxBidPerPlayer ?? '',
			};
		case 3: {
			if (tournament.categories.length === 0) return suggestedCategories(tournament);
			return {
				categories: tournament.categories.map((c) => c.toObject()),
				bidIncrements: tournament.bidIncrements.map((s) => ({ from: s.from, step: s.step })),
			};
		}
		case 4:
			return {
				roles: tournament.roles?.length ? tournament.roles : DEFAULT_ROLES,
				roleRequirements: tournament.roleRequirements.map((r) => ({ role: r.role, min: r.min })),
				playerFields: tournament.playerFields?.toObject?.() || tournament.playerFields || {},
			};
		case 5: {
			const teams = await Team.find({ tournament: tournament._id }).sort('order').lean();
			return { teams };
		}
		case 6:
			return { unsoldPolicy: tournament.unsoldPolicy };
		default:
			return {};
	}
}

/** Extra data a step's view needs besides its form values. */
async function viewContextFor(step, tournament) {
	if (step === 6 && tournament) {
		const teams = await Team.find({ tournament: tournament._id }).sort('order').lean();
		const playerCount = await Player.countDocuments({ tournament: tournament._id, isOwner: false });
		return { reviewTeams: teams, playerCount };
	}
	return {};
}

async function renderStep(req, res, step, { data, errors = [], status = 200 } = {}) {
	const tournament = req.tournament || null;
	const locked = tournament ? await hasAuctionStarted(tournament) : false;
	res.status(status).render('admin/setup', {
		title: tournament ? `Setup · ${tournament.name}` : 'New tournament',
		step,
		steps: STEPS,
		isNew: !tournament,
		inSetup: !tournament || tournament.status === 'setup',
		reachedStep: tournament ? (tournament.status === 'setup' ? tournament.setupStep : STEPS.length) : 1,
		locked,
		errors,
		d: data || (await formDataFor(step, tournament)),
		currencies: CURRENCIES,
		fieldModes: FIELD_MODES,
		playerFieldLabels: PLAYER_FIELDS,
		unsoldPolicies: UNSOLD_POLICIES,
		categoryColors: CATEGORY_COLORS,
		limits: LIMITS,
		...(await viewContextFor(step, tournament)),
	});
}

// ───────────────────────── Step 1: basics ─────────────────────────

function parseBasics(body) {
	const data = {
		name: trim(body.name, 80),
		shortName: trim(body.shortName, 12),
		season: trim(body.season, 20),
		currency: CURRENCIES[body.currency] ? body.currency : 'INR',
		venue: trim(body.venue, 120),
		auctionDate: trim(body.auctionDate, 10),
		removeLogo: body.removeLogo === 'on',
	};
	const errors = [];
	if (!data.name) errors.push('Tournament name is required');
	if (data.auctionDate && Number.isNaN(Date.parse(data.auctionDate))) errors.push('Auction date is not a valid date');
	return { data, errors };
}

async function applyLogo(req, tournament, removeLogo) {
	const file = fileFor(req, 'logo');
	if (file) {
		const uploaded = await uploadImage(file.buffer, { tournamentId: tournament._id, kind: 'tournament' });
		await deleteImage(tournament.logo?.publicId);
		tournament.logo = uploaded;
	} else if (removeLogo && tournament.logo?.publicId) {
		await deleteImage(tournament.logo.publicId);
		tournament.logo = undefined;
	}
}

// ───────────────────────── Routes ─────────────────────────

/** GET /admin/tournaments/new — step 1 for a brand-new tournament. */
export const showNewTournament = async (req, res) => {
	req.tournament = null;
	return renderStep(req, res, 1);
};

/** POST /admin/tournaments/new — create the tournament from step 1. */
export const createTournament = async (req, res, next) => {
	try {
		req.tournament = null;
		const { data, errors } = parseBasics(req.body);
		if (req.uploadError) errors.push(req.uploadError);
		if (errors.length) return renderStep(req, res, 1, { data, errors, status: 400 });

		const tournament = new Tournament({
			name: data.name,
			shortName: data.shortName,
			season: data.season,
			currency: data.currency,
			venue: data.venue,
			auctionDate: data.auctionDate ? new Date(data.auctionDate) : null,
			slug: await uniqueSlug(data.name, data.season),
			setupStep: 2,
		});
		await tournament.save();

		try {
			await applyLogo(req, tournament, false);
			await tournament.save();
		} catch (uploadError) {
			req.session.error = `Tournament created, but the logo was not uploaded: ${uploadError.message}`;
		}

		await syncTeams(tournament);
		req.session.tournamentId = String(tournament._id);
		return res.redirect('/admin/setup/2');
	} catch (error) {
		next(error);
	}
};

/** GET /admin/setup/:step */
export const showStep = async (req, res, next) => {
	try {
		const step = toInt(req.params.step);
		if (!step || step < 1 || step > STEPS.length) return res.redirect('/admin/setup/1');
		const t = req.tournament;
		if (t.status === 'setup' && step > t.setupStep) return res.redirect(`/admin/setup/${t.setupStep}`);
		return renderStep(req, res, step);
	} catch (error) {
		next(error);
	}
};

/** POST /admin/setup/:step */
export const saveStep = async (req, res, next) => {
	try {
		const step = toInt(req.params.step);
		const t = req.tournament;
		if (!step || step < 1 || step > STEPS.length) return res.redirect('/admin/setup/1');
		if (t.status === 'setup' && step > t.setupStep) return res.redirect(`/admin/setup/${t.setupStep}`);

		const locked = await hasAuctionStarted(t);
		const handler = { 1: saveBasics, 2: saveSquad, 3: saveCategories, 4: savePlayerForm, 5: saveTeams, 6: saveRules }[step];
		const result = await handler(req, t, { locked });
		if (result.errors?.length) {
			return renderStep(req, res, step, { data: result.data, errors: result.errors, status: 400 });
		}

		if (t.status === 'setup') {
			if (step === STEPS.length) {
				t.status = 'active';
				t.setupStep = STEPS.length;
				await t.save();
				req.session.success = `${t.name} is ready. Add players, then start the auction!`;
				return res.redirect('/admin/dashboard');
			}
			t.setupStep = Math.max(t.setupStep, step + 1);
			await t.save();
			if (result.warning) req.session.error = result.warning;
			return res.redirect(`/admin/setup/${step + 1}`);
		}

		req.session.success = result.warning ? undefined : `${STEPS[step - 1].title} saved`;
		if (result.warning) req.session.error = result.warning;
		return res.redirect(`/admin/setup/${step}`);
	} catch (error) {
		next(error);
	}
};

async function saveBasics(req, t) {
	const { data, errors } = parseBasics(req.body);
	if (req.uploadError) errors.push(req.uploadError);
	if (errors.length) return { data: { ...data, logo: t.logo }, errors };

	const slugChanged = data.name !== t.name || data.season !== t.season;
	t.set({
		name: data.name,
		shortName: data.shortName,
		season: data.season,
		currency: data.currency,
		venue: data.venue,
		auctionDate: data.auctionDate ? new Date(data.auctionDate) : null,
	});
	if (slugChanged) t.slug = await uniqueSlug(data.name, data.season, t._id);

	let warning;
	try {
		await applyLogo(req, t, data.removeLogo);
	} catch (uploadError) {
		warning = `Saved, but the logo was not uploaded: ${uploadError.message}`;
	}
	await t.save();
	return { warning };
}

// ───────────────────────── Step 2: squad & purse ─────────────────────────

async function saveSquad(req, t, { locked }) {
	const b = req.body;
	const data = {
		teamCount: toInt(b.teamCount),
		squadMin: toInt(b.squadMin),
		squadMax: toInt(b.squadMax),
		purse: toInt(b.purse),
		maxBidPerPlayer: toInt(b.maxBidPerPlayer),
	};
	if (locked) {
		return { data, errors: ['Squad and purse settings are locked because the auction has started. Reset the auction in Settings to change them.'] };
	}

	const errors = [];
	if (data.teamCount === null || data.teamCount < LIMITS.minTeams || data.teamCount > LIMITS.maxTeams) {
		errors.push(`Number of teams must be between ${LIMITS.minTeams} and ${LIMITS.maxTeams}`);
	}
	if (data.squadMax === null || data.squadMax < 1 || data.squadMax > LIMITS.maxSquad) {
		errors.push(`Maximum squad size must be between 1 and ${LIMITS.maxSquad}`);
	}
	if (data.squadMin === null || data.squadMin < 1) errors.push('Minimum squad size must be at least 1');
	if (data.squadMin !== null && data.squadMax !== null && data.squadMin > data.squadMax) {
		errors.push('Minimum squad size cannot be larger than the maximum');
	}
	if (data.purse === null || data.purse < 1) errors.push('Purse per team must be a positive amount');
	if (data.maxBidPerPlayer !== null && (data.maxBidPerPlayer < 1 || data.maxBidPerPlayer > (data.purse || 0))) {
		errors.push('Maximum bid per player must be between 1 and the team purse (leave it blank for no limit)');
	}
	if (errors.length) return { data, errors };

	const requiredRoles = t.roleRequirements.reduce((sum, r) => sum + r.min, 0);
	if (requiredRoles > data.squadMax) {
		return { data, errors: [`Role requirements need ${requiredRoles} players, more than the new maximum squad size`] };
	}

	t.set({
		teamCount: data.teamCount,
		squad: { min: data.squadMin, max: data.squadMax },
		purse: data.purse,
		maxBidPerPlayer: data.maxBidPerPlayer,
	});
	await t.save();
	await syncTeams(t);
	await syncOwnerPlayers(t);
	return {};
}

// ───────────────────────── Step 3: categories & increments ─────────────────────────

async function saveCategories(req, t, { locked }) {
	const rows = rowsOf(req.body.categories);
	const errors = [];

	const parsed = rows
		.map((r, i) => {
			const custom = r.customIncrements === 'on';
			const { slabs, errors: slabErrors } = custom ? parseSlabs(r.slabs) : { slabs: [], errors: [] };
			slabErrors.forEach((e) => errors.push(`${trim(r.name) || `Category ${i + 1}`}: ${e}`));
			return {
				_id: mongoose.isValidObjectId(r.id) ? r.id : undefined,
				name: trim(r.name, 30),
				basePrice: toInt(r.basePrice),
				color: isHexColor(r.color) ? r.color : CATEGORY_COLORS[i % CATEGORY_COLORS.length],
				maxPerTeam: toInt(r.maxPerTeam),
				customIncrements: custom,
				increments: slabs,
			};
		})
		.filter((c) => c.name || c.basePrice !== null);

	const global = parseSlabs(req.body.bidIncrements);
	errors.push(...global.errors);
	const data = { categories: parsed, bidIncrements: global.slabs.length ? global.slabs : rowsOf(req.body.bidIncrements) };

	if (parsed.length === 0) errors.push('Add at least one category');
	if (parsed.length > LIMITS.maxCategories) errors.push(`At most ${LIMITS.maxCategories} categories are allowed`);
	if (global.slabs.length === 0) errors.push('Add at least one bid increment');

	const names = new Set();
	for (const c of parsed) {
		if (!c.name) errors.push('Every category needs a name');
		else if (names.has(c.name.toLowerCase())) errors.push(`Category name "${c.name}" is used twice`);
		names.add(c.name.toLowerCase());
		if (c.basePrice === null || c.basePrice < 1) errors.push(`${c.name || 'A category'} needs a base price of at least 1`);
		if (c.maxPerTeam !== null && (c.maxPerTeam < 0 || c.maxPerTeam > t.squad.max)) {
			errors.push(`${c.name}: the per-team limit must be between 0 and the squad size (${t.squad.max})`);
		}
		if (c.customIncrements && c.increments.length === 0) errors.push(`${c.name}: add at least one custom increment or turn custom increments off`);
	}

	const limited = parsed.filter((c) => c.maxPerTeam !== null);
	if (parsed.length && limited.length === parsed.length) {
		const capacity = limited.reduce((sum, c) => sum + c.maxPerTeam, 0);
		if (capacity < t.squad.min) {
			errors.push(`With these per-team limits a team can buy at most ${capacity} players, fewer than the minimum squad of ${t.squad.min}`);
		}
	}

	// Categories that disappeared must not have players in them.
	const keptIds = new Set(parsed.filter((c) => c._id).map((c) => String(c._id)));
	for (const existing of t.categories) {
		if (keptIds.has(String(existing._id))) continue;
		const inUse = await Player.countDocuments({ tournament: t._id, category: existing._id });
		if (inUse) errors.push(`Category "${existing.name}" has ${inUse} player(s). Move them to another category before removing it.`);
	}

	if (locked) {
		const sameSet = keptIds.size === t.categories.length && parsed.every((c) => c._id);
		if (!sameSet) errors.push('Categories cannot be added or removed after the auction has started');
		for (const c of parsed) {
			const existing = c._id && t.categories.id(c._id);
			if (existing && (existing.basePrice !== c.basePrice || (existing.maxPerTeam ?? null) !== c.maxPerTeam)) {
				errors.push(`${existing.name}: base price and per-team limit are locked after the auction has started`);
			}
		}
	}

	if (errors.length) return { data, errors: [...new Set(errors)] };

	t.categories = parsed.map(({ customIncrements, ...c }) => c);
	t.bidIncrements = global.slabs;
	await t.save();
	return {};
}

// ───────────────────────── Step 4: player form & roles ─────────────────────────

async function savePlayerForm(req, t, { locked }) {
	const b = req.body;
	const roles = [...new Set(String(b.roles || '').split(/\r?\n/).map((r) => trim(r, 40)).filter(Boolean))];
	const roleRequirements = rowsOf(b.roleRequirements)
		.map((r) => ({ role: trim(r.role, 40), min: toInt(r.min) }))
		.filter((r) => r.role || r.min !== null);
	const playerFields = Object.fromEntries(
		Object.keys(PLAYER_FIELDS).map((key) => [key, FIELD_MODES.includes(b.playerFields?.[key]) ? b.playerFields[key] : 'optional'])
	);
	const data = { roles, roleRequirements, playerFields };

	const errors = [];
	if (roles.length === 0) errors.push('Add at least one player role');
	const seen = new Set();
	for (const r of roleRequirements) {
		if (!roles.includes(r.role)) errors.push(`"${r.role || '(blank)'}" is not one of the roles listed`);
		if (r.min === null || r.min < 1) errors.push(`${r.role}: the minimum must be at least 1`);
		if (seen.has(r.role)) errors.push(`${r.role} has two requirement rows`);
		seen.add(r.role);
	}
	const required = roleRequirements.reduce((sum, r) => sum + (r.min || 0), 0);
	if (required > t.squad.max) errors.push(`Role requirements need ${required} players, more than the maximum squad size (${t.squad.max})`);

	const removedRoles = (t.roles || []).filter((r) => !roles.includes(r));
	if (removedRoles.length) {
		const inUse = await Player.countDocuments({ tournament: t._id, role: { $in: removedRoles } });
		if (inUse) errors.push(`${inUse} player(s) use a role you removed (${removedRoles.join(', ')}). Change their role first.`);
	}

	if (locked) {
		const before = JSON.stringify(t.roleRequirements.map((r) => [r.role, r.min]));
		const after = JSON.stringify(roleRequirements.map((r) => [r.role, r.min]));
		if (before !== after) errors.push('Role requirements are locked after the auction has started');
	}

	if (errors.length) return { data, errors: [...new Set(errors)] };

	t.set({ roles, roleRequirements, playerFields });
	await t.save();
	return {};
}

// ───────────────────────── Step 5: teams & owners ─────────────────────────

async function saveTeams(req, t, { locked }) {
	const teams = await Team.find({ tournament: t._id }).sort('order');
	const input = req.body.teams || {};
	const errors = [];
	if (req.uploadError) errors.push(req.uploadError);

	const updates = teams.map((team) => {
		const row = input[String(team._id)] || {};
		return {
			team,
			name: trim(row.name, 60),
			shortName: trim(row.shortName, 6).toUpperCase(),
			color: isHexColor(row.color) ? row.color : team.color,
			ownerName: trim(row.ownerName, 80),
			ownerRole: trim(row.ownerRole, 40),
			// Locked after the auction starts: it changes squad counts and purses.
			ownerPlays: locked ? Boolean(team.owner?.isPlaying) : row.ownerPlays === 'on',
			removeLogo: row.removeLogo === 'on',
			removeOwnerPhoto: row.removeOwnerPhoto === 'on',
		};
	});

	const names = new Set();
	for (const u of updates) {
		const label = `Team ${u.team.order}`;
		if (!u.name) errors.push(`${label} needs a name`);
		else if (names.has(u.name.toLowerCase())) errors.push(`Two teams are called "${u.name}"`);
		names.add(u.name.toLowerCase());
		if (u.ownerPlays && !u.ownerName) errors.push(`${u.name || label}: enter the owner's name, or untick "Owner plays"`);
		if (u.ownerRole && !t.roles.includes(u.ownerRole)) errors.push(`${u.name || label}: pick the owner's role from the list`);
	}

	const data = {
		teams: updates.map((u) => ({
			_id: u.team._id,
			order: u.team.order,
			name: u.name,
			shortName: u.shortName,
			color: u.color,
			logo: u.team.logo,
			owner: { name: u.ownerName, role: u.ownerRole, isPlaying: u.ownerPlays, photo: u.team.owner?.photo },
		})),
	};
	if (errors.length) return { data, errors: [...new Set(errors)] };

	const uploadProblems = [];
	for (const u of updates) {
		const { team } = u;
		team.name = u.name;
		team.shortName = u.shortName;
		team.color = u.color;
		team.owner.name = u.ownerName;
		team.owner.role = u.ownerRole;
		team.owner.isPlaying = u.ownerPlays;

		const logoFile = fileFor(req, `logo_${team._id}`);
		const photoFile = fileFor(req, `ownerPhoto_${team._id}`);
		try {
			if (logoFile) {
				const uploaded = await uploadImage(logoFile.buffer, { tournamentId: t._id, kind: 'teams' });
				await deleteImage(team.logo?.publicId);
				team.logo = uploaded;
			} else if (u.removeLogo && team.logo?.publicId) {
				await deleteImage(team.logo.publicId);
				team.logo = undefined;
			}
			if (photoFile) {
				const uploaded = await uploadImage(photoFile.buffer, { tournamentId: t._id, kind: 'owners' });
				await deleteImage(team.owner.photo?.publicId);
				team.owner.photo = uploaded;
			} else if (u.removeOwnerPhoto && team.owner.photo?.publicId) {
				await deleteImage(team.owner.photo.publicId);
				team.owner.photo = undefined;
			}
		} catch (uploadError) {
			uploadProblems.push(`${team.name}: ${uploadError.message}`);
		}
		await team.save();
	}

	await syncOwnerPlayers(t);
	return uploadProblems.length ? { warning: `Teams saved, but some images were not uploaded. ${uploadProblems[0]}` } : {};
}

// ───────────────────────── Step 6: rules & finish ─────────────────────────

async function saveRules(req, t) {
	const unsoldPolicy = UNSOLD_POLICIES[req.body.unsoldPolicy] ? req.body.unsoldPolicy : 'requeue';
	const errors = [];
	if (t.categories.length === 0) errors.push('Add at least one category in step 3 before finishing');
	if (errors.length) return { data: { unsoldPolicy }, errors };

	t.unsoldPolicy = unsoldPolicy;
	await t.save();
	return {};
}
