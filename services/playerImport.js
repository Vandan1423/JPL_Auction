import { Readable } from 'stream';
import ExcelJS from 'exceljs';
import { JERSEY_SIZES } from '../config/constants.js';

// Column headers we recognise, including the wording Google Forms exports
// typically use ("Full Name", "Mobile Number", "Playing role", …).
const HEADER_ALIASES = {
	name: ['name', 'player name', 'full name', 'player', 'your name', 'player full name'],
	role: ['role', 'player role', 'playing role', 'player type', 'type', 'speciality', 'specialty', 'skill'],
	category: ['category', 'cat', 'grade', 'tier', 'group'],
	phone: ['phone', 'phone number', 'mobile', 'mobile number', 'mobile no', 'contact', 'contact number', 'whatsapp', 'whatsapp number'],
	jerseySize: ['jersey size', 'tshirt size', 't shirt size', 'shirt size', 'size'],
	jerseyNumber: ['jersey number', 'jersey no', 'shirt number', 'number on jersey'],
	age: ['age'],
};

export const FIELD_LABELS = {
	name: 'Name',
	role: 'Role',
	category: 'Category',
	phone: 'Phone',
	jerseySize: 'Jersey size',
	jerseyNumber: 'Jersey number',
	age: 'Age',
};

const normalize = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Which player field a header belongs to (exact alias first, then "contains"). */
export function fieldForHeader(header) {
	const h = normalize(header);
	if (!h) return null;
	for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
		if (aliases.includes(h)) return field;
	}
	for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
		if (aliases.some((alias) => alias.length > 3 && ` ${h} `.includes(` ${alias} `))) return field;
	}
	return null;
}

/**
 * Match free text to one of the allowed options, ignoring case and
 * punctuation ("wicket keeper batsman" → "Wicket-Keeper Batsman"). Falls back
 * to a unique partial match; returns { value } or { error }.
 */
export function matchOption(input, options, label) {
	const wanted = normalize(input).replace(/ /g, '');
	if (!wanted) return { value: '' };
	const squash = (o) => normalize(o).replace(/ /g, '');
	const exact = options.find((o) => squash(o) === wanted);
	if (exact) return { value: exact };
	const partial = options.filter((o) => squash(o).includes(wanted) || wanted.includes(squash(o)));
	if (partial.length === 1) return { value: partial[0] };
	if (partial.length > 1) return { error: `${label} "${input}" could mean ${partial.join(' or ')}` };
	return { error: `${label} "${input}" is not one of: ${options.join(', ')}` };
}

const cellText = (cell) => String(cell?.text ?? '').replace(/\s+/g, ' ').trim();

/**
 * Read an uploaded .xlsx or .csv into header mapping + raw rows.
 * @returns {Promise<{ columns: Object<string, string>, rows: { row: number, values: Object<string, string> }[] }>}
 */
export async function readPlayerSheet(file) {
	const workbook = new ExcelJS.Workbook();
	const name = (file.originalname || '').toLowerCase();
	const isCsv = name.endsWith('.csv') || /csv|text\/plain/.test(file.mimetype || '');

	try {
		if (isCsv) await workbook.csv.read(Readable.from([file.buffer.toString('utf8').replace(/^﻿/, '')]));
		else await workbook.xlsx.load(file.buffer);
	} catch {
		const error = new Error('That file could not be read. Save it as .xlsx or .csv and try again.');
		error.status = 400;
		throw error;
	}

	const sheet = workbook.worksheets.find((ws) => ws.name !== 'Options') || workbook.worksheets[0];
	if (!sheet) return { columns: {}, rows: [] };

	const width = sheet.columnCount;
	const readRow = (row) => Array.from({ length: width }, (_, i) => cellText(row.getCell(i + 1)));

	// The header row is the first of the top 10 rows that has a "name" column.
	let headerRowNumber = null;
	let fieldByColumn = [];
	for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
		const fields = readRow(sheet.getRow(r)).map(fieldForHeader);
		if (fields.includes('name')) {
			headerRowNumber = r;
			// If two columns map to the same field, keep the first.
			const seen = new Set();
			fieldByColumn = fields.map((f) => (f && !seen.has(f) ? (seen.add(f), f) : null));
			break;
		}
	}
	if (!headerRowNumber) {
		const error = new Error('Could not find a header row with a "Name" column. Use the template, or make sure the first row has column names.');
		error.status = 400;
		throw error;
	}

	const headers = readRow(sheet.getRow(headerRowNumber));
	const columns = {};
	fieldByColumn.forEach((field, i) => {
		if (field) columns[field] = headers[i];
	});

	const rows = [];
	for (let r = headerRowNumber + 1; r <= sheet.rowCount; r++) {
		const cells = readRow(sheet.getRow(r));
		if (cells.every((c) => !c)) continue;
		const values = {};
		fieldByColumn.forEach((field, i) => {
			if (field) values[field] = cells[i];
		});
		rows.push({ row: r, values });
	}
	return { columns, rows };
}

/** An .xlsx template with dropdowns built from this tournament's settings. */
export function buildTemplate(tournament) {
	const fields = tournament.playerFields || {};
	const visible = (key) => (fields[key] || 'optional') !== 'hidden';
	const required = (key) => fields[key] === 'required';

	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Players', { views: [{ state: 'frozen', ySplit: 1 }] });
	const options = workbook.addWorksheet('Options');

	const columns = [
		{ key: 'name', header: 'Name *', width: 28 },
		{ key: 'role', header: 'Role *', width: 26 },
		{ key: 'category', header: 'Category *', width: 16 },
	];
	if (visible('phone')) columns.push({ key: 'phone', header: `Phone${required('phone') ? ' *' : ''}`, width: 18 });
	if (visible('jerseySize')) columns.push({ key: 'jerseySize', header: `Jersey size${required('jerseySize') ? ' *' : ''}`, width: 14 });
	if (visible('jerseyNumber')) columns.push({ key: 'jerseyNumber', header: `Jersey number${required('jerseyNumber') ? ' *' : ''}`, width: 15 });
	if (visible('age')) columns.push({ key: 'age', header: `Age${required('age') ? ' *' : ''}`, width: 8 });
	sheet.columns = columns;

	const header = sheet.getRow(1);
	header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
	header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };

	// Lists for the dropdowns live on a second sheet.
	options.columns = [
		{ header: 'Roles', key: 'role', width: 26 },
		{ header: 'Categories', key: 'category', width: 16 },
		{ header: 'Base price', key: 'price', width: 14 },
		{ header: 'Jersey sizes', key: 'size', width: 14 },
	];
	options.getRow(1).font = { bold: true };
	const longest = Math.max(tournament.roles.length, tournament.categories.length, JERSEY_SIZES.length);
	for (let i = 0; i < longest; i++) {
		options.addRow({
			role: tournament.roles[i] || null,
			category: tournament.categories[i]?.name || null,
			price: tournament.categories[i]?.basePrice ?? null,
			size: JERSEY_SIZES[i] || null,
		});
	}

	const lastRow = 1000;
	const listFor = (key, letter, count) => {
		const index = columns.findIndex((c) => c.key === key);
		if (index === -1 || count === 0) return;
		const col = sheet.getColumn(index + 1).letter;
		for (let r = 2; r <= lastRow; r++) {
			sheet.getCell(`${col}${r}`).dataValidation = {
				type: 'list',
				allowBlank: true,
				formulae: [`Options!$${letter}$2:$${letter}$${count + 1}`],
				showErrorMessage: true,
				errorTitle: 'Pick from the list',
				error: 'Choose a value from the dropdown.',
			};
		}
	};
	listFor('role', 'A', tournament.roles.length);
	listFor('category', 'B', tournament.categories.length);
	listFor('jerseySize', 'D', JERSEY_SIZES.length);

	// Keep phone numbers as text so Excel doesn't turn them into 9.88E+09.
	const phoneIndex = columns.findIndex((c) => c.key === 'phone');
	if (phoneIndex !== -1) sheet.getColumn(phoneIndex + 1).numFmt = '@';

	return workbook;
}
