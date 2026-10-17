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
					logger.error('Cloudinary upload failed', { message: error.message });
					const friendly = new Error(`Image upload failed: ${error.message}`);
					friendly.status = 502;
					return reject(friendly);
				}
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
	const result = await cloudinary.uploader.upload(source, {
		folder: folderFor(tournamentId, kind),
		resource_type: 'image',
		transformation: [UPLOAD_PRESETS[kind] || UPLOAD_PRESETS.players],
		...(format ? { format } : {}),
	});
	return { url: result.secure_url, publicId: result.public_id };
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
		logger.warn('Cloudinary delete failed', { publicId, message: error.message });
	}
}

/** Delete every image uploaded for a tournament (used when it is deleted). */
export async function deleteTournamentImages(tournamentId) {
	if (!isCloudinaryConfigured()) return;
	const prefix = `${ROOT_FOLDER}/${tournamentId}`;
	try {
		ensureConfigured();
		await cloudinary.api.delete_resources_by_prefix(`${prefix}/`);
		for (const kind of Object.keys(UPLOAD_PRESETS)) {
			await cloudinary.api.delete_folder(`${prefix}/${kind}`).catch(() => {});
		}
		await cloudinary.api.delete_folder(prefix).catch(() => {});
	} catch (error) {
		logger.warn('Cloudinary cleanup failed', { tournamentId, message: error.message });
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
