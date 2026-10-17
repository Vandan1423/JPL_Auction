import mongoose from 'mongoose';
import Tournament from '../models/Tournament.js';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import AuctionState from '../models/AuctionState.js';

// One shared connection per process. On Vercel every warm invocation reuses
// it instead of opening a new connection per request.
let connecting = null;

const connectDB = () => {
	if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
	if (!connecting) {
		const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/auction-hub';
		connecting = mongoose
			.connect(uri, { serverSelectionTimeoutMS: 10000 })
			.then(() => {
				console.log('MongoDB connected');
				return mongoose.connection;
			})
			.catch((err) => {
				connecting = null; // let the next request try again
				console.error('MongoDB connection error:', err.message);
				throw err;
			});
	}
	return connecting;
};

/**
 * Make the database indexes match the schemas exactly. This also removes
 * stale indexes left by older versions of the app (e.g. a global unique
 * teamName index), which would otherwise reject valid inserts.
 */
export async function syncIndexes() {
	for (const model of [Tournament, Team, Player, AuctionState]) {
		await model.syncIndexes();
	}
}

/**
 * One-off fixes for data saved by older versions. Safe to run on every start:
 * each update matches nothing once the data is current.
 */
export async function migrateData() {
	// Playing owners used to cost an optional fixed price; they are now free.
	await Player.updateMany({ isOwner: true, soldPrice: { $ne: 0 } }, { $set: { soldPrice: 0 } });
	await Tournament.collection.updateMany({ ownerPlayerPrice: { $exists: true } }, { $unset: { ownerPlayerPrice: '' } });
}

export default connectDB;
