// Long-running server: the Express app plus Socket.IO for instant live
// updates. Use this locally and on hosts that keep a process running
// (Render, Railway, Fly.io, a VPS). Vercel uses api/index.js instead.
import http from 'http';
import { Server } from 'socket.io';

import app from './app.js';
import connectDB from './config/database.js';
import { setupSocket } from './socket/index.js';
import { isCloudinaryConfigured } from './services/cloudinary.js';
import logger from './utils/logger.js';

const server = http.createServer(app);
const io = new Server(server, {
	// Increase timeouts to prevent disconnections during a long auction
	pingTimeout: 120000, // 2 minutes
	pingInterval: 30000, // 30 seconds
	transports: ['polling', 'websocket'],
});

app.set('io', io);
app.set('realtime', 'socket');
setupSocket(io);

const PORT = process.env.PORT || 3000;

const start = async () => {
	await connectDB();

	if (!isCloudinaryConfigured()) {
		logger.warn('Cloudinary is not configured: image uploads are disabled until it is added to .env');
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
