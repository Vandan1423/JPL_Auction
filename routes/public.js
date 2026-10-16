import express from 'express';
import { getDisplayData, showDisplay, showDisplayIndex } from '../controllers/displayController.js';

const router = express.Router();

// Public projector screens
router.get('/display', showDisplayIndex);
router.get('/display/:slug', showDisplay);

// Polling fallback for the display when the socket connection drops
router.get('/api/display/:slug', getDisplayData);

export default router;
