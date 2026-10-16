import mongoose from 'mongoose';
import { imageSchema } from './Tournament.js';

const { Schema, model } = mongoose;

// Squad, spend and remaining purse are derived from sold Player documents
// (see services/standings.js), so a team never stores a copy that can drift.
const teamSchema = new Schema(
	{
		tournament: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true, index: true },
		// Display order, also used for the 1–9 keyboard shortcuts in the auction panel.
		order: { type: Number, required: true },
		name: { type: String, required: true, trim: true, maxlength: 60 },
		shortName: { type: String, trim: true, maxlength: 6, default: '' },
		color: { type: String, default: '#3B82F6' },
		logo: { type: imageSchema, default: undefined },
		owner: {
			name: { type: String, trim: true, maxlength: 80, default: '' },
			photo: { type: imageSchema, default: undefined },
			// A playing owner is added to the squad automatically and fills one slot.
			isPlaying: { type: Boolean, default: false },
			role: { type: String, trim: true, default: '' },
		},
	},
	{ timestamps: true }
);

teamSchema.index({ tournament: 1, order: 1 });

const Team = model('Team', teamSchema);

export default Team;
