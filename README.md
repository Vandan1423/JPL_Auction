# Auction Hub

A real-time player auction platform for cricket tournaments. An admin runs the auction from a control panel while a public display screen updates live for everyone in the room.

**Stack:** Node.js · Express · MongoDB (Mongoose) · Socket.IO · EJS · ExcelJS · PDFKit

## Getting started

**Prerequisites:** Node.js 18+ and a running MongoDB, either local or Atlas.

```bash
npm install
cp .env.example .env      # then set ADMIN_PASSWORD, SESSION_SECRET and CLOUDINARY_URL
npm start
```

| Page | URL |
|---|---|
| Admin panel | http://localhost:3000/admin/login |
| Public display | http://localhost:3000/display |

## Data storage

Everything the app stores lives in MongoDB, and images live in Cloudinary. Nothing is written inside the project folder: exports are streamed to the browser as downloads and logs go to the console.
