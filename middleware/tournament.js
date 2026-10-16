import mongoose from 'mongoose';
import Tournament from '../models/Tournament.js';
import { currencyOf, formatMoney } from '../utils/format.js';

const wantsJson = (req) => req.xhr || req.headers.accept?.includes('json') || req.originalUrl.includes('/api/');

const escapeHtml = (text) =>
	String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** Expose a tournament and its formatting helpers to the views. */
export function exposeTournament(res, tournament) {
	res.locals.tournament = tournament;
	res.locals.currency = currencyOf(tournament.currency);
	// Short label for input prefixes: "₹", "$" … or "pts" for points.
	res.locals.currencyLabel = res.locals.currency.symbol.trim() || (res.locals.currency.suffix || '').trim();
	res.locals.money = (amount) => formatMoney(amount, tournament.currency);
	res.locals.categoryOf = (id) => tournament.getCategory(id);
	res.locals.categoryBadge = (id, extraClass = '') => {
		const category = tournament.getCategory(id);
		if (!category) return '<span class="badge cat-badge-none">—</span>';
		return `<span class="badge cat-badge ${extraClass}" style="--cat:${escapeHtml(category.color)}">${escapeHtml(category.name)}</span>`;
	};
}

/**
 * Load the tournament the admin is working on (chosen on the tournaments
 * page and kept in the session) into req.tournament / res.locals.
 */
export const loadTournament = async (req, res, next) => {
	try {
		const id = req.session.tournamentId;
		const tournament = id && mongoose.isValidObjectId(id) ? await Tournament.findById(id) : null;
		if (!tournament) {
			delete req.session.tournamentId;
			if (wantsJson(req)) {
				return res.status(409).json({ success: false, message: 'Select a tournament first', redirect: '/admin/tournaments' });
			}
			return res.redirect('/admin/tournaments');
		}
		req.tournament = tournament;
		exposeTournament(res, tournament);
		next();
	} catch (error) {
		next(error);
	}
};

/** Pages that need a fully set-up tournament send unfinished ones back to the wizard. */
export const requireSetupComplete = (req, res, next) => {
	if (req.tournament.status !== 'setup') return next();
	if (wantsJson(req)) {
		return res.status(409).json({ success: false, message: 'Finish the tournament setup first' });
	}
	req.session.error = 'Finish the setup steps first.';
	return res.redirect(`/admin/setup/${Math.min(req.tournament.setupStep || 1, 6)}`);
};
