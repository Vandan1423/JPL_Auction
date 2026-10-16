import Tournament from '../models/Tournament.js';
import { getSnapshot } from '../services/auction.js';
import { imageUrl } from '../services/cloudinary.js';
import { currencyOf } from '../utils/format.js';

/** GET /display — pick a tournament (skipped when only one is running). */
export const showDisplayIndex = async (req, res, next) => {
	try {
		const tournaments = await Tournament.find({ status: 'active' }).sort({ updatedAt: -1 }).lean();
		if (tournaments.length === 1) return res.redirect(`/display/${tournaments[0].slug}`);
		res.render('public/display-index', {
			tournaments: tournaments.map((t) => ({ ...t, logoUrl: imageUrl(t.logo, 'logo') })),
		});
	} catch (error) {
		next(error);
	}
};

const findBySlug = (slug) => Tournament.findOne({ slug: String(slug || '').toLowerCase() });

/** GET /display/:slug — projector screen for one tournament. */
export const showDisplay = async (req, res, next) => {
	try {
		const tournament = await findBySlug(req.params.slug);
		if (!tournament) return res.status(404).render('error', { title: 'Not found', message: 'No tournament at this address', showNav: false });

		res.render('public/display', {
			tournament,
			logoUrl: imageUrl(tournament.logo, 'logo'),
			currency: currencyOf(tournament.currency),
			snapshot: await getSnapshot(tournament),
		});
	} catch (error) {
		next(error);
	}
};

/** GET /api/display/:slug — polling fallback when the socket is down. */
export const getDisplayData = async (req, res, next) => {
	try {
		const tournament = await findBySlug(req.params.slug);
		if (!tournament) return res.status(404).json({ success: false, message: 'Tournament not found' });
		res.json({ success: true, snapshot: await getSnapshot(tournament) });
	} catch (error) {
		next(error);
	}
};
