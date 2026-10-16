import mongoose from 'mongoose';
import Tournament from '../models/Tournament.js';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import AuctionState from '../models/AuctionState.js';

const connectDB = async () => {
	const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/auction-hub';

	try {
		await mongoose.connect(uri);
		console.log('MongoDB connected');
	} catch (err) {
		console.error('MongoDB connection error:', err);
		process.exit(1);
	}

	// Make the database indexes match the schemas exactly. This also removes
	// stale indexes left by older versions of the app (e.g. a global unique
	// teamName index), which would otherwise reject valid inserts.
	for (const model of [Tournament, Team, Player, AuctionState]) {
		await model.syncIndexes();
	}
};

export default connectDB;
