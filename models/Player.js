import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CATEGORY_BASE_PRICE = {
	A: 75000,
	B: 30000,
	C: 10000,
};

const PLAYER_TYPES = [
	'Batsman',
	'Bowler',
	'Batting All Rounder',
	'Bowling All Rounder',
	'Wicket Keeper Batsman',
];

const playerSchema = new Schema({
	name: { type: String, required: true, trim: true },
	phoneNumber: {
		type: String,
		required: true,
		match: /^\d{10}$/,
	},
	jerseySize: {
		type: String,
		enum: ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
		required: true,
	},
	playerType: {
		type: String,
		required: true,
		enum: PLAYER_TYPES,
	},
	category: {
		type: String,
		required: true,
		enum: ['A', 'B', 'C'],
	},
	imageUrl: {
		type: String,
		trim: true,
		default: null,
	},
	age: { type: Number, min: 14, max: 80 },
	basePrice: { type: Number },
	currentPrice: { type: Number },
	status: {
		type: String,
		enum: ['unsold', 'sold', 'withdrawn'],
		default: 'unsold',
	},
	soldTo: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
	soldPrice: { type: Number, default: 0 },
	playerNumber: { type: Number, unique: true },
	auctionOrder: { type: Number, default: 0 },
	registrationDate: { type: Date, default: Date.now },
	createdAt: { type: Date, default: Date.now },
});

playerSchema.pre('save', async function setDerivedFields(next) {
	if (this.isModified('category') || this.isNew) {
		this.basePrice = CATEGORY_BASE_PRICE[this.category];
	}

	if (!this.currentPrice) {
		this.currentPrice = this.basePrice;
	}

	if (this.isNew && !this.playerNumber) {
		const lastPlayer = await this.constructor
			.findOne()
			.sort({ playerNumber: -1 })
			.select('playerNumber')
			.lean();

		this.playerNumber = lastPlayer?.playerNumber
			? lastPlayer.playerNumber + 1
			: 1;
	}

	next();
});

const Player = model('Player', playerSchema);

export default Player;
