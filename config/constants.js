// App-wide constants. Anything tournament-specific (teams, categories, prices,
// squad sizes) lives on the Tournament document instead.

export const APP_NAME = 'Auction Hub';

// Money display options offered in the setup wizard.
export const CURRENCIES = {
	INR: { label: 'Indian Rupee (₹)', symbol: '₹', locale: 'en-IN' },
	USD: { label: 'US Dollar ($)', symbol: '$', locale: 'en-US' },
	GBP: { label: 'Pound Sterling (£)', symbol: '£', locale: 'en-GB' },
	EUR: { label: 'Euro (€)', symbol: '€', locale: 'en-IE' },
	AED: { label: 'UAE Dirham (AED)', symbol: 'AED ', locale: 'en-AE' },
	PTS: { label: 'Points (no currency)', symbol: '', suffix: ' pts', locale: 'en-IN' },
};

export const DEFAULT_ROLES = [
	'Batsman',
	'Bowler',
	'Batting All-Rounder',
	'Bowling All-Rounder',
	'Wicket-Keeper Batsman',
];

export const JERSEY_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

// Optional player form fields and how each can be configured per tournament.
export const PLAYER_FIELDS = {
	phone: 'Phone number',
	jerseySize: 'Jersey size',
	jerseyNumber: 'Jersey number',
	age: 'Age',
};
export const FIELD_MODES = ['required', 'optional', 'hidden'];

// What happens to a player nobody bids on.
export const UNSOLD_POLICIES = {
	requeue: 'Stay in the same category and go to the end of the queue',
	move_down: 'Drop one category (cheaper base price) and go to the end of the queue',
	move_lowest: 'Drop to the lowest category and go to the end of the queue',
};

// Pool statuses: players who can still be put under the hammer.
export const POOL_STATUSES = ['available', 'unsold'];

export const TEAM_COLORS = [
	'#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
	'#14B8A6', '#F97316', '#6366F1', '#84CC16', '#06B6D4', '#E11D48',
	'#A855F7', '#0EA5E9', '#22C55E', '#EAB308', '#D946EF', '#64748B',
	'#B91C1C', '#1D4ED8',
];

export const CATEGORY_COLORS = ['#F59E0B', '#6366F1', '#10B981', '#EF4444', '#06B6D4', '#8B5CF6', '#64748B', '#EC4899'];

export const LIMITS = {
	minTeams: 2,
	maxTeams: 20,
	maxCategories: 10,
	maxSquad: 50,
};
