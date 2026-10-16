import { APP_NAME } from '../config/constants.js';
import { formatMoney } from '../utils/format.js';
import { imageUrl, isCloudinaryConfigured } from '../services/cloudinary.js';

/**
 * Helpers available in every view. Tournament-specific helpers (money in the
 * tournament's currency, category badges) are added by loadTournament.
 */
export const viewLocals = (req, res, next) => {
	res.locals.appName = APP_NAME;
	res.locals.currentPath = req.path;
	res.locals.money = (amount) => formatMoney(amount, 'INR');
	res.locals.img = imageUrl;
	res.locals.uploadsEnabled = isCloudinaryConfigured();
	res.locals.tournament = null;
	// JSON for inline <script> blocks: escaping "<" stops a name like "</script>" breaking out.
	res.locals.json = (value) =>
		JSON.stringify(value ?? null)
			.replace(/</g, '\\u003c');

	// Flash messages are read (and cleared) only by pages that render them.
	res.locals.takeFlash = () => {
		const flash = { success: req.session?.success, error: req.session?.error };
		if (req.session) {
			delete req.session.success;
			delete req.session.error;
		}
		return flash;
	};
	next();
};
