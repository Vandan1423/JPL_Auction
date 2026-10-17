import mongoose from 'mongoose';
import {
	CURRENCIES,
	DEFAULT_ROLES,
	FIELD_MODES,
	LIMITS,
	UNSOLD_POLICIES,
} from '../config/constants.js';

const { Schema, model } = mongoose;

// Cloudinary image reference: only the delivery URL and public_id are stored.
export const imageSchema = new Schema(
	{
		url: { type: String, trim: true },
		publicId: { type: String, trim: true },
	},
	{ _id: false }
);

// "When the current bid is at least `from`, the next bid goes up by `step`."
const incrementSlabSchema = new Schema(
	{
		from: { type: Number, required: true, min: 0 },
		step: { type: Number, required: true, min: 1 },
	},
	{ _id: false }
);

const categorySchema = new Schema({
	name: { type: String, required: true, trim: true, maxlength: 30 },
	basePrice: { type: Number, required: true, min: 0 },
	color: { type: String, default: '#6366F1' },
	// Most players a single team may buy from this category (null = no limit).
	maxPerTeam: { type: Number, min: 0, default: null },
	// Empty means "use the tournament-wide bidIncrements".
	increments: { type: [incrementSlabSchema], default: [] },
});

const roleRequirementSchema = new Schema(
	{
		role: { type: String, required: true, trim: true },
		min: { type: Number, required: true, min: 1 },
	},
	{ _id: false }
);

const fieldMode = { type: String, enum: FIELD_MODES, default: 'optional' };

const tournamentSchema = new Schema(
	{
		name: { type: String, required: true, trim: true, maxlength: 80 },
		shortName: { type: String, trim: true, maxlength: 12, default: '' },
		season: { type: String, trim: true, maxlength: 20, default: '' },
		slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
		logo: { type: imageSchema, default: undefined },
		venue: { type: String, trim: true, maxlength: 120, default: '' },
		auctionDate: { type: Date, default: null },
		currency: { type: String, enum: Object.keys(CURRENCIES), default: 'INR' },

		// setup → wizard not finished; active → ready for/running auction; completed → archived
		status: { type: String, enum: ['setup', 'active', 'completed'], default: 'setup' },
		// Highest wizard step saved so far (1-based).
		setupStep: { type: Number, default: 1 },

		teamCount: { type: Number, min: LIMITS.minTeams, max: LIMITS.maxTeams, default: 8 },
		squad: {
			min: { type: Number, min: 1, max: LIMITS.maxSquad, default: 11 },
			max: { type: Number, min: 1, max: LIMITS.maxSquad, default: 15 },
		},
		purse: { type: Number, min: 0, default: 1000000 },
		maxBidPerPlayer: { type: Number, min: 0, default: null },

		categories: { type: [categorySchema], default: [] },
		bidIncrements: { type: [incrementSlabSchema], default: () => [{ from: 0, step: 1000 }] },

		roles: { type: [String], default: () => [...DEFAULT_ROLES] },
		roleRequirements: { type: [roleRequirementSchema], default: [] },
		playerFields: {
			phone: fieldMode,
			jerseySize: fieldMode,
			jerseyNumber: fieldMode,
			age: fieldMode,
		},

		unsoldPolicy: { type: String, enum: Object.keys(UNSOLD_POLICIES), default: 'requeue' },
	},
	{ timestamps: true }
);

tournamentSchema.pre('validate', function checkSquad(next) {
	if (this.squad?.min > this.squad?.max) {
		this.invalidate('squad.min', 'Minimum squad size cannot be larger than the maximum');
	}
	next();
});

tournamentSchema.methods.getCategory = function getCategory(categoryId) {
	if (!categoryId) return null;
	return this.categories.id(categoryId) || null;
};

// Categories sorted from cheapest to most expensive base price.
tournamentSchema.methods.categoriesByPrice = function categoriesByPrice() {
	return [...this.categories].sort((a, b) => a.basePrice - b.basePrice);
};

tournamentSchema.methods.incrementsFor = function incrementsFor(categoryId) {
	const category = this.getCategory(categoryId);
	return category?.increments?.length ? category.increments : this.bidIncrements;
};

tournamentSchema.virtual('displayName').get(function displayName() {
	return this.season ? `${this.name} ${this.season}` : this.name;
});

const Tournament = model('Tournament', tournamentSchema);

export default Tournament;
