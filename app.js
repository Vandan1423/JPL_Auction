import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import express from 'express';
import dotenv from 'dotenv';
import session from 'express-session';
import bodyParser from 'body-parser';
import methodOverride from 'method-override';
import { Server } from 'socket.io';

import connectDB from './config/database.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import auctionRoutes from './routes/auction.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import logger from './utils/logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
	session({
		secret: process.env.SESSION_SECRET || 'change-me',
		resave: false,
		saveUninitialized: false,
		cookie: {
			maxAge: 24 * 60 * 60 * 1000, // 24 hours
			secure: false, // Set to true in production with HTTPS
			httpOnly: true,
			sameSite: 'lax'
		},
		rolling: true, // Reset maxAge on activity
	})
);

app.use(methodOverride('_method'));

const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: '*',
		methods: ['GET', 'POST'],
	},
	// Increase timeouts to prevent disconnections
	pingTimeout: 120000, // 2 minutes
	pingInterval: 30000,  // 30 seconds
	// Enable compression
	compression: true,
	// Reconnection settings
	allowUpgrade: true,
	transports: ['polling', 'websocket']
});

// Make io accessible to routes
app.set('io', io);

app.use((req, _res, next) => {
	req.io = io;
	next();
});

// Session keep-alive middleware - touch session on any request to prevent expiry
app.use((req, res, next) => {
	if (req.session && req.session.isAdmin) {
		// Touch the session to reset the expiration time
		req.session.touch();
	}
	next();
});

// Add endpoint for session keep-alive from client
app.post('/keep-alive', (req, res) => {
	if (req.session && req.session.isAdmin) {
		req.session.touch();
		res.json({ status: 'success', timestamp: new Date().toISOString() });
	} else {
		res.status(401).json({ status: 'error', message: 'Not authenticated' });
	}
});

// Socket.IO connection handling
io.on('connection', async (socket) => {
	console.log('New client connected:', socket.id);

	// Join auction room
	socket.join('auction-room');

	try {
		// Import the necessary models
		const { default: AuctionState } = await import('./models/AuctionState.js');
		const { default: Player } = await import('./models/Player.js');
		const { default: Team } = await import('./models/Team.js');

		// Get current auction state to restore on reconnection
		const auctionState = await AuctionState.findOne().populate('currentPlayer currentBidder');
		let teamsData = null;

		if (auctionState && auctionState.currentPlayer) {
			teamsData = await Team.find().sort('teamNumber');
		}

		// Send initial connection confirmation with current state
		socket.emit('connected', {
			message: 'Connected to auction server',
			socketId: socket.id,
			auctionState: auctionState,
			teamsData: teamsData,
		});

		// If there's an active auction, restore the state
		if (auctionState && auctionState.isActive && auctionState.currentPlayer) {
			socket.emit('player-selected', {
				player: auctionState.currentPlayer,
				auctionState: auctionState,
				teams: teamsData,
			});
		}

	} catch (error) {
		console.error('Error getting auction state on connection:', error);
		socket.emit('connected', {
			message: 'Connected to auction server',
			socketId: socket.id,
		});
	}

	// Handle room joining
	socket.on('join-room', (room) => {
		socket.join(room);
		console.log(`Socket ${socket.id} joined room: ${room}`);
	});

	// Handle keep-alive ping
	socket.on('ping', () => {
		socket.emit('pong');
	});

	// Handle state restoration request
	socket.on('restore-state', async () => {
		try {
			const { default: AuctionState } = await import('./models/AuctionState.js');
			const { default: Team } = await import('./models/Team.js');

			const auctionState = await AuctionState.findOne().populate('currentPlayer currentBidder');
			const teamsData = await Team.find().sort('teamNumber');

			socket.emit('state-restored', {
				auctionState: auctionState,
				teamsData: teamsData,
			});

			if (auctionState && auctionState.isActive && auctionState.currentPlayer) {
				socket.emit('player-selected', {
					player: auctionState.currentPlayer,
					auctionState: auctionState,
					teams: teamsData,
				});
			}
		} catch (error) {
			console.error('Error restoring state:', error);
		}
	});

	socket.on('disconnect', (reason) => {
		console.log(`Client disconnected: ${socket.id}, Reason: ${reason}`);
	});
});

app.use('/admin', adminRoutes);
app.use('/auction', auctionRoutes);
app.use('/', publicRoutes);

// Root redirect
app.get('/', (req, res) => {
  res.redirect('/admin/login');
});

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

const start = async () => {
	await connectDB();
	
	// Clean up old logs on startup
	logger.cleanup();
	
	server.listen(PORT, () => {
		logger.info(`Server started on port ${PORT}`);
		console.log(`Server running on http://localhost:${PORT}`);
		console.log(`Admin Panel: http://localhost:${PORT}/admin/login`);
		console.log(`Public Display: http://localhost:${PORT}/display`);
	});
};

start().catch((err) => {
	logger.error('Failed to start server', { error: err.message });
	console.error('Failed to start server:', err);
	process.exit(1);
});

export { io };
