# Auction Hub

A real-time player auction platform for any cricket tournament. Set up a tournament in a six-step wizard, register players (one by one, in bulk or from a Google Form export), then run the auction from a control panel while a projector screen updates live for everyone in the room.

**Stack:** Node.js · Express · MongoDB (Mongoose) · Socket.IO · EJS · Cloudinary · ExcelJS · PDFKit

## Features

- **Any tournament, many tournaments.** A setup wizard asks for the number of teams, squad size (minimum and maximum), purse per team, categories with base prices, bid-increment slabs, player roles and registration fields. Each tournament keeps its own teams, players and auction, and you switch between them after logging in.
- **Owners instead of captains.** Every team has an owner. If the owner also plays, they join the squad automatically and fill one slot for free: the purse is only for players bought at auction.
- **Correct bidding rules.** The opening bid is exactly the base price, and slab increments apply only from the second bid. The highest bidder can't raise its own bid. Categories can have their own increments and a per-team limit (for example, at most 2 "A" players per team).
- **Purse protection.** No team can bid so much that it can't complete its minimum squad at base prices. Each team's maximum bid is shown live, and the calculation accounts for the cheap players that cash-strapped rivals will be forced to buy.
- **Live control panel.** Next or random player (optionally by category), BID buttons that show the amount, custom bids, sold, unsold (re-queued, optionally moved down a category), withdraw, undo last bid and undo last sale, plus keyboard shortcuts (`1`–`9`, `N`, `R`, `Space`, `U`, `Backspace`, `Ctrl/⌘+Z`).
- **Projector display.** A display for each tournament at `/display/<tournament>`, with SOLD/UNSOLD animations. It reconnects on its own and falls back to polling.
- **Easy player entry.** Photos are cropped to a square and compressed in the browser before upload. Click any player's avatar to add a photo, or add many players at once with a photo per row.
- **Excel / CSV import.** Download a template with dropdowns for your roles and categories, or upload a Google Form export. Headers such as "Full Name" and "Mobile Number" are recognised, and every row is checked before anything is saved.
- **Reports.** Excel exports (sold players, unsold players, team sheets) and printable PDFs (player catalogue, one squad sheet per team).
- **Clean deletion.** Deleting a tournament (Settings → Danger zone, or the Tournaments page) removes its teams, owners, players and auction history from MongoDB and every image from Cloudinary, then reports what was removed.
- **Cloudinary free-plan aware.** Settings shows how much of the monthly credit allowance is used. If Cloudinary refuses a request because a plan limit is reached (monthly credits, the hourly request limit or the 10 MB file cap), the admin gets a clear "Cloudinary limit reached" message and a banner on every admin page instead of a raw API error.

## Getting started

**You need:** Node.js 18+, a MongoDB database (local or Atlas), and a free [Cloudinary](https://cloudinary.com) account for images.

```bash
npm install
cp .env.example .env      # then fill in the values below
npm start
```

| Variable | What it is |
|---|---|
| `MONGODB_URI` | MongoDB connection string, e.g. `mongodb://localhost:27017/auction-hub` |
| `ADMIN_PASSWORD` | Password for the admin panel |
| `SESSION_SECRET` | Any long random string |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | From the Cloudinary console (cloud name on the dashboard; key and secret under Settings → API Keys). Or set `CLOUDINARY_URL` (`cloudinary://key:secret@cloud`) instead. |
| `PORT` | Optional, defaults to 3000 |

The app runs without Cloudinary; photo and logo uploads simply stay switched off until the keys are set. On the free plan, keep an eye on the usage meter in **Settings → Image uploads**: when the monthly credits run out, uploads stop (the auction itself keeps working) until usage drops over the rolling 30 days.

| Page | URL |
|---|---|
| Admin panel | http://localhost:3000/admin/login |
| Live display | http://localhost:3000/display |

## Deploying to Vercel

The repository is ready for Vercel: `api/index.js` exposes the Express app as a serverless function, `vercel.json` routes every request to it, and `public/` is served from Vercel's CDN.

1. Create a free **MongoDB Atlas** cluster. Under Network Access, allow `0.0.0.0/0` (Vercel's IP addresses change). Copy the connection string.
2. On vercel.com, choose **Add New → Project** and import the GitHub repository. Leave the framework preset as **Other** and leave the build settings empty.
3. Under **Settings → Environment Variables**, add `MONGODB_URI`, `ADMIN_PASSWORD`, `SESSION_SECRET` and the three `CLOUDINARY_*` variables, then deploy.

**Live updates on Vercel.** Serverless functions can't keep WebSocket connections open, so on Vercel the control panel and the live display fetch the latest auction state every ~1.5 seconds instead of using Socket.IO. Bids, sales and the SOLD/UNSOLD animations still show up, just up to about a second later. To get instant updates, run `npm start` on a host that keeps a process running (Render, Railway, Fly.io or a VPS). The same code then switches to Socket.IO automatically.

Uploads are limited to 4 MB per file (Vercel caps request bodies at 4.5 MB). Photos are compressed in the browser first, so a normal phone photo is far below that.

## Demo data

`npm run seed:demo` creates a ready-made tournament, **Skyline Premier League 2026**, for trying the app out and taking screenshots: 8 teams with logos and owners (three of whom play), 96 players across Platinum, Gold and Silver, each with a photo. The auction is run through the real bidding services, so every sale follows the purse, category and wicket-keeper rules.

| Command | Result |
|---|---|
| `npm run seed:demo` | Auction half done: 56 sold, a few unsold, one player under the hammer with bids |
| `npm run seed:demo -- --stage=fresh` | Every player still in the pool, to run the auction yourself |
| `npm run seed:demo -- --stage=complete` | Every player sold: full squads, reports and PDFs |
| `npm run seed:demo -- --remove` | Delete the demo tournament |

Re-running replaces only the demo tournament; your other tournaments are untouched. With Cloudinary configured, the photos and logos are uploaded to your account like real ones (and removed again with the tournament). Without it they are linked directly.

All people in the demo are fictional: invented names, stock portraits from [randomuser.me](https://randomuser.me) and no phone numbers.

## Running an auction

1. **Create the tournament.** Log in and click **New tournament**. The wizard's steps: details and logo → squad size and purse → categories and bid increments → player roles and form fields → teams, logos and owners → unsold-player rule and review.
2. **Add players.** Use **Players → Add player** for one at a time, **Bulk add** for a quick table, or **Import Excel/CSV** for a whole registration list.
3. **Set the order.** **Players → Auction order** lets you drag players into order, or arrange them by category or at random in one click.
4. **Open the live display** on the projector. The link is on the dashboard and in Settings.
5. **Run the auction** from **Auction**. Press `N` for the next player, a team's number (or its BID button) to bid, and `Space` to sell.

Once the auction has started (any player sold or passed unsold), settings that would change purses or squads (purse, squad size, base prices, number of teams) are locked. Names, colours, logos and bid increments stay editable. **Settings → Reset auction** puts every player back in the pool and unlocks everything.

## How bidding works

| Current bid | Example slab | Next bid |
|---|---|---|
| no bids yet (base ₹10,000) | n/a | **₹10,000** (the base price) |
| ₹10,000 | from ₹0: +₹2,000 | ₹12,000 |
| ₹50,000 | from ₹50,000: +₹5,000 | ₹55,000 |

**Purse protection.** In a fresh auction with 8 teams, a ₹10,00,000 purse, 9 players to buy and ₹10,000 as the cheapest base price, a team's maximum bid is ₹10,00,000 − 8 × ₹10,000 = **₹9,20,000**. When rivals are short of money, the cheap players they will be forced to take are set aside before your reserve is calculated. The rules live in `services/bidRules.js` as pure functions with unit tests.

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with auto-reload (nodemon) |
| `npm test` | Run the unit tests (bidding rules, spreadsheet import, Cloudinary limit errors) |
| `npm run seed:demo` | Create the demo tournament (see [Demo data](#demo-data)) |

## Project structure

```
app.js                Express app (routes, sessions, views)
server.js             Long-running server: app + Socket.IO (npm start)
api/index.js          Vercel serverless entry (same app, live screens poll)
config/               Database connection, app-wide constants
models/               Tournament, Team, Player, AuctionState
services/             Bid rules, auction operations, standings, Cloudinary,
                      spreadsheet import, PDF layouts, tournament setup
controllers/          Request handlers for each area of the app
routes/               /admin, /auction and public display routes
middleware/           Auth, tournament context, uploads, view helpers, errors
socket/               Live auction rooms (one per tournament)
views/                EJS templates: admin panel, setup wizard, live display
public/               CSS, browser scripts, logo
scripts/              Demo tournament seed (npm run seed:demo)
test/                 node:test unit tests
```

## Data & privacy

Everything the app stores is in MongoDB. Images live in Cloudinary under `auction-hub/<tournament id>/`, and only their links are saved in the database. Deleting a tournament also deletes its images. Nothing is written inside the project folder: downloads are generated on demand and streamed to the browser, and logs go to the console.

Registration lists contain people's phone numbers, so `.csv`, `.xlsx` and `.pdf` files are git-ignored. Never commit real player data.
