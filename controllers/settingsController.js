import { STEPS } from './setupController.js';
import { getPlayerCounts } from '../services/standings.js';
import { getAuctionState, hasAuctionStarted, resetAuction } from '../services/auction.js';
import { getCloudinaryUsage, isCloudinaryConfigured } from '../services/cloudinary.js';
import { broadcast } from '../socket/index.js';

/** GET /admin/settings */
export const showSettings = async (req, res, next) => {
	try {
		const t = req.tournament;
		const [counts, started, state, cloudinaryUsage] = await Promise.all([
			getPlayerCounts(t),
			hasAuctionStarted(t),
			getAuctionState(t._id),
			getCloudinaryUsage(),
		]);
		res.render('admin/settings', {
			title: 'Settings',
			steps: STEPS,
			counts,
			started,
			roundNumber: state.roundNumber,
			cloudinaryReady: isCloudinaryConfigured(),
			cloudinaryUsage,
			displayUrl: `${req.protocol}://${req.get('host')}/display/${t.slug}`,
		});
	} catch (error) {
		next(error);
	}
};

/** POST /admin/settings/reset-auction — requires typing RESET. */
export const resetAuctionAction = async (req, res, next) => {
	try {
		const t = req.tournament;
		if (String(req.body.confirm || '').trim().toUpperCase() !== 'RESET') {
			req.session.error = 'Type RESET to confirm. Nothing was changed.';
			return res.redirect('/admin/settings');
		}
		await resetAuction(t);
		await broadcast(req.io, t, 'reset');
		req.session.success = 'Auction reset: every player is back in the pool and all purses are full again';
		return res.redirect('/admin/settings');
	} catch (error) {
		next(error);
	}
};
