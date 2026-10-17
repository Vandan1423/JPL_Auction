import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const bidEntrySchema = new Schema(
	{
		teamId: { type: Schema.Types.ObjectId, ref: 'Team' },
		teamName: String,
		bidAmount: Number,
		bidTime: { type: Date, default: Date.now },
	},
	{ _id: false }
);

// One live auction state per tournament. `optimisticConcurrency` makes save()
// fail if another request changed the document first, so two near-simultaneous
// bids can never both be accepted.
const auctionStateSchema = new Schema(
	{
		tournament: { type: Schema.Types.ObjectId, ref: 'Tournament', required: true, unique: true },
		currentPlayer: { type: Schema.Types.ObjectId, ref: 'Player', default: null },
		currentBid: { type: Number, default: 0 },
		currentBidder: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
		isActive: { type: Boolean, default: false },
		roundNumber: { type: Number, default: 0 },
		lastBidTime: { type: Date },
		bidHistory: [bidEntrySchema],
		// The most recent auction event (bid, sold, unsold…), so screens that
		// poll instead of using Socket.IO can still play the right animation.
		lastEvent: {
			id: String,
			// Spelled out: a bare `type: String` would make Mongoose treat all of
			// lastEvent as a string field.
			type: { type: String },
			details: Schema.Types.Mixed,
			at: Date,
		},
	},
	{ timestamps: true, optimisticConcurrency: true }
);

auctionStateSchema.methods.clearCurrent = function clearCurrent() {
	this.currentPlayer = null;
	this.currentBid = 0;
	this.currentBidder = null;
	this.isActive = false;
	this.bidHistory = [];
	return this;
};

const AuctionState = model('AuctionState', auctionStateSchema);

export default AuctionState;
