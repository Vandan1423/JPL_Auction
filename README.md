# JPL Auction

A real-time cricket player auction platform built for a local cricket league (Jain Premier League). An admin runs the auction from a control panel while a public display screen updates live for everyone in the room.

**Stack:** Node.js · Express · MongoDB (Mongoose) · Socket.IO · EJS · ExcelJS · PDFKit

## Features

- **Live auction control:** pick a player manually or at random by category, take bids from 8 teams, then mark the player sold, unsold or withdrawn. The last sale can be undone.
- **Real-time public display:** a projector-friendly screen that updates over Socket.IO as bids come in. It reconnects and restores the auction state if the connection drops.
- **Purse-aware bidding rules:** tiered minimum increments for each category, plus a max-bid limit for each team that keeps enough purse to fill the remaining squad slots at base price.
- **Player management:** add players one at a time or in bulk, edit them, search them, and drag to set the auction order.
- **Reports:** category-wise analytics, Excel exports (sold, unsold, team sheets) and PDF rosters for each team.
- **Admin auth:** password-protected admin panel with rolling sessions.

## Getting started

**Prerequisites:** Node.js 18+ and a running MongoDB, either local or Atlas.

```bash
git clone https://github.com/Vandan1423/JPL_Auction.git
cd JPL_Auction
npm install
cp .env.example .env      # then set ADMIN_PASSWORD and SESSION_SECRET
npm run seed              # wipes the database and loads 100 demo players + 8 teams
npm start
```

| Page | URL |
|---|---|
| Admin panel | http://localhost:3000/admin/login |
| Public display | http://localhost:3000/display |

> `npm run seed` **drops the whole database** set in `MONGODB_URI` before inserting demo data.

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with auto-reload (nodemon) |
| `npm run seed` | Reset the database and load demo data |
| `npm run export:players-pdf` | Export the player list PDF to `exports/` |
| `npm run export:players-pdf:premium` | Export a styled player roster PDF |
| `npm run export:teams-pdf` | Export one squad PDF per team to `exports/teams/` |

## Project structure

```
app.js              Express + Socket.IO server
config/             Database connection, default teams
controllers/        Admin, auction, player, team, reports and display logic
models/             Player, Team, AuctionState (Mongoose)
routes/             /admin, /auction and public routes
utils/              Bid rules, integrity checks, logger
views/              EJS templates (admin panel + live display)
public/             CSS, client-side JS, images
```

## Data & privacy

All players in the seed data are fictional and their phone numbers are placeholders. Real registration data (`*.csv`, player photos, exports and logs) is git-ignored and must never be committed.
