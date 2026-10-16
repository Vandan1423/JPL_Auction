import Player from '../models/Player.js';
import { getPlayerCounts, getTeamStats } from '../services/standings.js';
import { getAuctionState } from '../services/auction.js';

export const showLogin = (req, res) => {
	const error = req.session.error;
	delete req.session.error;
	res.render('admin/login', { error });
};

export const handleLogin = (req, res) => {
	const { password } = req.body;
	const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();

	if (adminPassword && password && password.trim() === adminPassword) {
		req.session.isAdmin = true;
		req.session.adminName = 'Admin';
		return res.redirect(req.session.tournamentId ? '/admin/dashboard' : '/admin/tournaments');
	}

	req.session.error = 'Invalid password';
	res.redirect('/admin/login');
};

export const logout = (req, res) => {
	req.session.destroy((err) => {
		if (err) {
			console.error('Logout error:', err);
		}
		res.redirect('/admin/login');
	});
};

export const showDashboard = async (req, res, next) => {
	try {
		const t = req.tournament;
		const [counts, teams, auctionState, recentSold, highestSold, categoryRows, totals] = await Promise.all([
			getPlayerCounts(t),
			getTeamStats(t),
			getAuctionState(t._id),
			Player.find({ tournament: t._id, isOwner: false, status: 'sold' })
				.sort({ soldAt: -1 })
				.limit(10)
				.populate('soldTo', 'name color')
				.lean(),
			Player.findOne({ tournament: t._id, isOwner: false, status: 'sold' }).sort({ soldPrice: -1 }).populate('soldTo', 'name').lean(),
			Player.aggregate([
				{ $match: { tournament: t._id, isOwner: false } },
				{ $group: { _id: '$category', count: { $sum: 1 } } },
			]),
			Player.aggregate([
				{ $match: { tournament: t._id, isOwner: false, status: 'sold' } },
				{ $group: { _id: null, total: { $sum: '$soldPrice' } } },
			]),
		]);

		const totalAuctionValue = totals[0]?.total || 0;
		const perCategory = new Map(categoryRows.map((r) => [String(r._id), r.count]));

		res.render('admin/dashboard', {
			title: `${t.name} · Dashboard`,
			counts,
			teams,
			auctionState,
			totalAuctionValue,
			avgSoldPrice: counts.sold ? Math.round(totalAuctionValue / counts.sold) : 0,
			highestSold,
			recentSales: recentSold,
			categoryCounts: t.categories.map((c) => ({ category: c, count: perCategory.get(String(c._id)) || 0 })),
		});
	} catch (error) {
		next(error);
	}
};
