// Load .env before any other module reads process.env.
import 'dotenv/config';

import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { Server } from 'socket.io';

import connectDB from './config/database.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import auctionRoutes from './routes/auction.js';
import { viewLocals } from './middleware/viewLocals.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { setupSocket } from './socket/index.js';
import { isCloudinaryConfigured } from './services/cloudinary.js';
import logger from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessions are kept in MongoDB, so admins stay logged in across server restarts.
app.use(
	session({
		secret: process.env.SESSION_SECRET || 'change-me',
		resave: false,
		saveUninitialized: false,
		store: MongoStore.create({
			clientPromise: mongoose.connection.asPromise().then((connection) => connection.getClient()),
			collectionName: 'sessions',
			ttl: 24 * 60 * 60, // seconds
		}),
		cookie: {
			maxAge: 24 * 60 * 60 * 1000, // 24 hours
			secure: false, // Set to true in production with HTTPS
			httpOnly: true,
			sameSite: 'lax',
		},
		rolling: true, // Reset maxAge on activity
	})
);

app.use(viewLocals);

const server = http.createServer(app);
const io = new Server(server, {
	// Increase timeouts to prevent disconnections during a long auction
	pingTimeout: 120000, // 2 minutes
	pingInterval: 30000, // 30 seconds
	transports: ['polling', 'websocket'],
});

app.set('io', io);
app.use((req, _res, next) => {
	req.io = io;
	next();
});

// Session keep-alive: touch the session on every admin request...
app.use((req, _res, next) => {
	if (req.session?.isAdmin) req.session.touch();
	next();
});

// ...and on the periodic ping sent by the admin pages.
app.post('/keep-alive', (req, res) => {
	if (req.session?.isAdmin) {
		req.session.touch();
		res.json({ status: 'success', timestamp: new Date().toISOString() });
	} else {
		res.status(401).json({ status: 'error', message: 'Not authenticated' });
	}
});

setupSocket(io);

app.use('/admin', adminRoutes);
app.use('/auction', auctionRoutes);
app.use('/', publicRoutes);

app.get('/', (_req, res) => {
	res.redirect('/admin/login');
});

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

const start = async () => {
	await connectDB();

	if (!isCloudinaryConfigured()) {
		logger.warn('CLOUDINARY_URL is not set: image uploads are disabled until it is added to .env');
	}

	server.listen(PORT, () => {
		logger.info(`Server started on port ${PORT}`);
		console.log(`Admin Panel:    http://localhost:${PORT}/admin/login`);
		console.log(`Public Display: http://localhost:${PORT}/display`);
	});
};

start().catch((err) => {
	logger.error('Failed to start server', { error: err.message });
	process.exit(1);
});

export { io };
