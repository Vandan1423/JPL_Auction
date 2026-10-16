import { CURRENCIES } from '../config/constants.js';

export const currencyOf = (code) => CURRENCIES[code] || CURRENCIES.INR;

/** Format an amount in the tournament's currency, e.g. ₹1,25,000 or 1,500 pts. */
export function formatMoney(amount, code = 'INR') {
	const currency = currencyOf(code);
	const value = Math.round(Number(amount) || 0).toLocaleString(currency.locale);
	return `${currency.symbol}${value}${currency.suffix || ''}`;
}

// Why a team cannot bid right now (codes come from services/bidRules.js).
export const BLOCK_REASONS = {
	squad_full: 'Squad is full',
	category_limit: 'Category limit reached',
	role_needed: 'Needs a required role',
	leading: 'Highest bidder',
	purse: 'Not enough purse',
};

/** Turn a string into a URL-safe slug. */
export function slugify(text) {
	return String(text || '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}

/** Parse a form value into a whole number, or null when blank/invalid. */
export function toInt(value) {
	if (value === undefined || value === null || String(value).trim() === '') return null;
	const n = Number(String(value).replace(/[,\s]/g, ''));
	return Number.isFinite(n) ? Math.round(n) : null;
}

export const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
