import express from 'express';
import { showDisplay, getDisplayData } from '../controllers/displayController.js';

const router = express.Router();

// Public display page
router.get('/display', showDisplay);

// API endpoint for display data (polling fallback)
router.get('/api/display-data', getDisplayData);

export default router;
