import { v2 as cloudinary } from 'cloudinary';
import logger from '../utils/logger.js';

// Images are stored in Cloudinary; MongoDB keeps only { url, publicId }.
// Credentials come from CLOUDINARY_URL (cloudinary://key:secret@cloud_name)
// or the three separate CLOUDINARY_* variables.

const ROOT_FOLDER = 'auction-hub';

// Resize on upload so originals straight from a phone camera don't eat storage.
const UPLOAD_PRESETS = {
	players: { width: 1000, height: 1000, crop: 'limit' },
	owners: { width: 1000, height: 1000, crop: 'limit' },
	teams: { width: 600, height: 600, crop: 'limit' },
	tournament: { width: 600, height: 600, crop: 'limit' },
};

export const isCloudinaryConfigured = () => {
	const url = process.env.CLOUDINARY_URL;
	// The .env.example placeholder contains "<api_key>" etc.: treat it as unset.
	if (url) return url.startsWith('cloudinary://') && !url.includes('<');
	return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
};

let configured = false;
const ensureConfigured = () => {
	if (!isCloudinaryConfigured()) {
		const error = new Error('Image uploads are not set up yet. Add the Cloudinary keys (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) to the environment and restart.');
		error.status = 503;
		throw error;
	}
	if (!configured) {
		// config(true) re-reads CLOUDINARY_URL from the environment.
		if (process.env.CLOUDINARY_URL) cloudinary.config(true);
		else {
			cloudinary.config({
				cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
				api_key: process.env.CLOUDINARY_API_KEY,
				api_secret: process.env.CLOUDINARY_API_SECRET,
			});
		}
		cloudinary.config({ secure: true });
		configured = true;
	}
};

const folderFor = (tournamentId, kind) => `${ROOT_FOLDER}/${tournamentId}/${kind}`;

// ───────────────────────── Free-plan limits ─────────────────────────
// Cloudinary signals plan limits in different ways: HTTP 420 when the
// Admin API's hourly request allowance is used up, a quota message when the
// plan's monthly credits are exhausted, and a size message for files over
// the per-image cap (10 MB on the free plan).

const LIMIT_MESSAGES = {
	quota:
		"Cloudinary limit reached: this month's free-plan credits are used up, so images can't be uploaded or changed right now. The auction itself keeps working. Usage frees up over a rolling 30 days, or you can upgrade in the Cloudinary console.",
	rate: 'Cloudinary limit reached: too many image requests this hour on the free plan. Wait a few minutes and try again.',
	size: "This image is larger than Cloudinary's free-plan limit (10 MB or 25 megapixels). Choose a smaller photo.",
};
// How long a limit error keeps the warning banner up without a fresh usage check.
const NOTICE_TTL = { quota: 6 * 60 * 60 * 1000, rate: 30 * 60 * 1000 };

let limitHit = null; // { kind, at } after Cloudinary refused a request for a plan limit

/**
 * Classify a Cloudinary error. Upload callbacks pass { message, http_code };
 * Admin API calls reject with { error: { message, http_code } }.
 * @returns {{ kind: 'quota'|'rate'|'size'|'other', status: number, message: string }}
 */
export function describeCloudinaryError(error) {
	const raw = error?.error && typeof error.error === 'object' ? error.error : error || {};
	const text = String(raw.message || '');
	const code = Number(raw.http_code) || 0;

	if (/file size too large|too large|megapixel|maximum.*(size|pixels)/i.test(text)) {
		return { kind: 'size', status: 413, message: LIMIT_MESSAGES.size };
	}
	if (code === 420 || code === 429 || /rate limit/i.test(text)) {
		return { kind: 'rate', status: 429, message: LIMIT_MESSAGES.rate };
	}
	if (/usage limit|quota|exceed|credits?\b|plan limit|upgrade|account.*(disabled|suspended|blocked|deactivated)/i.test(text)) {
		return { kind: 'quota', status: 503, message: LIMIT_MESSAGES.quota };
	}
	return { kind: 'other', status: 502, message: `Image upload failed: ${text || 'Cloudinary did not respond'}` };
}

/** Turn a Cloudinary failure into an Error with a message fit to show the admin. */
function friendlyError(error) {
	const info = describeCloudinaryError(error);
	if (info.kind === 'quota' || info.kind === 'rate') limitHit = { kind: info.kind, at: Date.now() };
	const friendly = new Error(info.message);
	friendly.status = info.status;
	friendly.expected = info.kind !== 'other';
	friendly.cloudinaryLimit = info.kind === 'quota' || info.kind === 'rate';
	return friendly;
}

let usageCache = null; // { at, value }
let usageRequest = null;
const USAGE_TTL = 10 * 60 * 1000;

/**
 * Plan usage from the Admin API, cached for 10 minutes (the free plan allows
 * 500 Admin API calls an hour). Resolves to null when unavailable.
 * @returns {Promise<null | { plan: string, usedPercent: number, used: number, limit: number }>}
 */
export async function getCloudinaryUsage({ maxAge = USAGE_TTL } = {}) {
	if (!isCloudinaryConfigured()) return null;
	if (usageCache && Date.now() - usageCache.at < maxAge) return usageCache.value;
	if (!usageRequest) {
		usageRequest = (async () => {
			try {
				ensureConfigured();
				const usage = await cloudinary.api.usage();
				const credits = usage.credits || {};
				return {
					plan: usage.plan || '',
					used: Number(credits.usage) || 0,
					limit: Number(credits.limit) || 0,
					usedPercent: Number(credits.used_percent) || 0,
				};
			} catch (error) {
				const info = describeCloudinaryError(error);
				if (info.kind === 'rate' || info.kind === 'quota') limitHit = { kind: info.kind, at: Date.now() };
				logger.warn('Cloudinary usage check failed', { message: error?.error?.message || error?.message });
				return null;
			}
		})().then((value) => {
			usageCache = { at: Date.now(), value };
			usageRequest = null;
			return value;
		});
	}
	return usageRequest;
}

/**
 * Banner for admin pages, from cached state only (never waits on the
 * network); a stale usage figure is refreshed in the background.
 * @returns {null | { level: 'error'|'warning', title: string, text: string }}
 */
export function getCloudinaryNotice() {
	if (!isCloudinaryConfigured()) return null;
	if (!usageCache || Date.now() - usageCache.at >= USAGE_TTL) getCloudinaryUsage().catch(() => {});

	const usage = usageCache?.value;
	const recent = limitHit && Date.now() - limitHit.at < NOTICE_TTL[limitHit.kind] ? limitHit.kind : null;
	if (recent === 'quota' || usage?.usedPercent >= 100) {
		const figure = usage ? ` (${Math.round(usage.usedPercent)}% of ${usage.limit} monthly credits used)` : '';
		return {
			level: 'error',
			title: 'Cloudinary limit reached',
			text: `Your free plan's monthly credits are used up${figure}. Photo and logo uploads will fail and images may stop loading until usage drops or you upgrade. The auction itself keeps working.`,
		};
	}
	if (recent === 'rate') {
		return {
			level: 'warning',
			title: 'Cloudinary limit reached for this hour',
			text: 'Too many image requests on the free plan. Uploads and deletions will work again in a few minutes.',
		};
	}
	if (usage?.usedPercent >= 80) {
		return {
			level: 'warning',
			title: 'Cloudinary almost at its limit',
			text: `${Math.round(usage.usedPercent)}% of this month's ${usage.limit} free-plan credits are used. Uploads stop working at 100%.`,
		};
	}
	return null;
}

/**
 * Upload an in-memory image (from multer) and return the reference to store.
 * @param {Buffer} buffer
 * @param {{ tournamentId: string, kind: 'players'|'owners'|'teams'|'tournament' }} options
 * @returns {Promise<{ url: string, publicId: string }>}
 */
export function uploadImage(buffer, { tournamentId, kind }) {
	ensureConfigured();
	return new Promise((resolve, reject) => {
		const stream = cloudinary.uploader.upload_stream(
			{
				folder: folderFor(tournamentId, kind),
				resource_type: 'image',
				allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif'],
				transformation: [UPLOAD_PRESETS[kind] || UPLOAD_PRESETS.players],
			},
			(error, result) => {
				if (error) {
					logger.error('Cloudinary upload failed', { message: error.message, http_code: error.http_code });
					return reject(friendlyError(error));
				}
				limitHit = null;
				resolve({ url: result.secure_url, publicId: result.public_id });
			}
		);
		stream.end(buffer);
	});
}

/**
 * Upload from a remote URL or data URI instead of a buffer. Only for trusted,
 * server-side sources (the demo seed script); browser uploads use uploadImage.
 * `format` converts on upload, e.g. 'png' for an SVG logo.
 */
export async function uploadImageFrom(source, { tournamentId, kind, format }) {
	ensureConfigured();
	try {
		const result = await cloudinary.uploader.upload(source, {
			folder: folderFor(tournamentId, kind),
			resource_type: 'image',
			transformation: [UPLOAD_PRESETS[kind] || UPLOAD_PRESETS.players],
			...(format ? { format } : {}),
		});
		limitHit = null;
		return { url: result.secure_url, publicId: result.public_id };
	} catch (error) {
		throw friendlyError(error);
	}
}

/** Quick credentials check: resolves with Cloudinary's ping response. */
export function pingCloudinary() {
	ensureConfigured();
	return cloudinary.api.ping();
}

/** Delete one image; failures are logged, never thrown. */
export async function deleteImage(publicId) {
	if (!publicId || !isCloudinaryConfigured()) return;
	try {
		ensureConfigured();
		await cloudinary.uploader.destroy(publicId, { invalidate: true });
	} catch (error) {
		logger.warn('Cloudinary delete failed', { publicId, message: friendlyError(error).message });
	}
}

/**
 * Delete every image uploaded for a tournament, then its folders (used when
 * the tournament is deleted). Never throws.
 * @returns {Promise<{ ok: boolean, deleted: number, folder: string, message?: string }>}
 */
export async function deleteTournamentImages(tournamentId) {
	const folder = `${ROOT_FOLDER}/${tournamentId}`;
	if (!isCloudinaryConfigured()) return { ok: true, deleted: 0, folder };
	let deleted = 0;
	try {
		ensureConfigured();
		// Each call removes at most 1,000 images and reports `partial` when more remain.
		for (let round = 0; round < 50; round++) {
			const result = await cloudinary.api.delete_resources_by_prefix(`${folder}/`, { invalidate: true });
			deleted += Object.values(result.deleted || {}).filter((status) => status === 'deleted').length;
			if (!result.partial) break;
		}
		for (const kind of Object.keys(UPLOAD_PRESETS)) {
			await cloudinary.api.delete_folder(`${folder}/${kind}`).catch(() => {});
		}
		await cloudinary.api.delete_folder(folder).catch(() => {});
		return { ok: true, deleted, folder };
	} catch (error) {
		const message = friendlyError(error).message;
		logger.warn('Cloudinary cleanup failed', { tournamentId, message });
		return { ok: false, deleted, folder, message };
	}
}

// Delivery-time sizes. Cloudinary resizes on the fly via the URL, so one
// upload serves thumbnails, cards and the projector display.
const DELIVERY_PRESETS = {
	thumb: 'c_fill,g_face,w_96,h_96',
	avatar: 'c_fill,g_face,w_200,h_200',
	card: 'c_fill,g_face,w_480,h_480',
	logoSm: 'c_pad,b_transparent,w_96,h_96',
	logo: 'c_pad,b_transparent,w_240,h_240',
};

/** Add a size transformation to a Cloudinary URL (other URLs pass through). */
export function imageUrl(image, preset = 'card') {
	const url = typeof image === 'string' ? image : image?.url;
	if (!url) return '';
	if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
	const transformation = `${DELIVERY_PRESETS[preset] || DELIVERY_PRESETS.card},f_auto,q_auto`;
	return url.replace('/upload/', `/upload/${transformation}/`);
}

// PDFKit can only embed JPEG and PNG, so PDFs ask Cloudinary for those
// formats explicitly instead of f_auto (which may return WebP/AVIF).
const PDF_PRESETS = {
	photo: 'c_fill,g_face,w_160,h_160,f_jpg,q_80',
	logo: 'c_pad,b_white,w_200,h_200,f_png',
};

/** Cloudinary URL for an image to embed in a generated PDF ('' when none). */
export function pdfImageUrl(image, kind = 'photo') {
	const url = typeof image === 'string' ? image : image?.url;
	if (!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return '';
	return url.replace('/upload/', `/upload/${PDF_PRESETS[kind] || PDF_PRESETS.photo}/`);
}
