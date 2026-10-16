import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const teamPlayerSchema = new Schema(
	{
		playerId: { type: Schema.Types.ObjectId, ref: 'Player' },
		playerName: String,
		pricePaid: Number,
		category: String,
		boughtAt: { type: Date, default: Date.now },
	},
	{ _id: false }
);

const teamSchema = new Schema(
	{
		teamName: { type: String, required: true, unique: true, trim: true },
		teamNumber: {
			type: Number,
			required: true,
			unique: true,
			min: 1,
			max: 8,
		},
		captain: { type: String, default: '' },
		color: { type: String, required: true },
		logo: { type: String, default: '' },
		remainingPurse: { type: Number, required: true, default: 1000000 },
		initialPurse: { type: Number, required: true, default: 1000000 },
		playersCount: { type: Number, default: 0 },
		players: [teamPlayerSchema],
		createdAt: { type: Date, default: Date.now },
	},
	{
		toJSON: { virtuals: true },
		toObject: { virtuals: true },
	}
);

teamSchema.virtual('totalSpent').get(function totalSpent() {
	return this.initialPurse - this.remainingPurse;
});

const Team = model('Team', teamSchema);

export default Team;
