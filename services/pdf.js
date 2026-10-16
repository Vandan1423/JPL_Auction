// PDF layouts for the downloads on the Reports page. Documents are streamed
// straight to the browser; nothing is written to disk.
import { formatMoney } from '../utils/format.js';

// PDFKit's built-in fonts have no ₹ glyph, so PDFs spell it out.
export const pdfMoney = (amount, currency) => formatMoney(amount, currency).replace('₹', 'Rs. ');

const GRAY_900 = '#111827';
const GRAY_500 = '#6B7280';
const GRAY_200 = '#E5E7EB';

/** Dark or white text, whichever reads better on `hex`. */
function textOn(hex) {
	const value = String(hex || '').replace('#', '');
	if (value.length !== 6) return '#FFFFFF';
	const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
	const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return luminance > 0.6 ? GRAY_900 : '#FFFFFF';
}

/**
 * Download images for embedding (JPEG/PNG only). Failures are skipped so a
 * missing photo just falls back to the player's initial.
 * @param {[string, string][]} entries [key, url] pairs
 * @returns {Promise<Map<string, Buffer>>}
 */
export async function fetchImages(entries, { concurrency = 6, timeoutMs = 8000 } = {}) {
	const images = new Map();
	const queue = entries.filter(([, url]) => url);
	let next = 0;

	async function worker() {
		while (next < queue.length) {
			const [key, url] = queue[next++];
			try {
				const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
				const type = res.headers.get('content-type') || '';
				if (res.ok && /image\/(jpe?g|png)/.test(type)) images.set(key, Buffer.from(await res.arrayBuffer()));
			} catch {
				// Unreachable or slow image: leave it out.
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
	return images;
}

const bounds = (doc) => ({
	left: doc.page.margins.left,
	right: doc.page.width - doc.page.margins.right,
	top: doc.page.margins.top,
	bottom: doc.page.height - doc.page.margins.bottom,
	width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
});

/** Round photo, or a coloured circle with the initial when there is none. */
function drawAvatar(doc, { cx, cy, r, image, name, color }) {
	if (image) {
		try {
			doc.save();
			doc.circle(cx, cy, r).clip();
			doc.image(image, cx - r, cy - r, { width: r * 2, height: r * 2 });
			doc.restore();
			return;
		} catch {
			doc.restore();
		}
	}
	doc.save();
	doc.circle(cx, cy, r).fill(color || '#6366F1');
	doc.fillColor(textOn(color || '#6366F1'))
		.font('Helvetica-Bold')
		.fontSize(r)
		.text((name || '?').charAt(0).toUpperCase(), cx - r, cy - r * 0.55, { width: r * 2, align: 'center', lineBreak: false });
	doc.restore();
}

/** Tournament name, logo and document title across the top of the first page. */
export function drawHeader(doc, tournament, { title, subtitle = '', logo = null }) {
	const b = bounds(doc);
	let x = b.left;
	if (logo) {
		try {
			doc.image(logo, x, b.top, { fit: [48, 48] });
			x += 60;
		} catch {
			// Unreadable logo: skip it.
		}
	}
	doc.font('Helvetica-Bold').fontSize(18).fillColor(GRAY_900)
		.text(tournament.name.toUpperCase(), x, b.top + 2, { width: b.right - x, lineBreak: false, ellipsis: true });
	doc.font('Helvetica').fontSize(10).fillColor(GRAY_500)
		.text([tournament.season, title].filter(Boolean).join(' · '), x, b.top + 26, { width: b.right - x, lineBreak: false });
	if (subtitle) doc.text(subtitle, x, b.top + 40, { width: b.right - x, lineBreak: false });
	doc.moveTo(b.left, b.top + 60).lineTo(b.right, b.top + 60).lineWidth(1).strokeColor(GRAY_200).stroke();
	doc.y = b.top + 74;
}

/**
 * Player catalogue: every player grouped by category (most expensive first),
 * three cards per row with photo, number, role and details.
 */
export function drawCatalogue(doc, tournament, players, photos) {
	const b = bounds(doc);
	const columns = 3;
	const gap = 10;
	const cardW = (b.width - gap * (columns - 1)) / columns;
	const cardH = 74;
	const categories = [...tournament.categories].sort((a, b2) => b2.basePrice - a.basePrice);

	for (const category of categories) {
		const group = players.filter((p) => String(p.category) === String(category._id));
		if (!group.length) continue;

		if (doc.y + 30 + cardH > b.bottom) doc.addPage();
		const barY = doc.y;
		doc.roundedRect(b.left, barY, b.width, 22, 4).fill(category.color || '#6366F1');
		doc.fillColor(textOn(category.color)).font('Helvetica-Bold').fontSize(10.5)
			.text(`${category.name}   ·   Base price ${pdfMoney(category.basePrice, tournament.currency)}   ·   ${group.length} player${group.length === 1 ? '' : 's'}`,
				b.left + 10, barY + 6.5, { width: b.width - 20, lineBreak: false });
		// doc.text() moves doc.y, so the grid keeps its own row position.
		let rowY = barY + 30;

		group.forEach((player, index) => {
			const col = index % columns;
			if (col === 0 && index > 0) rowY += cardH + gap;
			if (col === 0 && rowY + cardH > b.bottom) {
				doc.addPage();
				rowY = bounds(doc).top;
			}
			const x = b.left + col * (cardW + gap);
			const y = rowY;

			doc.roundedRect(x, y, cardW, cardH, 6).lineWidth(0.8).fillAndStroke('#FFFFFF', GRAY_200);
			drawAvatar(doc, { cx: x + 32, cy: y + cardH / 2, r: 22, image: photos.get(String(player._id)), name: player.name, color: category.color });

			const tx = x + 62;
			const tw = cardW - 70;
			doc.fillColor(GRAY_500).font('Helvetica').fontSize(8).text(`#${player.playerNumber}`, tx, y + 12, { width: tw, lineBreak: false });
			doc.fillColor(GRAY_900).font('Helvetica-Bold').fontSize(10.5).text(player.name, tx, y + 23, { width: tw, lineBreak: false, ellipsis: true });
			doc.fillColor(GRAY_500).font('Helvetica').fontSize(8.5).text(player.role || '', tx, y + 38, { width: tw, lineBreak: false, ellipsis: true });
			const details = [
				player.age ? `Age ${player.age}` : '',
				player.jerseySize ? `Size ${player.jerseySize}` : '',
				player.jerseyNumber ? `No. ${player.jerseyNumber}` : '',
			].filter(Boolean).join('  ·  ');
			if (details) doc.fontSize(7.5).text(details, tx, y + 51, { width: tw, lineBreak: false, ellipsis: true });
		});
		doc.y = rowY + cardH + 18;
	}

	if (!players.length) {
		doc.fillColor(GRAY_500).font('Helvetica').fontSize(12).text('No players registered yet.', b.left, doc.y);
	}
}

/** One team's squad sheet. Starts at the current page position. */
export function drawTeamSquad(doc, tournament, team, squad, { logo = null, photos = new Map() } = {}) {
	const b = bounds(doc);
	const color = team.color || '#6366F1';
	const ink = textOn(color);
	const bandY = doc.y;

	doc.roundedRect(b.left, bandY, b.width, 72, 8).fill(color);
	let x = b.left + 16;
	if (logo) {
		try {
			doc.circle(x + 22, bandY + 36, 24).fill('#FFFFFF');
			doc.image(logo, x + 4, bandY + 18, { fit: [36, 36], align: 'center', valign: 'center' });
			x += 60;
		} catch {
			// Unreadable logo: skip it.
		}
	}
	doc.fillColor(ink).font('Helvetica-Bold').fontSize(20).text(team.name.toUpperCase(), x, bandY + 16, { width: b.right - x - 16, lineBreak: false, ellipsis: true });
	const owner = team.owner?.name ? `Owner: ${team.owner.name}${team.owner.isPlaying ? ' (plays)' : ''}` : '';
	doc.font('Helvetica').fontSize(10).text(owner, x, bandY + 44, { width: b.right - x - 16, lineBreak: false });

	// Squad summary
	const statsY = bandY + 86;
	const stats = [
		['Squad', `${team.playersCount}/${tournament.squad.max}`],
		['Spent', pdfMoney(team.spent, tournament.currency)],
		['Purse left', pdfMoney(team.remainingPurse, tournament.currency)],
	];
	const statW = b.width / stats.length;
	stats.forEach(([label, value], i) => {
		doc.fillColor(GRAY_500).font('Helvetica').fontSize(8.5).text(label.toUpperCase(), b.left + i * statW, statsY, { width: statW - 8, lineBreak: false });
		doc.fillColor(GRAY_900).font('Helvetica-Bold').fontSize(14).text(value, b.left + i * statW, statsY + 12, { width: statW - 8, lineBreak: false });
	});

	// Squad table
	const cols = [
		{ label: '#', x: b.left, w: 22 },
		{ label: 'Player', x: b.left + 26, w: 196 },
		{ label: 'Role', x: b.left + 226, w: 128 },
		{ label: 'Category', x: b.left + 358, w: 70 },
		{ label: 'Price', x: b.left + 432, w: b.width - 432 },
	];
	let y = statsY + 46;
	doc.fillColor(GRAY_500).font('Helvetica-Bold').fontSize(8.5);
	cols.forEach((c) => doc.text(c.label.toUpperCase(), c.x, y, { width: c.w, lineBreak: false }));
	y += 14;
	doc.moveTo(b.left, y).lineTo(b.right, y).lineWidth(0.8).strokeColor(GRAY_200).stroke();
	y += 6;

	squad.forEach((player, index) => {
		if (y + 30 > b.bottom) {
			doc.addPage();
			y = bounds(doc).top;
		}
		const category = tournament.getCategory(player.category);
		drawAvatar(doc, { cx: cols[1].x + 12, cy: y + 12, r: 11, image: photos.get(String(player._id)), name: player.name, color: category?.color || color });
		doc.fillColor(GRAY_900).font('Helvetica').fontSize(10).text(String(index + 1), cols[0].x, y + 7, { width: cols[0].w, lineBreak: false });
		doc.font('Helvetica-Bold').text(player.name + (player.isOwner ? '  (Owner)' : ''), cols[1].x + 30, y + 7, { width: cols[1].w - 30, lineBreak: false, ellipsis: true });
		doc.font('Helvetica').fillColor(GRAY_500).text(player.role || '—', cols[2].x, y + 7, { width: cols[2].w, lineBreak: false, ellipsis: true });
		doc.text(category?.name || '—', cols[3].x, y + 7, { width: cols[3].w, lineBreak: false, ellipsis: true });
		doc.fillColor(GRAY_900).font('Helvetica-Bold').text(pdfMoney(player.soldPrice, tournament.currency), cols[4].x, y + 7, { width: cols[4].w, lineBreak: false });
		y += 28;
	});

	if (!squad.length) {
		doc.fillColor(GRAY_500).font('Helvetica').fontSize(11).text('No players yet.', b.left, y + 4);
		y += 24;
	}
	doc.y = y;
}
