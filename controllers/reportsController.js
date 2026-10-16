import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import Player from '../models/Player.js';
import { getBiddingBoard, getPlayerCounts } from '../services/standings.js';
import { formatMoney, slugify } from '../utils/format.js';

// PDFKit's built-in fonts have no ₹ glyph, so PDFs spell it out.
const pdfMoney = (amount, currency) => formatMoney(amount, currency).replace('₹', 'Rs. ');

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
					sheet.addRow([i + 1, p.isOwner ? `${p.name} (Owner)` : p.name, p.role, category?.name || '—', category?.basePrice || '', p.soldPrice]);
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

/** GET /admin/reports/team-pdf/:teamId — squad sheet for one team. */
export const generateTeamPDF = async (req, res, next) => {
	try {
		const t = req.tournament;
		if (!mongoose.isValidObjectId(req.params.teamId)) return res.status(404).send('Team not found');
		const board = await getBiddingBoard(t);
		const team = board.teams.find((x) => String(x._id) === req.params.teamId);
		if (!team) return res.status(404).send('Team not found');

		const squad = await Player.find({ tournament: t._id, soldTo: team._id, status: 'sold' }).sort({ isOwner: -1, soldAt: 1 }).lean();

		const doc = new PDFDocument({ size: 'A4', margin: 50 });
		res.setHeader('Content-Type', 'application/pdf');
		res.setHeader('Content-Disposition', `attachment; filename="${slugify(team.name) || 'team'}-squad.pdf"`);
		doc.pipe(res);

		doc.fontSize(22).font('Helvetica-Bold').fillColor('#111827').text(t.name.toUpperCase(), { align: 'center' });
		if (t.season) doc.fontSize(11).font('Helvetica').fillColor('#6B7280').text(t.season, { align: 'center' });
		doc.moveDown(0.6);
		doc.fontSize(18).font('Helvetica-Bold').fillColor(team.color || '#111827').text(team.name.toUpperCase(), { align: 'center' });
		doc.moveDown(1);

		doc.fontSize(11).fillColor('black').font('Helvetica');
		if (team.owner?.name) doc.text(`Owner: ${team.owner.name}${team.owner.isPlaying ? ' (plays)' : ''}`);
		doc.text(`Squad: ${team.playersCount}/${t.squad.max}`);
		doc.text(`Spent: ${pdfMoney(team.spent, t.currency)}`);
		doc.text(`Remaining purse: ${pdfMoney(team.remainingPurse, t.currency)}`);
		doc.moveDown(1);
		doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
		doc.moveDown(0.8);

		const columns = [
			{ label: '#', x: 50, width: 25 },
			{ label: 'Player', x: 80, width: 170 },
			{ label: 'Role', x: 255, width: 120 },
			{ label: 'Category', x: 380, width: 70 },
			{ label: 'Price', x: 455, width: 90 },
		];
		const drawRow = (values, bold = false) => {
			if (doc.y > 760) doc.addPage();
			const y = doc.y;
			doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
			columns.forEach((c, i) => doc.text(String(values[i] ?? ''), c.x, y, { width: c.width, ellipsis: true, lineBreak: false }));
			doc.y = y + 18;
		};

		drawRow(columns.map((c) => c.label), true);
		squad.forEach((p, i) => {
			drawRow([
				i + 1,
				p.isOwner ? `${p.name} (Owner)` : p.name,
				p.role || '',
				t.getCategory(p.category)?.name || '—',
				pdfMoney(p.soldPrice, t.currency),
			]);
		});

		doc.end();
	} catch (error) {
		next(error);
	}
};
