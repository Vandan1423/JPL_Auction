import Player from '../models/Player.js';
import Team from '../models/Team.js';
import AuctionState from '../models/AuctionState.js';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

// Show reports dashboard
async function showReportsDashboard(req, res) {
    try {
        const soldPlayers = await Player.find({ status: 'sold' })
            .populate('soldTo')
            .sort({ soldPrice: -1 });
        
        const unsoldPlayers = await Player.find({ status: 'unsold' })
            .sort({ category: 1, playerNumber: 1 });
        
        const teams = await Team.find()
            .populate('players.playerId')
            .sort('teamNumber');
        
        // Calculate statistics
        const stats = {
            totalPlayers: await Player.countDocuments(),
            soldCount: soldPlayers.length,
            unsoldCount: unsoldPlayers.length,
            totalValue: soldPlayers.reduce((sum, p) => sum + p.soldPrice, 0),
            avgPrice: soldPlayers.length > 0 
                ? soldPlayers.reduce((sum, p) => sum + p.soldPrice, 0) / soldPlayers.length 
                : 0,
            highestSale: soldPlayers[0] || null,
            categoryBreakdown: {}
        };
        
        // Category breakdown
        ['A', 'B', 'C', 'D'].forEach(cat => {
            const catPlayers = soldPlayers.filter(p => p.category === cat);
            stats.categoryBreakdown[cat] = {
                sold: catPlayers.length,
                total: catPlayers.reduce((sum, p) => sum + p.soldPrice, 0),
                avg: catPlayers.length > 0 
                    ? catPlayers.reduce((sum, p) => sum + p.soldPrice, 0) / catPlayers.length 
                    : 0
            };
        });
        
        res.render('admin/reports', {
            soldPlayers,
            unsoldPlayers,
            teams,
            stats
        });
        
    } catch (error) {
        console.error('Error loading reports:', error);
        res.status(500).send('Error loading reports');
    }
}

// Export sold players to Excel
async function exportSoldPlayersExcel(req, res) {
    try {
        const players = await Player.find({ status: 'sold' })
            .populate('soldTo')
            .sort({ soldPrice: -1 });
        
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sold Players');
        
        // Define columns
        worksheet.columns = [
            { header: 'Player #', key: 'playerNumber', width: 12 },
            { header: 'Name', key: 'name', width: 25 },
            { header: 'Phone', key: 'phone', width: 15 },
            { header: 'Category', key: 'category', width: 12 },
            { header: 'Base Price', key: 'basePrice', width: 15 },
            { header: 'Sold Price', key: 'soldPrice', width: 15 },
            { header: 'Team', key: 'team', width: 20 },
            { header: 'Profit %', key: 'profit', width: 12 }
        ];
        
        // Style header
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(1).font.color = { argb: 'FFFFFFFF' };
        
        // Add data
        players.forEach(player => {
            const profitPercent = ((player.soldPrice / player.basePrice) * 100).toFixed(2);
            worksheet.addRow({
                playerNumber: player.playerNumber,
                name: player.name,
                phone: player.phoneNumber,
                category: player.category,
                basePrice: player.basePrice,
                soldPrice: player.soldPrice,
                team: player.soldTo ? player.soldTo.teamName : 'N/A',
                profit: profitPercent + '%'
            });
        });
        
        // Add totals row
        const totalRow = worksheet.addRow({
            playerNumber: '',
            name: 'TOTAL',
            phone: '',
            category: '',
            basePrice: players.reduce((sum, p) => sum + p.basePrice, 0),
            soldPrice: players.reduce((sum, p) => sum + p.soldPrice, 0),
            team: '',
            profit: ''
        });
        totalRow.font = { bold: true };
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=jpl_sold_players.xlsx');
        
        // Write to response
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (error) {
        console.error('Error exporting Excel:', error);
        res.status(500).send('Error generating Excel file');
    }
}

// Export team sheets to Excel
async function exportTeamSheetsExcel(req, res) {
    try {
        const teams = await Team.find()
            .populate('players.playerId')
            .sort('teamNumber');
        
        const workbook = new ExcelJS.Workbook();
        
        // Create a sheet for each team
        for (const team of teams) {
            const worksheet = workbook.addWorksheet(team.teamName);
            
            // Team header
            worksheet.mergeCells('A1:F1');
            const headerCell = worksheet.getCell('A1');
            headerCell.value = team.teamName.toUpperCase();
            headerCell.font = { size: 16, bold: true };
            headerCell.alignment = { horizontal: 'center' };
            headerCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF' + team.color.substring(1) }
            };
            
            // Team stats
            worksheet.getCell('A3').value = 'Captain:';
            worksheet.getCell('B3').value = team.captain || 'Not Assigned';
            worksheet.getCell('A4').value = 'Players:';
            worksheet.getCell('B4').value = `${team.playersCount}/9`;
            worksheet.getCell('A5').value = 'Total Spent:';
            worksheet.getCell('B5').value = `₹${(team.initialPurse - team.remainingPurse).toLocaleString('en-IN')}`;
            worksheet.getCell('A6').value = 'Remaining:';
            worksheet.getCell('B6').value = `₹${team.remainingPurse.toLocaleString('en-IN')}`;
            
            // Players table
            worksheet.getCell('A8').value = 'S.No.';
            worksheet.getCell('B8').value = 'Player Name';
            worksheet.getCell('C8').value = 'Category';
            worksheet.getCell('D8').value = 'Base Price';
            worksheet.getCell('E8').value = 'Price Paid';
            worksheet.getCell('F8').value = 'Value';
            
            worksheet.getRow(8).font = { bold: true };
            worksheet.getRow(8).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD9D9D9' }
            };
            
            let rowNum = 9;
            team.players.forEach((p, index) => {
                const player = p.playerId;
                worksheet.getCell(`A${rowNum}`).value = index + 1;
                worksheet.getCell(`B${rowNum}`).value = player.name;
                worksheet.getCell(`C${rowNum}`).value = player.category;
                worksheet.getCell(`D${rowNum}`).value = player.basePrice;
                worksheet.getCell(`E${rowNum}`).value = p.pricePaid;
                worksheet.getCell(`F${rowNum}`).value = 
                    ((p.pricePaid / player.basePrice) * 100).toFixed(0) + '%';
                rowNum++;
            });
            
            // Set column widths
            worksheet.getColumn('A').width = 8;
            worksheet.getColumn('B').width = 25;
            worksheet.getColumn('C').width = 12;
            worksheet.getColumn('D').width = 15;
            worksheet.getColumn('E').width = 15;
            worksheet.getColumn('F').width = 10;
        }
        
        // Summary sheet
        const summarySheet = workbook.addWorksheet('Summary');
        summarySheet.columns = [
            { header: 'Team', key: 'team', width: 20 },
            { header: 'Players', key: 'players', width: 12 },
            { header: 'Spent', key: 'spent', width: 15 },
            { header: 'Remaining', key: 'remaining', width: 15 },
            { header: 'Avg Price', key: 'avg', width: 15 }
        ];
        
        summarySheet.getRow(1).font = { bold: true };
        
        teams.forEach(team => {
            const spent = team.initialPurse - team.remainingPurse;
            summarySheet.addRow({
                team: team.teamName,
                players: `${team.playersCount}/9`,
                spent: spent,
                remaining: team.remainingPurse,
                avg: team.playersCount > 0 ? Math.round(spent / team.playersCount) : 0
            });
        });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=jpl_team_sheets.xlsx');
        
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (error) {
        console.error('Error exporting team sheets:', error);
        res.status(500).send('Error generating team sheets');
    }
}

// Export unsold players to Excel
async function exportUnsoldPlayersExcel(req, res) {
    try {
        const players = await Player.find({ status: 'unsold' })
            .sort({ category: 1, playerNumber: 1 });
        
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Unsold Players');
        
        worksheet.columns = [
            { header: 'Player #', key: 'playerNumber', width: 12 },
            { header: 'Name', key: 'name', width: 25 },
            { header: 'Phone', key: 'phone', width: 15 },
            { header: 'Category', key: 'category', width: 12 },
            { header: 'Base Price', key: 'basePrice', width: 15 }
        ];
        
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE74C3C' }
        };
        worksheet.getRow(1).font.color = { argb: 'FFFFFFFF' };
        
        players.forEach(player => {
            worksheet.addRow({
                playerNumber: player.playerNumber,
                name: player.name,
                phone: player.phoneNumber,
                category: player.category,
                basePrice: player.basePrice
            });
        });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=jpl_unsold_players.xlsx');
        
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (error) {
        console.error('Error exporting unsold players:', error);
        res.status(500).send('Error generating Excel file');
    }
}

// Generate PDF report for a team
async function generateTeamPDF(req, res) {
    try {
        const teamId = req.params.teamId;
        const team = await Team.findById(teamId).populate('players.playerId');
        
        if (!team) {
            return res.status(404).send('Team not found');
        }
        
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${team.teamName.replace(/\s+/g, '_')}_squad.pdf`);
        
        doc.pipe(res);
        
        // Header
        doc.fontSize(24).font('Helvetica-Bold').text('JAIN PREMIER LEAGUE', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(20).fillColor(team.color).text(team.teamName.toUpperCase(), { align: 'center' });
        doc.moveDown(1);
        
        // Team details
        doc.fontSize(12).fillColor('black').font('Helvetica');
        doc.text(`Captain: ${team.captain || 'Not Assigned'}`);
        doc.text(`Squad Strength: ${team.playersCount}/9`);
        doc.text(`Total Spent: ₹${(team.initialPurse - team.remainingPurse).toLocaleString('en-IN')}`);
        doc.text(`Remaining Purse: ₹${team.remainingPurse.toLocaleString('en-IN')}`);
        doc.moveDown(1);
        
        // Draw line
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(1);
        
        // Squad heading
        doc.fontSize(16).font('Helvetica-Bold').text('SQUAD PLAYERS', { underline: true });
        doc.moveDown(0.5);
        
        // Table header
        doc.fontSize(10).font('Helvetica-Bold');
        const tableTop = doc.y;
        doc.text('#', 50, tableTop, { width: 30 });
        doc.text('Player Name', 90, tableTop, { width: 150 });
        doc.text('Cat', 250, tableTop, { width: 40 });
        doc.text('Base', 300, tableTop, { width: 80 });
        doc.text('Paid', 390, tableTop, { width: 80 });
        doc.text('Value', 480, tableTop, { width: 70 });
        
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.3);
        
        // Players
        doc.font('Helvetica').fontSize(10);
        team.players.forEach((p, index) => {
            const player = p.playerId;
            const yPos = doc.y;
            
            if (yPos > 700) {
                doc.addPage();
                doc.y = 50;
            }
            
            doc.text(index + 1, 50, doc.y, { width: 30 });
            doc.text(player.name, 90, doc.y, { width: 150 });
            doc.text(player.category, 250, doc.y, { width: 40 });
            doc.text(`₹${player.basePrice.toLocaleString('en-IN')}`, 300, doc.y, { width: 80 });
            doc.text(`₹${p.pricePaid.toLocaleString('en-IN')}`, 390, doc.y, { width: 80 });
            doc.text(((p.pricePaid / player.basePrice) * 100).toFixed(0) + '%', 480, doc.y, { width: 70 });
            doc.moveDown(0.8);
        });
        
        doc.end();
        
    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).send('Error generating PDF');
    }
}

export {
    showReportsDashboard,
    exportSoldPlayersExcel,
    exportTeamSheetsExcel,
    exportUnsoldPlayersExcel,
    generateTeamPDF
};
