import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import Player from '../models/Player.js';
import { getBiddingBoard, getPlayerCounts } from '../services/standings.js';
import { slugify } from '../utils/format.js';
import { pdfImageUrl } from '../services/cloudinary.js';
import { drawCatalogue, drawHeader, drawTeamSquad, fetchImages } from '../services/pdf.js';

const fileName = (tournament, suffix, ext) => `${slugify(tournament.shortName || tournament.name) || 'tournament'}-${suffix}.${ext}`;

const sendWorkbook = async (res, workbook, name) => {
	res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
	res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
	await workbook.xlsx.write(res);
	res.end();
};

const styleHeader = (row, argb) => {
	row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
	row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
};

const argbOf = (hex) => `FF${String(hex || '#4472C4').replace('#', '').toUpperCase()}`;

/** GET /admin/reports */
export const showReportsDashboard = async (req, res, next) => {
	try {
		const t = req.tournament;
		const [soldPlayers, board, counts] = await Promise.all([
			Player.find({ tournament: t._id, isOwner: false, status: 'sold' }).populate('soldTo', 'name color').sort({ soldPrice: -1 }).lean(),
			getBiddingBoard(t),
			getPlayerCounts(t),
		]);

		const totalValue = soldPlayers.reduce((sum, p) => sum + p.soldPrice, 0);
		const categoryBreakdown = t.categories.map((c) => {
			const inCategory = soldPlayers.filter((p) => String(p.category) === String(c._id));
			const total = inCategory.reduce((sum, p) => sum + p.soldPrice, 0);
			return {
				category: c,
				sold: inCategory.length,
				total,
				avg: inCategory.length ? total / inCategory.length : 0,
				highest: inCategory[0]?.soldPrice || 0,
			};
		});

		res.render('admin/reports', {
			title: 'Reports',
			soldPlayers,
			teams: board.teams,
			stats: {
				soldCount: counts.sold,
				poolCount: counts.pool,
				totalValue,
				avgPrice: soldPlayers.length ? totalValue / soldPlayers.length : 0,
				highestSale: soldPlayers[0] || null,
			},
			categoryBreakdown,
		});
	} catch (error) {
		next(error);
	}
};

/** GET /admin/reports/export/sold-players */
export const exportSoldPlayersExcel = async (req, res, next) => {
	try {
		const t = req.tournament;
		const players = await Player.find({ tournament: t._id, isOwner: false, status: 'sold' })
			.populate('soldTo', 'name')
			.sort({ soldPrice: -1 })
			.lean();

		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet('Sold Players');
		sheet.columns = [
			{ header: 'Player #', key: 'number', width: 10 },
			{ header: 'Name', key: 'name', width: 26 },
			{ header: 'Role', key: 'role', width: 22 },
			{ header: 'Phone', key: 'phone', width: 16 },
			{ header: 'Category', key: 'category', width: 14 },
			{ header: 'Base Price', key: 'basePrice', width: 14 },
			{ header: 'Sold Price', key: 'soldPrice', width: 14 },
			{ header: 'Team', key: 'team', width: 24 },
			{ header: '× Base', key: 'multiple', width: 10 },
		];
		styleHeader(sheet.getRow(1), 'FF4472C4');

		for (const p of players) {
			const category = t.getCategory(p.category);
			const base = category?.basePrice || 0;
			sheet.addRow({
				number: p.playerNumber,
				name: p.name,
				role: p.role,
				phone: p.phone,
				category: category?.name || '',
				basePrice: base,
				soldPrice: p.soldPrice,
				team: p.soldTo?.name || '',
				multiple: base ? Number((p.soldPrice / base).toFixed(2)) : '',
			});
		}
		const total = sheet.addRow({ name: 'TOTAL', soldPrice: players.reduce((sum, p) => sum + p.soldPrice, 0) });
		total.font = { bold: true };

		await sendWorkbook(res, workbook, fileName(t, 'sold-players', 'xlsx'));
	} catch (error) {
		next(error);
	}
};

/** GET /admin/reports/export/unsold-players — everyone still in the pool. */
export const exportUnsoldPlayersExcel = async (req, res, next) => {
	try {
		const t = req.tournament;
		const players = await Player.find({ tournament: t._id, isOwner: false, status: { $in: ['available', 'unsold', 'withdrawn'] } })
			.sort({ playerNumber: 1 })
			.lean();

		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet('Not Sold');
		sheet.columns = [
			{ header: 'Player #', key: 'number', width: 10 },
			{ header: 'Name', key: 'name', width: 26 },
			{ header: 'Role', key: 'role', width: 22 },
			{ header: 'Phone', key: 'phone', width: 16 },
			{ header: 'Category', key: 'category', width: 14 },
			{ header: 'Base Price', key: 'basePrice', width: 14 },
			{ header: 'Status', key: 'status', width: 14 },
		];
		styleHeader(sheet.getRow(1), 'FFE74C3C');

		const statusLabel = { available: 'Not auctioned yet', unsold: 'Unsold', withdrawn: 'Withdrawn' };
		for (const p of players) {
			const category = t.getCategory(p.category);
			sheet.addRow({
				number: p.playerNumber,
				name: p.name,
				role: p.role,
				phone: p.phone,
				category: category?.name || '',
				basePrice: category?.basePrice || 0,
				status: statusLabel[p.status] || p.status,
			});
		}

		await sendWorkbook(res, workbook, fileName(t, 'players-not-sold', 'xlsx'));
	} catch (error) {
		next(error);
	}
};

/** GET /admin/reports/export/team-sheets — one sheet per squad plus a summary. */
export const exportTeamSheetsExcel = async (req, res, next) => {
	try {
		const t = req.tournament;
		const [board, squadPlayers] = await Promise.all([
			getBiddingBoard(t),
			Player.find({ tournament: t._id, status: 'sold' }).sort({ isOwner: -1, soldAt: 1 }).lean(),
		]);

		const workbook = new ExcelJS.Workbook();
		const usedNames = new Set();
		for (const team of board.teams) {
			// Excel sheet names: max 31 chars, unique, no []:*?/\
			let sheetName = team.name.replace(/[[\]:*?/\\]/g, '').slice(0, 28) || `Team ${team.order}`;
			while (usedNames.has(sheetName)) sheetName = `${sheetName.slice(0, 26)}-${usedNames.size}`;
			usedNames.add(sheetName);

			const sheet = workbook.addWorksheet(sheetName);
			sheet.mergeCells('A1:F1');
			const title = sheet.getCell('A1');
			title.value = team.name.toUpperCase();
			title.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
			title.alignment = { horizontal: 'center' };
			title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbOf(team.color) } };

			sheet.getCell('A3').value = 'Owner';
			sheet.getCell('B3').value = team.owner?.name ? `${team.owner.name}${team.owner.isPlaying ? ' (plays)' : ''}` : '—';
			sheet.getCell('A4').value = 'Players';
			sheet.getCell('B4').value = `${team.playersCount}/${t.squad.max}`;
			sheet.getCell('A5').value = 'Spent';
			sheet.getCell('B5').value = team.spent;
			sheet.getCell('A6').value = 'Remaining';
			sheet.getCell('B6').value = team.remainingPurse;

			const header = sheet.getRow(8);
			header.values = ['#', 'Player', 'Role', 'Category', 'Base Price', 'Price Paid'];
			header.font = { bold: true };
			header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

			squadPlayers
				.filter((p) => String(p.soldTo) === String(team._id))
				.forEach((p, i) => {
					const category = t.getCategory(p.category);
					sheet.addRow([i + 1, p.isOwner ? `${p.name} (Owner)` : p.name, p.role, category?.name || '—', category?.basePrice || '', p.isOwner ? 'Free' : p.soldPrice]);
				});

			sheet.columns.forEach((col, i) => {
				col.width = [6, 28, 22, 14, 14, 14][i];
			});
		}

		const summary = workbook.addWorksheet('Summary');
		summary.columns = [
			{ header: 'Team', key: 'team', width: 26 },
			{ header: 'Owner', key: 'owner', width: 22 },
			{ header: 'Players', key: 'players', width: 10 },
			{ header: 'Spent', key: 'spent', width: 14 },
			{ header: 'Remaining', key: 'remaining', width: 14 },
		];
		summary.getRow(1).font = { bold: true };
		board.teams.forEach((team) =>
			summary.addRow({
				team: team.name,
				owner: team.owner?.name || '',
				players: `${team.playersCount}/${t.squad.max}`,
				spent: team.spent,
				remaining: team.remainingPurse,
			})
		);

		await sendWorkbook(res, workbook, fileName(t, 'team-sheets', 'xlsx'));
	} catch (error) {
		next(error);
	}
};

const startPdf = (res, name) => {
	const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: false });
	res.setHeader('Content-Type', 'application/pdf');
	res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
	doc.pipe(res);
	return doc;
};

const squadsFor = (tournament) =>
	Player.find({ tournament: tournament._id, status: 'sold' }).sort({ isOwner: -1, soldAt: 1 }).lean();

/** Photos and logos for a set of teams' squads, keyed by player/team id. */
async function squadImages(tournament, teams, players) {
	const entries = [
		...players.filter((p) => p.photo?.url).map((p) => [String(p._id), pdfImageUrl(p.photo, 'photo')]),
		...teams.filter((t) => t.logo?.url).map((t) => [`team:${t._id}`, pdfImageUrl(t.logo, 'logo')]),
	];
	if (tournament.logo?.url) entries.push(['tournament', pdfImageUrl(tournament.logo, 'logo')]);
	return fetchImages(entries);
}

/** GET /admin/reports/team-pdf/:teamId — squad sheet for one team. */
export const generateTeamPDF = async (req, res, next) => {
	try {
		const t = req.tournament;
		if (!mongoose.isValidObjectId(req.params.teamId)) return res.status(404).send('Team not found');
		const board = await getBiddingBoard(t);
		const team = board.teams.find((x) => String(x._id) === req.params.teamId);
		if (!team) return res.status(404).send('Team not found');

		const squad = (await squadsFor(t)).filter((p) => String(p.soldTo) === String(team._id));
		const images = await squadImages(t, [team], squad);

		const doc = startPdf(res, `${slugify(team.name) || 'team'}-squad.pdf`);
		drawHeader(doc, t, { title: 'Squad sheet', logo: images.get('tournament') });
		drawTeamSquad(doc, t, team, squad, { logo: images.get(`team:${team._id}`), photos: images });
		doc.end();
	} catch (error) {
		next(error);
	}
};

/** GET /admin/reports/squads.pdf — every team's squad, one team per page. */
export const exportAllSquadsPDF = async (req, res, next) => {
	try {
		const t = req.tournament;
		const [board, players] = await Promise.all([getBiddingBoard(t), squadsFor(t)]);
		const images = await squadImages(t, board.teams, players);

		const doc = startPdf(res, fileName(t, 'squads', 'pdf'));
		board.teams.forEach((team, index) => {
			if (index > 0) doc.addPage();
			drawHeader(doc, t, { title: 'Squad sheet', logo: images.get('tournament') });
			const squad = players.filter((p) => String(p.soldTo) === String(team._id));
			drawTeamSquad(doc, t, team, squad, { logo: images.get(`team:${team._id}`), photos: images });
		});
		doc.end();
	} catch (error) {
		next(error);
	}
};

/**
 * GET /admin/reports/catalogue.pdf — printable list of every player still
 * in the auction (or all players with ?all=1), grouped by category.
 */
export const exportPlayerCataloguePDF = async (req, res, next) => {
	try {
		const t = req.tournament;
		const includeAll = req.query.all === '1';
		const players = await Player.find({
			tournament: t._id,
			isOwner: false,
			status: includeAll ? { $ne: 'withdrawn' } : { $in: ['available', 'unsold'] },
		})
			.sort({ playerNumber: 1 })
			.lean();

		const entries = players.filter((p) => p.photo?.url).map((p) => [String(p._id), pdfImageUrl(p.photo, 'photo')]);
		if (t.logo?.url) entries.push(['tournament', pdfImageUrl(t.logo, 'logo')]);
		const images = await fetchImages(entries);

		const doc = startPdf(res, fileName(t, includeAll ? 'all-players' : 'player-catalogue', 'pdf'));
		drawHeader(doc, t, {
			title: includeAll ? 'All players' : 'Player catalogue',
			subtitle: `${players.length} player${players.length === 1 ? '' : 's'}${t.venue ? ` · ${t.venue}` : ''}`,
			logo: images.get('tournament'),
		});
		drawCatalogue(doc, t, players, images);
		doc.end();
	} catch (error) {
		next(error);
	}
};
