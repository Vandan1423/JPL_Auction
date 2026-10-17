import express from 'express';
import * as auctionController from '../controllers/auctionController.js';
import { isAuthenticated } from '../middleware/auth.js';
import { loadTournament, requireSetupComplete } from '../middleware/tournament.js';

const router = express.Router();
const ready = [isAuthenticated, loadTournament, requireSetupComplete];

// Control panel
router.get('/control', ...ready, auctionController.showAuctionControl);

// Live operations: each one broadcasts an `auction:event` to the tournament room
router.get('/api/state', ...ready, auctionController.apiState);
router.get('/api/queue', ...ready, auctionController.apiQueue);
router.post('/api/start-player', ...ready, auctionController.apiStartPlayer);
router.post('/api/next-player', ...ready, auctionController.apiNextPlayer);
router.post('/api/place-bid', ...ready, auctionController.apiPlaceBid);
router.post('/api/undo-bid', ...ready, auctionController.apiUndoBid);
router.post('/api/mark-sold', ...ready, auctionController.apiMarkSold);
router.post('/api/mark-unsold', ...ready, auctionController.apiMarkUnsold);
router.post('/api/withdraw-player', ...ready, auctionController.apiWithdrawPlayer);
router.post('/api/undo-sale', ...ready, auctionController.apiUndoSale);

export default router;
