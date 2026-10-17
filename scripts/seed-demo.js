// Create (or re-create) the demo tournament "Skyline Premier League 2026":
// 8 teams with logos and owners, 96 players with photos, and optionally an
// auction already in progress, ready for screenshots and local testing.
//
//   npm run seed:demo                     auction half done, one player under the hammer
//   npm run seed:demo -- --stage=fresh    everything still in the pool
//   npm run seed:demo -- --stage=complete every player sold (squads, reports, PDFs)
//   npm run seed:demo -- --remove         delete the demo tournament
//
// Bids go through the real auction services, so every sale obeys the same
// purse, category and role rules as a live auction. Re-running replaces the
// previous demo tournament (and its Cloudinary images) but nothing else.

import 'dotenv/config';
import mongoose from 'mongoose';

import connectDB, { syncIndexes } from '../config/database.js';
import Tournament from '../models/Tournament.js';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import {
	getAuctionState,
	markSold,
	markUnsold,
	placeBid,
	startNextPlayer,
} from '../services/auction.js';
import { getBiddingBoard, getPlayerCounts, getTeamStats } from '../services/standings.js';
import { describeCloudinaryError, isCloudinaryConfigured, pingCloudinary, uploadImageFrom } from '../services/cloudinary.js';
import { deleteTournament, syncOwnerPlayers } from '../services/tournamentSetup.js';
import { formatMoney } from '../utils/format.js';
import logger from '../utils/logger.js';
import * as demo from './demo-data.js';

const STAGES = ['fresh', 'live', 'complete'];
const args = Object.fromEntries(
	process.argv.slice(2).map((arg) => {
		const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
		return [key, value];
	})
);
const stage = args.stage || 'live';
if (!STAGES.includes(stage)) {
	console.error(`Unknown --stage "${stage}". Use one of: ${STAGES.join(', ')}`);
	process.exit(1);
}

// One line per sale would bury the summary.
logger.auction = () => {};

// Seeded random numbers: every run produces the same auction.
let seed = 2026;
const random = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const shuffle = (list) => {
	const copy = [...list];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
};

/** Run `task` over `items`, at most `limit` at a time. */
async function mapLimit(items, limit, task) {
	const results = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await task(items[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

// ───────────────────────── Images ─────────────────────────

const svgDataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

function teamLogoSvg({ shortName, color }) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 200 200">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".75"/><stop offset="1" stop-color="${color}"/></linearGradient></defs>
<path d="M100 8 L182 36 V96 C182 148 146 178 100 194 C54 178 18 148 18 96 V36 Z" fill="url(#g)" stroke="#0f172a" stroke-opacity=".3" stroke-width="4"/>
<path d="M100 22 L168 45 V96 C168 139 139 163 100 178 C61 163 32 139 32 96 V45 Z" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3"/>
<g fill="#fff" fill-opacity=".9"><circle cx="76" cy="58" r="5"/><circle cx="100" cy="52" r="6"/><circle cx="124" cy="58" r="5"/></g>
<text x="100" y="128" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="58" fill="#fff">${shortName}</text>
</svg>`;
}

function tournamentLogoSvg({ shortName, season }) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 200 200">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1E3A8A"/><stop offset="1" stop-color="#0F172A"/></linearGradient></defs>
<circle cx="100" cy="100" r="94" fill="url(#g)" stroke="#F59E0B" stroke-width="8"/>
<circle cx="100" cy="100" r="80" fill="none" stroke="#F59E0B" stroke-opacity=".5" stroke-width="2" stroke-dasharray="4 6"/>
<path d="M58 70 L142 70 L136 80 L64 80 Z" fill="#F59E0B"/>
<text x="100" y="124" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="46" fill="#fff">${shortName}</text>
<text x="100" y="152" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="20" letter-spacing="4" fill="#F59E0B">${season}</text>
</svg>`;
}

/**
 * With Cloudinary set up, images are uploaded exactly like real ones (so
 * face-cropping, resizing and PDF embedding all work). Without it, the
 * source URL is stored as-is and the app shows it directly.
 */
function imageStore(tournamentId, useCloudinary) {
	let limitReached = false;
	return async (source, kind, format) => {
		if (!useCloudinary || limitReached) return { url: source };
		try {
			return await uploadImageFrom(source, { tournamentId, kind, format });
		} catch (error) {
			if (error.cloudinaryLimit) {
				// Every further upload would fail the same way; link the rest directly.
				limitReached = true;
				console.warn(`\n  ! ${error.message}\n  ! Linking the remaining images directly instead.`);
			} else {
				console.warn(`  ! ${kind} image upload failed (${error.message}); using the original link`);
			}
			return { url: source };
		}
	};
}

// ───────────────────────── Auction simulation ─────────────────────────

const LIVE_STAGE_SALES = 56;

/** Bid the current player up among a few interested teams; returns the bid count. */
async function biddingWar(tournament, player, target) {
	let interested = null;
	let bids = 0;
	for (;;) {
		const state = await getAuctionState(tournament._id);
		const board = await getBiddingBoard(tournament, { auctionState: state, player });
		if (state.currentBidder && board.nextBid > target) break;

		const eligible = board.teams.filter((t) => t.canBid && t.maxBidAllowed >= board.nextBid);
		if (!interested) {
			// Teams with smaller squads are keener, so squads fill evenly.
			const keenest = eligible
				.map((t) => ({ id: String(t._id), score: t.playersCount + random() * 4 }))
				.sort((a, b) => a.score - b.score);
			interested = new Set(keenest.slice(0, 2 + Math.floor(random() * 3)).map((t) => t.id));
		}
		const candidates = eligible.filter((t) => interested.has(String(t._id)));
		const team = candidates.length ? pick(candidates) : state.currentBidder ? null : eligible[0];
		if (!team) break;

		await placeBid(tournament, team._id);
		bids++;
	}
	return bids;
}

const demand = (category) => demo.demand[category.name] || { min: 1, max: 2, unsold: 0.1 };

function targetPrice(tournament, player) {
	const category = tournament.getCategory(player.category);
	const { min, max } = demand(category);
	// Squaring skews prices low: a few stars go big, most sell near base.
	return category.basePrice * (min + (max - min) * random() ** 2);
}

/** Put the next player in the queue under the hammer and sell or pass them. */
async function auctionNext(tournament) {
	const { player } = await startNextPlayer(tournament);
	const category = tournament.getCategory(player.category);
	// Second time round, someone always takes them at base price.
	const skip = player.timesUnsold === 0 && random() < demand(category).unsold;
	const target = player.timesUnsold === 0 ? targetPrice(tournament, player) : 0;
	const bids = skip ? 0 : await biddingWar(tournament, player, target);
	if (bids) await markSold(tournament);
	else await markUnsold(tournament);
}

async function runAuction(tournament) {
	if (stage === 'fresh') return;

	const salesWanted = stage === 'live' ? LIVE_STAGE_SALES : Infinity;
	// Guards against a pool that can never empty (e.g. every squad full).
	for (let round = 0; round < 400; round++) {
		const counts = await getPlayerCounts(tournament);
		if (counts.pool === 0 || counts.sold >= salesWanted) break;
		await auctionNext(tournament);
	}

	if (stage === 'live') {
		// Leave one player under the hammer with a few bids for the live screens.
		const { player } = await startNextPlayer(tournament);
		const base = tournament.getCategory(player.category).basePrice;
		await biddingWar(tournament, player, base * 2.5);
	}
}

// ───────────────────────── Seed ─────────────────────────

async function createTournament() {
	const useCloudinary = isCloudinaryConfigured();
	if (useCloudinary) {
		try {
			await pingCloudinary();
			console.log('Cloudinary: connected, images will be uploaded to your account');
		} catch (error) {
			const info = describeCloudinaryError(error);
			if (info.kind === 'rate' || info.kind === 'quota') {
				console.error(info.message);
			} else {
				console.error(`Cloudinary rejected the keys in .env: ${error.message || error.error?.message}`);
				console.error('Check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, then try again.');
			}
			process.exit(1);
		}
	} else {
		console.log('Cloudinary: not configured, images will be linked directly (uploads stay off in the app)');
	}

	const tournament = await Tournament.create(demo.tournament);
	const store = imageStore(tournament._id, useCloudinary);
	tournament.logo = await store(svgDataUri(tournamentLogoSvg(demo.tournament)), 'tournament', 'png');
	await tournament.save();
	console.log(`Created ${tournament.displayName}`);

	// Teams, with logos and owner photos.
	const ownerPortrait = { men: 96, women: 10 };
	const teams = await mapLimit(demo.teams, 4, async (team, i) => {
		const { gender, plays, role, name } = team.owner;
		const portrait = demo.portraitUrl(gender, ownerPortrait[gender] + demo.teams.slice(0, i).filter((t) => t.owner.gender === gender).length);
		const [logo, photo] = await Promise.all([
			store(svgDataUri(teamLogoSvg(team)), 'teams', 'png'),
			store(portrait, 'owners'),
		]);
		return {
			tournament: tournament._id,
			order: i + 1,
			name: team.name,
			shortName: team.shortName,
			color: team.color,
			logo,
			owner: { name, photo, isPlaying: Boolean(plays), role: role || '' },
		};
	});
	await Team.insertMany(teams);
	await syncOwnerPlayers(tournament);
	console.log(`Added ${teams.length} teams with logos and owners`);

	// Players: registration numbers in sign-up order, auction order by category.
	const categoryId = Object.fromEntries(tournament.categories.map((c) => [c.name, c._id]));
	const registrations = shuffle(
		Object.entries(demo.players).flatMap(([category, list]) => list.map(([name, role]) => ({ name, role, category })))
	);
	const jerseyNumbers = shuffle(Array.from({ length: 99 }, (_, i) => String(i + 1)));
	const queue = new Map(
		tournament.categories.flatMap((c, rank) =>
			shuffle(registrations.filter((r) => r.category === c.name)).map((r, i) => [r.name, rank * 1000 + i + 1])
		)
	);

	process.stdout.write(`Adding ${registrations.length} players with photos `);
	const players = await mapLimit(registrations, 8, async (r, i) => {
		const photo = await store(demo.portraitUrl('men', i), 'players');
		if (i % 8 === 0) process.stdout.write('.');
		return {
			tournament: tournament._id,
			playerNumber: i + 1,
			name: r.name,
			role: r.role,
			category: categoryId[r.category],
			originalCategory: categoryId[r.category],
			age: 19 + Math.floor(random() * 18),
			jerseyNumber: jerseyNumbers[i % jerseyNumbers.length],
			jerseySize: pick(demo.JERSEY_SIZES),
			photo,
			auctionOrder: queue.get(r.name),
		};
	});
	await Player.insertMany(players);
	console.log(' done');

	return tournament;
}

async function printSummary(tournament) {
	const [counts, teams, state] = await Promise.all([
		getPlayerCounts(tournament),
		getTeamStats(tournament),
		getAuctionState(tournament._id),
	]);
	const money = (n) => formatMoney(n, tournament.currency);

	console.log(`\nAuction stage: ${stage}`);
	console.log(`Players: ${counts.sold} sold, ${counts.unsold} unsold, ${counts.available} not yet auctioned`);
	if (state.currentPlayer) {
		const player = await Player.findById(state.currentPlayer).lean();
		console.log(`Under the hammer: ${player.name}, current bid ${money(state.currentBid)}`);
	}
	console.log('');
	console.table(
		teams.map((t) => ({
			Team: t.name,
			Owner: t.owner.name + (t.owner.isPlaying ? ' (plays)' : ''),
			Squad: t.playersCount,
			Spent: money(t.spent),
			Left: money(t.remainingPurse),
		}))
	);

	const port = process.env.PORT || 3000;
	console.log(`\nAdmin panel:  http://localhost:${port}/admin/login  (Tournaments → ${tournament.displayName})`);
	console.log(`Live display: http://localhost:${port}/display/${tournament.slug}`);
}

async function main() {
	await connectDB();
	await syncIndexes();

	const existing = await Tournament.findOne({ slug: demo.DEMO_SLUG });
	if (existing) {
		await deleteTournament(existing);
		console.log(`Removed the previous ${existing.displayName}`);
	}
	if (args.remove) return;

	const tournament = await createTournament();
	process.stdout.write('Running the auction ');
	const started = Date.now();
	await runAuction(tournament);
	console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
	await printSummary(tournament);
}

main()
	.catch((error) => {
		console.error('\nSeeding failed:', error.message);
		process.exitCode = 1;
	})
	.finally(() => mongoose.disconnect());
