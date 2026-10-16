import Player from '../models/Player.js';
import Team from '../models/Team.js';
import AuctionState from '../models/AuctionState.js';

/**
 * Show public display page
 */
export const showDisplay = async (req, res) => {
	try {
		// Get all teams sorted by team number
		const teams = await Team.find().sort('teamNumber').lean();

		// Get current auction state
		let auctionState = await AuctionState.findOne().lean();
		let currentPlayer = null;
		let currentBidder = null;

		if (auctionState && auctionState.currentPlayer) {
			currentPlayer = await Player.findById(auctionState.currentPlayer).lean();
		}

		if (auctionState && auctionState.currentBidder) {
			currentBidder = await Team.findById(auctionState.currentBidder).lean();
		}

		// Get statistics
		const soldCount = await Player.countDocuments({ status: 'sold' });
		const unsoldCount = await Player.countDocuments({ status: 'unsold' });
		const totalPlayers = await Player.countDocuments();

		res.render('public/display', {
			teams: teams.map((t) => ({
				_id: t._id,
				teamName: t.teamName,
				teamNumber: t.teamNumber,
				color: t.color,
				logo: t.logo,
				remainingPurse: t.remainingPurse,
				initialPurse: t.initialPurse || 1000000,
				playersCount: t.playersCount,
			})),
			currentPlayer,
			currentBidder,
			auctionState: auctionState || {
				currentBid: 0,
				isActive: false,
				roundNumber: 0,
				bidHistory: [],
			},
			soldCount,
			unsoldCount,
			totalPlayers,
		});
	} catch (error) {
		console.error('Error showing display:', error);
		res.status(500).send('Error loading display');
	}
};

/**
 * Get display data via API (for polling fallback)
 */
export const getDisplayData = async (req, res) => {
	try {
		const teams = await Team.find().sort('teamNumber').lean();
		const auctionState = await AuctionState.findOne().lean();

		let currentPlayer = null;
		let currentBidder = null;

		if (auctionState && auctionState.currentPlayer) {
			currentPlayer = await Player.findById(auctionState.currentPlayer).lean();
		}

		if (auctionState && auctionState.currentBidder) {
			currentBidder = await Team.findById(auctionState.currentBidder).lean();
		}

		const soldCount = await Player.countDocuments({ status: 'sold' });
		const unsoldCount = await Player.countDocuments({ status: 'unsold' });

		res.json({
			teams: teams.map((t) => ({
				_id: t._id,
				teamName: t.teamName,
				teamNumber: t.teamNumber,
				color: t.color,
				logo: t.logo,
				remainingPurse: t.remainingPurse,
				playersCount: t.playersCount,
			})),
			currentPlayer,
			currentBidder,
			auctionState: auctionState || {},
			soldCount,
			unsoldCount,
		});
	} catch (error) {
		console.error('Error getting display data:', error);
		res.status(500).json({ error: error.message });
	}
};

export default {
	showDisplay,
	getDisplayData,
};
