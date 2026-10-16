import mongoose from 'mongoose';
import { imageSchema } from './Tournament.js';

const { Schema, model } = mongoose;

// Status lifecycle:
//   available → never put under the hammer yet
//   unsold    → went under the hammer with no bids; still in the pool for re-auction
//   sold      → bought by `soldTo` for `soldPrice` (playing owners start here)
//   withdrawn → pulled out of the auction
const playerSchema = new Schema(
	{
		tournament: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true, index: true },
		// Per-tournament registration number. Owners don't get one.
		playerNumber: { type: Number, default: null },
		name: { type: String, required: true, trim: true, maxlength: 80 },
		phone: { type: String, trim: true, default: '' },
		role: { type: String, trim: true, default: '' },
		// _id of an entry in tournament.categories (null only for owners).
		category: { type: Schema.Types.ObjectId, default: null },
		// Category before any unsold move-downs; restored when the auction is reset.
		originalCategory: { type: Schema.Types.ObjectId, default: null },
		jerseySize: { type: String, trim: true, default: '' },
		jerseyNumber: { type: String, trim: true, maxlength: 4, default: '' },
		age: { type: Number, min: 5, max: 90, default: null },
		photo: { type: imageSchema, default: undefined },

		// True for a team owner who also plays; never auctioned.
		isOwner: { type: Boolean, default: false },

		status: {
			type: String,
			enum: ['available', 'unsold', 'sold', 'withdrawn'],
			default: 'available',
		},
		soldTo: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
		soldPrice: { type: Number, default: 0 },
		soldAt: { type: Date, default: null },
		timesUnsold: { type: Number, default: 0 },
		auctionOrder: { type: Number, default: 0 },
	},
	{ timestamps: true }
);

playerSchema.index(
	{ tournament: 1, playerNumber: 1 },
	{ unique: true, partialFilterExpression: { isOwner: false } }
);
playerSchema.index({ tournament: 1, status: 1, auctionOrder: 1 });
playerSchema.index({ tournament: 1, soldTo: 1 });

const Player = model('Player', playerSchema);

export default Player;
