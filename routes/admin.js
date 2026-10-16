import express from 'express';
import * as adminController from '../controllers/adminController.js';
import * as tournamentController from '../controllers/tournamentController.js';
import * as setupController from '../controllers/setupController.js';
import * as playerController from '../controllers/playerController.js';
import * as teamController from '../controllers/teamController.js';
import * as reportsController from '../controllers/reportsController.js';
import * as settingsController from '../controllers/settingsController.js';
import { isAuthenticated, isNotAuthenticated } from '../middleware/auth.js';
import { loadTournament, requireSetupComplete } from '../middleware/tournament.js';
import { acceptImages, acceptSpreadsheet } from '../middleware/upload.js';

const router = express.Router();

// A tournament chosen on the tournaments page...
const inTournament = [isAuthenticated, loadTournament];
// ...that has finished the setup wizard.
const ready = [...inTournament, requireSetupComplete];

// Login
router.get('/login', isNotAuthenticated, adminController.showLogin);
router.post('/login', adminController.handleLogin);
router.post('/logout', isAuthenticated, adminController.logout);

// Tournaments
router.get('/tournaments', isAuthenticated, tournamentController.listTournaments);
router.get('/tournaments/new', isAuthenticated, setupController.showNewTournament);
router.post('/tournaments/new', isAuthenticated, acceptImages(), setupController.createTournament);
router.post('/tournaments/:id/open', isAuthenticated, tournamentController.openTournament);
router.post('/tournaments/:id/status', isAuthenticated, tournamentController.setTournamentStatus);
router.post('/tournaments/:id/delete', isAuthenticated, tournamentController.deleteTournament);

// Setup wizard (also used to edit settings later)
router.get('/setup', ...inTournament, (req, res) => res.redirect(`/admin/setup/${req.tournament.status === 'setup' ? req.tournament.setupStep : 1}`));
router.get('/setup/:step', ...inTournament, setupController.showStep);
router.post('/setup/:step', ...inTournament, acceptImages(), setupController.saveStep);

router.get('/dashboard', ...ready, adminController.showDashboard);

// Players
router.get('/players', ...ready, playerController.getAllPlayers);
router.get('/players/add', ...ready, playerController.showAddPlayerForm);
router.post('/players/add', ...ready, acceptImages(), playerController.addPlayer);
router.get('/players/bulk', ...ready, playerController.showBulkAddForm);
router.post('/players/bulk', ...ready, playerController.bulkAddPlayers);
router.get('/players/import', ...ready, playerController.showImportPage);
router.get('/players/import/template', ...ready, playerController.downloadImportTemplate);
router.post('/players/import/preview', ...ready, acceptSpreadsheet(), playerController.previewImport);
router.post('/players/:id/photo', ...ready, acceptImages(), playerController.uploadPlayerPhoto);
router.post('/players/:id/photo/remove', ...ready, playerController.removePlayerPhoto);
router.get('/players/edit/:id', ...ready, playerController.showEditPlayerForm);
router.post('/players/edit/:id', ...ready, acceptImages(), playerController.editPlayer);
router.post('/players/delete/:id', ...ready, playerController.deletePlayer);
router.get('/players/reorder', ...ready, playerController.showReorderPage);
router.post('/players/reorder/auto', ...ready, playerController.autoArrangeOrder);
router.post('/api/players/reorder', ...ready, playerController.savePlayerOrder);

// Teams (names, logos and owners are edited in setup step 5)
router.get('/teams', ...ready, teamController.getAllTeams);
router.get('/teams/:id', ...ready, teamController.getTeamDetails);
router.post('/teams/:id/reset', ...ready, teamController.resetTeam);

// Reports & exports (streamed straight to the browser)
router.get('/reports', ...ready, reportsController.showReportsDashboard);
router.get('/reports/export/sold-players', ...ready, reportsController.exportSoldPlayersExcel);
router.get('/reports/export/team-sheets', ...ready, reportsController.exportTeamSheetsExcel);
router.get('/reports/export/unsold-players', ...ready, reportsController.exportUnsoldPlayersExcel);
router.get('/reports/team-pdf/:teamId', ...ready, reportsController.generateTeamPDF);
router.get('/reports/squads.pdf', ...ready, reportsController.exportAllSquadsPDF);
router.get('/reports/catalogue.pdf', ...ready, reportsController.exportPlayerCataloguePDF);

// Settings
router.get('/settings', ...ready, settingsController.showSettings);
router.post('/settings/reset-auction', ...ready, settingsController.resetAuctionAction);

router.get('/auction', isAuthenticated, (req, res) => res.redirect('/auction/control'));
router.get('/', isAuthenticated, (req, res) => res.redirect('/admin/dashboard'));

export default router;
