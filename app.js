// The Express app, without starting a server. It is used two ways:
//   • server.js  — a long-running server with Socket.IO (local, Render, Railway…)
//   • api/index.js — a Vercel serverless function (live screens poll instead)

// Load .env before any other module reads process.env.
import 'dotenv/config';

import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';

import connectDB, { migrateData, syncIndexes } from './config/database.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import auctionRoutes from './routes/auction.js';
import { viewLocals } from './middleware/viewLocals.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import logger from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';

const app = express();

// Behind Vercel/Render's proxy: needed for secure cookies and req.protocol.
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// "socket" when server.js attaches Socket.IO; otherwise screens poll for updates.
app.set('realtime', 'polling');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Connect before anything needs the database (including the session store).
// The connection is cached, so this is a no-op after the first request.
const dbReady = connectDB();
dbReady
	.then(() => syncIndexes())
	.then(() => migrateData())
	.catch((err) => logger.warn('Database upkeep skipped', { message: err.message }));
app.use((req, res, next) => {
	connectDB().then(() => next(), next);
});

// The secret signs the login cookie. A fixed fallback would be public in the
// source code and let anyone forge an admin session, so production refuses to
// start without one; locally a random secret is used (logins reset on restart).
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
	if (isProduction) {
		throw new Error('SESSION_SECRET is not set. Add a long random string to the environment variables.');
	}
	sessionSecret = randomBytes(32).toString('hex');
	logger.warn('SESSION_SECRET is not set: using a random one, so logins reset when the server restarts');
}

// Sessions are kept in MongoDB, so admins stay logged in across restarts and
// across serverless instances.
app.use(
	session({
		secret: sessionSecret,
		resave: false,
		saveUninitialized: false,
		store: MongoStore.create({
			clientPromise: dbReady.then((connection) => connection.getClient()),
			collectionName: 'sessions',
			ttl: 24 * 60 * 60, // seconds
		}),
		cookie: {
			maxAge: 24 * 60 * 60 * 1000, // 24 hours
			// HTTPS-only when the request came over HTTPS (Vercel, Render…),
			// still usable on http://localhost.
			secure: 'auto',
			httpOnly: true,
			sameSite: 'lax',
		},
		rolling: true, // Reset maxAge on activity
	})
);

app.use(viewLocals);

// Socket.IO server, if server.js attached one (undefined on Vercel).
app.use((req, _res, next) => {
	req.io = req.app.get('io');
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

export default app;
