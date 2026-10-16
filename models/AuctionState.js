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

const auctionStateSchema = new Schema(
	{
		currentPlayer: { type: Schema.Types.ObjectId, ref: 'Player', default: null },
		currentBid: { type: Number, default: 0 },
		currentBidder: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
		isActive: { type: Boolean, default: false },
		roundNumber: { type: Number, default: 0 },
		lastBidTime: { type: Date },
		auctionStartedAt: { type: Date },
		bidHistory: [bidEntrySchema],
	},
	{ timestamps: true }
);

auctionStateSchema.methods.clearState = function clearState() {
	this.currentPlayer = null;
	this.currentBid = 0;
	this.currentBidder = null;
	this.isActive = false;
	this.roundNumber = 0;
	this.lastBidTime = undefined;
	this.auctionStartedAt = undefined;
	this.bidHistory = [];
	return this;
};

const AuctionState = model('AuctionState', auctionStateSchema);

export default AuctionState;
