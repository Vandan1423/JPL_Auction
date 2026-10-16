import express from 'express';
import * as adminController from '../controllers/adminController.js';
import * as playerController from '../controllers/playerController.js';
import * as teamController from '../controllers/teamController.js';
import * as reportsController from '../controllers/reportsController.js';
import * as auctionUtils from '../utils/auctionUtils.js';
import { isAuthenticated, isNotAuthenticated } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.get('/login', isNotAuthenticated, adminController.showLogin);
router.post('/login', adminController.handleLogin);

// Protected routes
router.post('/logout', isAuthenticated, adminController.logout);
router.get('/dashboard', isAuthenticated, adminController.showDashboard);

// Player management routes
router.get('/players', isAuthenticated, playerController.getAllPlayers);
router.get('/players/add', isAuthenticated, playerController.showAddPlayerForm);
router.post('/players/add', isAuthenticated, playerController.addPlayer);
router.get('/players/bulk', isAuthenticated, playerController.showBulkAddForm);
router.post('/players/bulk', isAuthenticated, playerController.bulkAddPlayers);
router.get('/players/edit/:id', isAuthenticated, playerController.showEditPlayerForm);
router.post('/players/edit/:id', isAuthenticated, playerController.editPlayer);
router.post('/players/delete/:id', isAuthenticated, playerController.deletePlayer);

router.get('/players/reorder', isAuthenticated, playerController.showReorderPage);

// AJAX endpoints for players
router.get('/api/players/search', isAuthenticated, playerController.searchPlayers);
router.get('/api/players/category/:category', isAuthenticated, playerController.getPlayersByCategory);
router.post('/api/players/reorder', isAuthenticated, playerController.savePlayerOrder);

// Team management routes
router.get('/teams', isAuthenticated, teamController.getAllTeams);
router.get('/teams/setup', isAuthenticated, teamController.showTeamsSetup);
router.post('/teams/create', isAuthenticated, teamController.createInitialTeams);
router.get('/teams/:id', isAuthenticated, teamController.getTeamDetails);
router.post('/teams/:id/update', isAuthenticated, teamController.updateTeamInfo);
router.post('/teams/:id/reset', isAuthenticated, teamController.resetTeam);

// AJAX endpoints for teams
router.get('/api/teams/summary', isAuthenticated, teamController.getTeamsSummary);
router.get('/api/teams/:id/max-bid', isAuthenticated, teamController.calculateMaxBidForTeam);

// Reports routes
router.get('/reports', isAuthenticated, reportsController.showReportsDashboard);
router.get('/reports/export/sold-players', isAuthenticated, reportsController.exportSoldPlayersExcel);
router.get('/reports/export/team-sheets', isAuthenticated, reportsController.exportTeamSheetsExcel);
router.get('/reports/export/unsold-players', isAuthenticated, reportsController.exportUnsoldPlayersExcel);
router.get('/reports/team-pdf/:teamId', isAuthenticated, reportsController.generateTeamPDF);

// Settings page
router.get('/settings', isAuthenticated, (req, res) => {
    res.render('admin/settings');
});

// Utility API endpoints
router.post('/api/reset-auction-keep-data', isAuthenticated, async (req, res) => {
    const result = await auctionUtils.resetAuctionKeepPlayersTeams();
    res.json(result);
});

router.post('/api/reset-auction', isAuthenticated, async (req, res) => {
    const result = await auctionUtils.resetEntireAuction();
    res.json(result);
});

router.get('/api/validate-integrity', isAuthenticated, async (req, res) => {
    const result = await auctionUtils.validateAuctionIntegrity();
    res.json(result);
});

router.post('/api/recalculate-stats', isAuthenticated, async (req, res) => {
    const result = await auctionUtils.recalculateTeamStats();
    res.json(result);
});

router.get('/api/auction-progress', isAuthenticated, async (req, res) => {
    const progress = await auctionUtils.getAuctionProgress();
    res.json(progress);
});

// Auction control redirect
router.get('/auction', isAuthenticated, (req, res) => {
  res.redirect('/auction/control');
});

// Redirect /admin to dashboard
router.get('/', isAuthenticated, (req, res) => {
  res.redirect('/admin/dashboard');
});

export default router;
