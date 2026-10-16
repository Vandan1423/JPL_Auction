import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import connectDB from "./config/database.js";
import Player from "./models/Player.js";

const OUTPUT_DIR = path.join(process.cwd(), "exports");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "players-list.pdf");

const COLORS = {
    brand: "#0B1F3A",
    brandMuted: "#1D3A63",
    text: "#111111",
    subText: "#4B5563",
    headerBg: "#E5E7EB",
    rowAlt: "#F8FAFC",
    grid: "#C7CDD4",
};

const HEADER_BAND_TOP = 24;
const HEADER_BAND_HEIGHT = 44;
const TABLE_TOP = 98;
const TABLE_HEADER_HEIGHT = 30;
const ROW_HEIGHT = 66;
const FOOTER_HEIGHT = 20;

const COLUMNS = [
    { key: "serial", label: "#", width: 32, align: "center" },
    { key: "name", label: "Name", width: 170, align: "left" },
    { key: "mobile", label: "Mobile", width: 110, align: "center" },
    { key: "age", label: "Age", width: 44, align: "center" },
    { key: "tshirt", label: "T-Shirt", width: 62, align: "center" },
    { key: "role", label: "Role", width: 188, align: "left" },
    { key: "category", label: "Category", width: 72, align: "center" },
    { key: "image", label: "Image", width: 108, align: "center" },
];

const formatDate = (date) =>
    new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);

const getLocalImagePath = (imageUrl) => {
    if (!imageUrl || typeof imageUrl !== "string") return null;

    const normalized = imageUrl.replace(/^\/+/, "");
    const localPath = path.join(process.cwd(), "public", normalized);
    return fs.existsSync(localPath) ? localPath : null;
};

const getColumnLayout = (left) => {
    let cursor = left;
    const columns = COLUMNS.map((col) => {
        const current = { ...col, x: cursor };
        cursor += col.width;
        return current;
    });

    return {
        columns,
        left,
        width: cursor - left,
        right: cursor,
    };
};

const drawPageHeader = (doc, layout, totalPlayers, pageNumber) => {
    const left = layout.left;
    const right = layout.right;

    doc
        .rect(left, HEADER_BAND_TOP, layout.width, HEADER_BAND_HEIGHT)
        .fill(COLORS.brand);

    doc
        .font("Helvetica-Bold")
        .fontSize(17)
        .fillColor("white")
        .text("JPL Tournament Player Roster", left + 12, HEADER_BAND_TOP + 11, {
            align: "left",
        });

    doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#DDE7F5")
        .text(`Generated ${formatDate(new Date())}`, left + 12, HEADER_BAND_TOP + 29, {
            align: "left",
        });

    doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("white")
        .text(`Total Players: ${totalPlayers}`, left, HEADER_BAND_TOP + 13, {
            align: "right",
            width: layout.width - 12,
        });

    doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#DDE7F5")
        .text(`Page ${pageNumber}`, left, HEADER_BAND_TOP + 29, {
            align: "right",
            width: layout.width - 12,
        });

    doc
        .moveTo(left, HEADER_BAND_TOP + HEADER_BAND_HEIGHT)
        .lineTo(right, HEADER_BAND_TOP + HEADER_BAND_HEIGHT)
        .lineWidth(1)
        .strokeColor(COLORS.brandMuted)
        .stroke();

    doc.fillColor(COLORS.text);
};

const drawFooter = (doc, layout) => {
    const y = doc.page.height - doc.page.margins.bottom - FOOTER_HEIGHT + 2;

    doc
        .moveTo(layout.left, y - 6)
        .lineTo(layout.right, y - 6)
        .lineWidth(0.8)
        .strokeColor(COLORS.grid)
        .stroke();

    doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(COLORS.subText)
        .text("JPL Official Tournament Document", layout.left, y, {
            align: "left",
            width: layout.width,
        })
        .text("Confidential - For League Use", layout.left, y, {
            align: "right",
            width: layout.width,
        });

    doc.fillColor(COLORS.text);
};

const drawVerticalGridLines = (doc, y, height, columns, rightEdge) => {
    for (let i = 1; i < columns.length; i += 1) {
        const x = columns[i].x;
        doc
            .moveTo(x, y)
            .lineTo(x, y + height)
            .lineWidth(0.6)
            .strokeColor(COLORS.grid)
            .stroke();
    }

    doc
        .moveTo(rightEdge, y)
        .lineTo(rightEdge, y + height)
        .lineWidth(0.6)
        .strokeColor(COLORS.grid)
        .stroke();
};

const drawTableHeader = (doc, y, layout) => {
    doc.rect(layout.left, y, layout.width, TABLE_HEADER_HEIGHT).fill(COLORS.headerBg);

    doc
        .rect(layout.left, y, layout.width, TABLE_HEADER_HEIGHT)
        .lineWidth(0.8)
        .strokeColor(COLORS.grid)
        .stroke();

    drawVerticalGridLines(doc, y, TABLE_HEADER_HEIGHT, layout.columns, layout.right);

    doc.fillColor(COLORS.text).font("Helvetica-Bold").fontSize(10);
    layout.columns.forEach((col) => {
        const x = col.x + 6;
        doc.text(col.label, x, y + 9, {
            width: col.width - 12,
            align: col.align,
            lineBreak: false,
        });
    });

    doc.fillColor(COLORS.text).font("Helvetica");
};

const drawCellText = (doc, text, col, y, align = "left") => {
    doc.text(text, col.x + 6, y + 24, {
        width: col.width - 12,
        align,
        lineBreak: false,
        ellipsis: true,
    });
};

const drawImageCell = (doc, imagePath, imageCol, y) => {
    const pad = 8;
    const boxX = imageCol.x + pad;
    const boxY = y + pad;
    const boxW = imageCol.width - pad * 2;
    const boxH = ROW_HEIGHT - pad * 2;

    doc
        .rect(boxX, boxY, boxW, boxH)
        .lineWidth(0.6)
        .strokeColor(COLORS.grid)
        .stroke();

    if (!imagePath) {
        doc.font("Helvetica").fontSize(8).fillColor(COLORS.subText).text("No image", boxX, boxY + 22, {
            width: boxW,
            align: "center",
            lineBreak: false,
        });
        doc.fillColor(COLORS.text);
        return;
    }

    try {
        doc.image(imagePath, boxX + 1, boxY + 1, {
            fit: [boxW - 2, boxH - 2],
            align: "center",
            valign: "center",
        });
    } catch {
        doc.font("Helvetica").fontSize(8).fillColor(COLORS.subText).text("Image error", boxX, boxY + 22, {
            width: boxW,
            align: "center",
            lineBreak: false,
        });
        doc.fillColor(COLORS.text);
    }
};

const drawRow = (doc, player, index, y, layout) => {
    const rowBg = index % 2 === 0 ? "white" : COLORS.rowAlt;

    doc.rect(layout.left, y, layout.width, ROW_HEIGHT).fill(rowBg);

    doc
        .rect(layout.left, y, layout.width, ROW_HEIGHT)
        .lineWidth(0.6)
        .strokeColor(COLORS.grid)
        .stroke();

    drawVerticalGridLines(doc, y, ROW_HEIGHT, layout.columns, layout.right);

    const byKey = Object.fromEntries(layout.columns.map((c) => [c.key, c]));
    doc.font("Helvetica").fontSize(9.5).fillColor(COLORS.text);
    drawCellText(doc, String(index + 1), byKey.serial, y, "center");
    drawCellText(doc, player.name || "-", byKey.name, y, "left");
    drawCellText(doc, player.phoneNumber || "-", byKey.mobile, y, "center");
    drawCellText(doc, String(player.age ?? "-"), byKey.age, y, "center");
    drawCellText(doc, player.jerseySize || "-", byKey.tshirt, y, "center");
    drawCellText(doc, player.playerType || "-", byKey.role, y, "left");
    drawCellText(doc, player.category || "-", byKey.category, y, "center");

    const imagePath = getLocalImagePath(player.imageUrl);
    drawImageCell(doc, imagePath, byKey.image, y);

    doc.fillColor(COLORS.text);
};

const buildPdf = async () => {
    await connectDB();

    const players = await Player.find({})
        .sort({ category: 1, name: 1 })
        .lean();

    if (!players.length) {
        throw new Error("No players found in database.");
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margins: { top: 24, bottom: 24, left: 26, right: 26 },
    });

    const stream = fs.createWriteStream(OUTPUT_FILE);
    doc.pipe(stream);

    const layout = getColumnLayout(doc.page.margins.left);
    let pageNumber = 1;

    drawPageHeader(doc, layout, players.length, pageNumber);

    let y = TABLE_TOP;
    drawTableHeader(doc, y, layout);
    y += TABLE_HEADER_HEIGHT;

    for (let i = 0; i < players.length; i += 1) {
        const bottomLimit = doc.page.height - doc.page.margins.bottom - FOOTER_HEIGHT;

        if (y + ROW_HEIGHT > bottomLimit) {
            drawFooter(doc, layout);
            doc.addPage();
            pageNumber += 1;
            drawPageHeader(doc, layout, players.length, pageNumber);
            y = TABLE_TOP;
            drawTableHeader(doc, y, layout);
            y += TABLE_HEADER_HEIGHT;
        }

        drawRow(doc, players[i], i, y, layout);
        y += ROW_HEIGHT;
    }

    drawFooter(doc, layout);

    doc.end();

    await new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
    });

    console.log(`PDF generated: ${OUTPUT_FILE}`);
};

buildPdf()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Failed to generate player PDF:", error.message);
        process.exit(1);
    });
