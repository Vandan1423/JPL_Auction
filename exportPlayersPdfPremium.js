import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import connectDB from "./config/database.js";
import Player from "./models/Player.js";

const OUTPUT_DIR = path.join(process.cwd(), "exports");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "players-list-premium.pdf");
const LOGO_PATH = path.join(process.cwd(), "public", "images", "JPL_Logo.png");

const COLORS = {
    navy: "#0A1E3B",
    navySoft: "#153158",
    gold: "#C9A34A",
    text: "#111827",
    muted: "#4B5563",
    tableHeader: "#E5E7EB",
    tableGrid: "#C8CFD8",
    rowAlt: "#F8FAFC",
    white: "#FFFFFF",
};

const PAGE = {
    marginLeft: 28,
    marginRight: 28,
    marginTop: 24,
    marginBottom: 24,
    topBandHeight: 48,
    contentStartY: 98,
    sectionHeaderHeight: 28,
    tableHeaderHeight: 28,
    rowHeight: 62,
    footerReserve: 20,
};

const COLUMNS = [
    { key: "serial", label: "#", width: 30, align: "center" },
    { key: "name", label: "Name", width: 175, align: "left" },
    { key: "mobile", label: "Mobile", width: 110, align: "center" },
    { key: "age", label: "Age", width: 42, align: "center" },
    { key: "size", label: "T-Shirt", width: 62, align: "center" },
    { key: "role", label: "Role", width: 186, align: "left" },
    { key: "category", label: "Category", width: 70, align: "center" },
    { key: "image", label: "Photo", width: 115, align: "center" },
];

const CATEGORY_META = {
    A: { title: "Category A", subtitle: "Elite Players", color: "#7A4A16" },
    B: { title: "Category B", subtitle: "Advanced Players", color: "#1F4A73" },
    C: { title: "Category C", subtitle: "Emerging Players", color: "#2F6A3F" },
};

const formatDate = (date) =>
    new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);

const getColumnLayout = (left) => {
    let cursor = left;
    const columns = COLUMNS.map((col) => {
        const current = { ...col, x: cursor };
        cursor += col.width;
        return current;
    });

    return {
        left,
        right: cursor,
        width: cursor - left,
        columns,
    };
};

const getLocalImagePath = (imageUrl) => {
    if (!imageUrl || typeof imageUrl !== "string") return null;

    const normalized = imageUrl.replace(/^\/+/, "");
    const localPath = path.join(process.cwd(), "public", normalized);
    return fs.existsSync(localPath) ? localPath : null;
};

const drawTopBand = (doc, layout, heading, subHeading) => {
    const y = PAGE.marginTop;

    doc.rect(layout.left, y, layout.width, PAGE.topBandHeight).fill(COLORS.navy);

    doc
        .font("Helvetica-Bold")
        .fontSize(15)
        .fillColor(COLORS.white)
        .text(heading, layout.left + 12, y + 11, {
            width: layout.width - 24,
            align: "left",
        });

    doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#D7E3F5")
        .text(subHeading, layout.left + 12, y + 29, {
            width: layout.width - 24,
            align: "left",
        });

    doc
        .moveTo(layout.left, y + PAGE.topBandHeight)
        .lineTo(layout.right, y + PAGE.topBandHeight)
        .lineWidth(1)
        .strokeColor(COLORS.navySoft)
        .stroke();

    doc.fillColor(COLORS.text);
};

const drawCoverPage = (doc, layout, totalPlayers) => {
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    doc.rect(0, 0, pageWidth, pageHeight).fill(COLORS.navy);
    doc.rect(0, pageHeight - 95, pageWidth, 95).fill(COLORS.navySoft);

    if (fs.existsSync(LOGO_PATH)) {
        try {
            doc.image(LOGO_PATH, pageWidth / 2 - 60, 78, {
                fit: [120, 120],
                align: "center",
                valign: "center",
            });
        } catch {
            // Ignore logo render errors and continue.
        }
    }

    doc
        .font("Helvetica-Bold")
        .fontSize(34)
        .fillColor(COLORS.white)
        .text("JPL TOURNAMENT", 0, 228, { align: "center" });

    doc
        .font("Helvetica")
        .fontSize(17)
        .fillColor("#D6E1F2")
        .text("Official Player Directory", 0, 270, { align: "center" });

    doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .fillColor(COLORS.gold)
        .text(`Total Registered Players: ${totalPlayers}`, 0, 322, { align: "center" });

    doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor(COLORS.white)
        .text(`Generated on ${formatDate(new Date())}`, 0, pageHeight - 62, { align: "center" });

    doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#D4DCE8")
        .text("Confidential - Official Use Only", 0, pageHeight - 44, { align: "center" });

    doc.fillColor(COLORS.text);
};

const drawIndexPage = (doc, layout, groupedPlayers, categoryStartPages) => {
    drawTopBand(doc, layout, "Contents", "Category Index & Quick Access");

    const boxY = PAGE.contentStartY + 6;
    const boxHeight = 360;
    doc
        .rect(layout.left, boxY, layout.width, boxHeight)
        .lineWidth(1)
        .strokeColor(COLORS.tableGrid)
        .fillAndStroke(COLORS.white, COLORS.tableGrid);

    doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.text).text("Tournament Sections", layout.left + 16, boxY + 16);

    const entries = ["A", "B", "C"].map((category) => {
        const list = groupedPlayers[category] || [];
        return {
            category,
            name: CATEGORY_META[category].title,
            subtitle: CATEGORY_META[category].subtitle,
            count: list.length,
            page: categoryStartPages[category] || "-",
        };
    });

    let y = boxY + 56;
    entries.forEach((entry, idx) => {
        const rowY = y + idx * 88;
        doc
            .roundedRect(layout.left + 16, rowY, layout.width - 32, 72, 8)
            .lineWidth(1)
            .strokeColor(COLORS.tableGrid)
            .fillAndStroke("#F9FAFB", COLORS.tableGrid);

        const badgeColor = CATEGORY_META[entry.category].color;
        doc
            .roundedRect(layout.left + 30, rowY + 17, 32, 32, 6)
            .fill(badgeColor);

        doc
            .font("Helvetica-Bold")
            .fontSize(14)
            .fillColor(COLORS.white)
            .text(entry.category, layout.left + 30, rowY + 25, {
                width: 32,
                align: "center",
            });

        doc
            .font("Helvetica-Bold")
            .fontSize(12)
            .fillColor(COLORS.text)
            .text(entry.name, layout.left + 78, rowY + 18);

        doc
            .font("Helvetica")
            .fontSize(10)
            .fillColor(COLORS.muted)
            .text(`${entry.subtitle}  •  ${entry.count} players`, layout.left + 78, rowY + 39);

        doc
            .font("Helvetica-Bold")
            .fontSize(11)
            .fillColor(COLORS.text)
            .text(`Page ${entry.page}`, layout.left + 16, rowY + 27, {
                width: layout.width - 56,
                align: "right",
            });
    });

    doc.fillColor(COLORS.text);
};

const drawCategorySectionHeader = (doc, layout, category, y, isContinued = false) => {
    const meta = CATEGORY_META[category];

    doc.rect(layout.left, y, layout.width, PAGE.sectionHeaderHeight).fill(meta.color);

    const continuation = isContinued ? " (Continued)" : "";
    doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor(COLORS.white)
        .text(`${meta.title}${continuation}`, layout.left + 12, y + 9);

    doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#E9F0FA")
        .text(meta.subtitle, layout.left + 170, y + 10);

    doc.fillColor(COLORS.text);
};

const drawTableHeader = (doc, layout, y) => {
    doc.rect(layout.left, y, layout.width, PAGE.tableHeaderHeight).fill(COLORS.tableHeader);

    doc
        .rect(layout.left, y, layout.width, PAGE.tableHeaderHeight)
        .lineWidth(0.8)
        .strokeColor(COLORS.tableGrid)
        .stroke();

    for (let i = 1; i < layout.columns.length; i += 1) {
        const x = layout.columns[i].x;
        doc
            .moveTo(x, y)
            .lineTo(x, y + PAGE.tableHeaderHeight)
            .lineWidth(0.6)
            .strokeColor(COLORS.tableGrid)
            .stroke();
    }

    doc
        .moveTo(layout.right, y)
        .lineTo(layout.right, y + PAGE.tableHeaderHeight)
        .lineWidth(0.6)
        .strokeColor(COLORS.tableGrid)
        .stroke();

    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(COLORS.text);
    layout.columns.forEach((col) => {
        doc.text(col.label, col.x + 6, y + 9, {
            width: col.width - 12,
            align: col.align,
            lineBreak: false,
        });
    });

    doc.fillColor(COLORS.text);
};

const drawCellText = (doc, text, col, y, align) => {
    doc.text(text, col.x + 6, y + 23, {
        width: col.width - 12,
        align,
        lineBreak: false,
        ellipsis: true,
    });
};

const drawImageCell = (doc, col, y, imageUrl) => {
    const imagePath = getLocalImagePath(imageUrl);
    const boxX = col.x + 8;
    const boxY = y + 7;
    const boxW = col.width - 16;
    const boxH = PAGE.rowHeight - 14;

    doc
        .rect(boxX, boxY, boxW, boxH)
        .lineWidth(0.6)
        .strokeColor(COLORS.tableGrid)
        .stroke();

    if (!imagePath) {
        doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted).text("No image", boxX, boxY + 20, {
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
        doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted).text("Invalid", boxX, boxY + 20, {
            width: boxW,
            align: "center",
            lineBreak: false,
        });
        doc.fillColor(COLORS.text);
    }
};

const drawRow = (doc, layout, y, serialNumber, player, rowIndex) => {
    const rowBg = rowIndex % 2 === 0 ? COLORS.white : COLORS.rowAlt;

    doc.rect(layout.left, y, layout.width, PAGE.rowHeight).fill(rowBg);

    doc
        .rect(layout.left, y, layout.width, PAGE.rowHeight)
        .lineWidth(0.6)
        .strokeColor(COLORS.tableGrid)
        .stroke();

    for (let i = 1; i < layout.columns.length; i += 1) {
        const x = layout.columns[i].x;
        doc
            .moveTo(x, y)
            .lineTo(x, y + PAGE.rowHeight)
            .lineWidth(0.5)
            .strokeColor(COLORS.tableGrid)
            .stroke();
    }

    doc
        .moveTo(layout.right, y)
        .lineTo(layout.right, y + PAGE.rowHeight)
        .lineWidth(0.5)
        .strokeColor(COLORS.tableGrid)
        .stroke();

    const byKey = Object.fromEntries(layout.columns.map((col) => [col.key, col]));

    doc.font("Helvetica").fontSize(9.3).fillColor(COLORS.text);
    drawCellText(doc, String(serialNumber), byKey.serial, y, "center");
    drawCellText(doc, player.name || "-", byKey.name, y, "left");
    drawCellText(doc, player.phoneNumber || "-", byKey.mobile, y, "center");
    drawCellText(doc, String(player.age ?? "-"), byKey.age, y, "center");
    drawCellText(doc, player.jerseySize || "-", byKey.size, y, "center");
    drawCellText(doc, player.playerType || "-", byKey.role, y, "left");
    drawCellText(doc, player.category || "-", byKey.category, y, "center");
    drawImageCell(doc, byKey.image, y, player.imageUrl);
};

const drawPageFooters = (doc, layout, totalPages) => {
    for (let i = 0; i < totalPages; i += 1) {
        doc.switchToPage(i);

        const y = doc.page.height - PAGE.marginBottom - 10;
        doc
            .moveTo(layout.left, y - 7)
            .lineTo(layout.right, y - 7)
            .lineWidth(0.8)
            .strokeColor(COLORS.tableGrid)
            .stroke();

        doc
            .font("Helvetica")
            .fontSize(8)
            .fillColor(COLORS.muted)
            .text("JPL Official Document", layout.left, y, {
                width: layout.width,
                align: "left",
            })
            .text(`Page ${i + 1} of ${totalPages}`, layout.left, y, {
                width: layout.width,
                align: "right",
            });
    }

    doc.fillColor(COLORS.text);
};

const buildPremiumPdf = async () => {
    await connectDB();

    const players = await Player.find({})
        .sort({ category: 1, name: 1 })
        .lean();

    if (!players.length) {
        throw new Error("No players found in database.");
    }

    const groupedPlayers = {
        A: players.filter((p) => p.category === "A"),
        B: players.filter((p) => p.category === "B"),
        C: players.filter((p) => p.category === "C"),
    };

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margins: {
            top: PAGE.marginTop,
            bottom: PAGE.marginBottom,
            left: PAGE.marginLeft,
            right: PAGE.marginRight,
        },
        bufferPages: true,
    });

    const stream = fs.createWriteStream(OUTPUT_FILE);
    doc.pipe(stream);

    const layout = getColumnLayout(doc.page.margins.left);
    const state = { currentPage: 1 };

    const addPage = () => {
        doc.addPage();
        state.currentPage += 1;
    };

    drawCoverPage(doc, layout, players.length);

    addPage();
    const indexPage = state.currentPage;

    const categoryStartPages = {};
    let globalSerial = 1;

    ["A", "B", "C"].forEach((category) => {
        const categoryPlayers = groupedPlayers[category] || [];
        if (!categoryPlayers.length) return;

        addPage();
        categoryStartPages[category] = state.currentPage;

        let isContinued = false;
        drawTopBand(
            doc,
            layout,
            "JPL Tournament Player Roster",
            `${CATEGORY_META[category].title} - ${CATEGORY_META[category].subtitle}`,
        );

        let y = PAGE.contentStartY;
        drawCategorySectionHeader(doc, layout, category, y, isContinued);
        y += PAGE.sectionHeaderHeight;
        drawTableHeader(doc, layout, y);
        y += PAGE.tableHeaderHeight;

        for (let i = 0; i < categoryPlayers.length; i += 1) {
            const bottomLimit =
                doc.page.height - doc.page.margins.bottom - PAGE.footerReserve;

            if (y + PAGE.rowHeight > bottomLimit) {
                addPage();
                isContinued = true;
                drawTopBand(
                    doc,
                    layout,
                    "JPL Tournament Player Roster",
                    `${CATEGORY_META[category].title} - ${CATEGORY_META[category].subtitle}`,
                );

                y = PAGE.contentStartY;
                drawCategorySectionHeader(doc, layout, category, y, isContinued);
                y += PAGE.sectionHeaderHeight;
                drawTableHeader(doc, layout, y);
                y += PAGE.tableHeaderHeight;
            }

            drawRow(doc, layout, y, globalSerial, categoryPlayers[i], i);
            y += PAGE.rowHeight;
            globalSerial += 1;
        }
    });

    doc.switchToPage(indexPage - 1);
    drawIndexPage(doc, layout, groupedPlayers, categoryStartPages);

    const range = doc.bufferedPageRange();
    drawPageFooters(doc, layout, range.count);

    doc.end();

    await new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
    });

    console.log(`Premium PDF generated: ${OUTPUT_FILE}`);
};

buildPremiumPdf()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Failed to generate premium player PDF:", error.message);
        process.exit(1);
    });
