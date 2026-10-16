import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import connectDB from './config/database.js';
import Team from './models/Team.js';
import Player from './models/Player.js';

const OUTPUT_DIR = path.join(process.cwd(), 'exports', 'teams');

const COLORS = {
    text: '#111827',
    subText: '#4B5563',
    grid: '#D1D5DB',
    headerBg: '#F3F4F6',
    rowAlt: '#F9FAFB',
};

const TABLE = {
    top: 232,
    headerHeight: 26,
    rowHeight: 22,
    bottomPadding: 52,
};

const COLUMNS = [
    { key: 'serial', label: '#', x: 40, width: 24, align: 'left' },
    { key: 'name', label: 'Player Name', x: 64, width: 170, align: 'left' },
    { key: 'phone', label: 'Phone', x: 234, width: 100, align: 'left' },
    { key: 'jersey', label: 'Jersey', x: 334, width: 56, align: 'left' },
    { key: 'role', label: 'Role', x: 390, width: 105, align: 'left' },
    { key: 'paid', label: 'Paid', x: 495, width: 60, align: 'left' },
];

const formatCurrency = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;

const sanitizeFileName = (name) =>
    String(name || 'team')
        .trim()
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '') || 'team';

const safeColor = (color) => {
    if (typeof color !== 'string') return '#1F2937';
    return /^#[0-9A-F]{6}$/i.test(color) ? color : '#1F2937';
};

const drawPageHeader = (doc, team, pageNumber) => {
    const teamColor = safeColor(team.color);

    doc.rect(36, 34, 523, 58).fill(teamColor);

    doc
        .fillColor('white')
        .font('Helvetica-Bold')
        .fontSize(16)
        .text('JAIN PREMIER LEAGUE - TEAM SQUAD SHEET', 48, 52, {
            width: 500,
            align: 'left',
        });

    doc
        .font('Helvetica')
        .fontSize(9)
        .text(`Page ${pageNumber}`, 48, 74, { width: 500, align: 'right' });

    doc.fillColor(COLORS.text);

    const spent = (team.initialPurse || 0) - (team.remainingPurse || 0);

    doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .text(team.teamName || 'Unnamed Team', 40, 110);

    doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLORS.subText)
        .text(`Players: ${team.playersCount || 0}`, 40, 136)
        .text(`Total Spent: ${formatCurrency(spent)}`, 260, 136)
        .text(`Remaining Purse: ${formatCurrency(team.remainingPurse)}`, 260, 152)
        .text(`Generated: ${new Date().toLocaleString('en-IN')}`, 260, 168);

    doc.fillColor(COLORS.text);

    doc
        .moveTo(40, 192)
        .lineTo(555, 192)
        .lineWidth(1)
        .strokeColor(COLORS.grid)
        .stroke();
};

const drawTableHeader = (doc, y) => {
    doc.rect(40, y, 515, TABLE.headerHeight).fill(COLORS.headerBg);

    doc
        .rect(40, y, 515, TABLE.headerHeight)
        .lineWidth(0.8)
        .strokeColor(COLORS.grid)
        .stroke();

    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.text);
    COLUMNS.forEach((col) => {
        doc.text(col.label, col.x + 2, y + 8, {
            width: col.width - 4,
            align: col.align,
            lineBreak: false,
        });
    });

    doc.fillColor(COLORS.text).font('Helvetica').fontSize(8.5);
};

const drawRow = (doc, y, row, rowIndex) => {
    const bg = rowIndex % 2 === 0 ? '#FFFFFF' : COLORS.rowAlt;
    doc.rect(40, y, 515, TABLE.rowHeight).fill(bg);

    doc
        .rect(40, y, 515, TABLE.rowHeight)
        .lineWidth(0.5)
        .strokeColor(COLORS.grid)
        .stroke();

    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.text);
    COLUMNS.forEach((col) => {
        doc.text(row[col.key] || '-', col.x + 2, y + 7, {
            width: col.width - 4,
            align: col.align,
            lineBreak: false,
            ellipsis: true,
        });
    });
};

const makeRows = (players) => {
    return players.map((player, index) => {
        return {
            serial: String(index + 1),
            name: player.name || '-',
            phone: player.phoneNumber || '-',
            jersey: player.jerseySize || '-',
            role: player.playerType || '-',
            paid: formatCurrency(player.soldPrice),
        };
    });
};

const buildTeamPdf = async (team, players) => {
    const rows = makeRows(players);
    const safeName = sanitizeFileName(team.teamName);
    const outputFile = path.join(OUTPUT_DIR, `${String(team.teamNumber || '').padStart(2, '0')}_${safeName}.pdf`);

    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 30, bottom: 36, left: 36, right: 36 },
    });

    const stream = fs.createWriteStream(outputFile);
    doc.pipe(stream);

    let y = TABLE.top;
    let pageNumber = 1;

    drawPageHeader(doc, team, pageNumber);
    drawTableHeader(doc, y);
    y += TABLE.headerHeight;

    rows.forEach((row, index) => {
        const bottomLimit = doc.page.height - TABLE.bottomPadding;
        if (y + TABLE.rowHeight > bottomLimit) {
            doc.addPage();
            pageNumber += 1;
            drawPageHeader(doc, team, pageNumber);
            y = TABLE.top;
            drawTableHeader(doc, y);
            y += TABLE.headerHeight;
        }

        drawRow(doc, y, row, index);
        y += TABLE.rowHeight;
    });

    if (!rows.length) {
        doc
            .font('Helvetica-Oblique')
            .fontSize(11)
            .fillColor(COLORS.subText)
            .text('No players assigned to this team.', 40, y + 14);
    }

    doc.end();

    await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
    });

    return outputFile;
};

const buildAllTeamPdfs = async () => {
    await connectDB();

    const teams = await Team.find({}).sort({ teamNumber: 1 }).lean();

    if (!teams.length) {
        throw new Error('No teams found in database.');
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const createdFiles = [];
    for (const team of teams) {
        const players = await Player.find({ soldTo: team._id, status: 'sold' })
            .sort({ soldPrice: -1, name: 1 })
            .lean();

        const file = await buildTeamPdf(team, players);
        createdFiles.push(file);
    }

    console.log(`Generated ${createdFiles.length} team PDF files:`);
    createdFiles.forEach((filePath) => console.log(`- ${filePath}`));
};

buildAllTeamPdfs()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Failed to generate team PDFs:', error.message);
        process.exit(1);
    });
