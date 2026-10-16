import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import Tournament from '../models/Tournament.js';
import { getSnapshot, roomFor } from '../services/auction.js';
import logger from '../utils/logger.js';

/**
 * Live auction sockets. Control panels and display screens join their
 * tournament's room and receive `auction:state` (full snapshot) on join and
 * `auction:event` (event details + snapshot) after every change.
 */
export function setupSocket(io) {
	io.on('connection', (socket) => {
		socket.on('join-tournament', async (tournamentId) => {
			if (!mongoose.isValidObjectId(tournamentId)) return;

			for (const room of socket.rooms) {
				if (room.startsWith('tournament:')) socket.leave(room);
			}
			socket.join(roomFor(tournamentId));

			try {
				const tournament = await Tournament.findById(tournamentId);
				if (!tournament) return socket.emit('auction:error', { message: 'Tournament not found' });
				socket.emit('auction:state', await getSnapshot(tournament));
			} catch (error) {
				logger.error('Socket join failed', { message: error.message });
			}
		});

		socket.on('ping', () => socket.emit('pong'));
	});
}

/**
 * Tell everyone watching a tournament that something happened. Returns the
 * event so the HTTP response can carry the same id (clients use it to avoid
 * playing an animation twice).
 */
export async function broadcast(io, tournament, type, details = {}) {
	const event = { id: randomUUID(), type, ...details, snapshot: await getSnapshot(tournament) };
	io?.to(roomFor(tournament._id)).emit('auction:event', event);
	return event;
}
