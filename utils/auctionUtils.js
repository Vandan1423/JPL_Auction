import Player from '../models/Player.js';
import Team from '../models/Team.js';
import AuctionState from '../models/AuctionState.js';

// Reset auction keeping players and teams (recommended for re-auction)
async function resetAuctionKeepPlayersTeams() {
    try {
        // Reset all players - keep player data but reset auction status
        // We need to do this individually to properly reset currentPrice to basePrice
        const players = await Player.find();
        for (const player of players) {
            player.status = 'unsold';
            player.soldTo = null;
            player.soldPrice = 0;
            player.currentPrice = player.basePrice;
            await player.save();
        }
        
        // Reset teams - keep team data but reset auction-related fields
        await Team.updateMany(
            {},
            {
                $set: {
                    remainingPurse: 1000000,
                    playersCount: 0,
                    players: []
                }
            }
        );
        
        // Reset auction state
        await AuctionState.deleteMany({});
        
        return { 
            success: true, 
            message: 'Auction reset successfully. Players and teams preserved, all auction data cleared.' 
        };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Reset entire auction (emergency use - deletes everything)
async function resetEntireAuction() {
    try {
        // Reset all players
        await Player.updateMany(
            { status: 'sold' },
            {
                $set: {
                    status: 'unsold',
                    soldTo: null,
                    soldPrice: 0
                }
            }
        );
        
        // Reset all teams
        await Team.updateMany(
            {},
            {
                $set: {
                    remainingPurse: 1000000,
                    playersCount: 0,
                    players: []
                }
            }
        );
        
        // Reset auction state
        await AuctionState.deleteMany({});
        
        return { success: true, message: 'Auction reset successfully' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Get auction progress
async function getAuctionProgress() {
    const total = await Player.countDocuments();
    const sold = await Player.countDocuments({ status: 'sold' });
    const unsold = await Player.countDocuments({ status: 'unsold' });
    const withdrawn = await Player.countDocuments({ status: 'withdrawn' });
    
    return {
        total,
        sold,
        unsold,
        withdrawn,
        progress: ((sold / total) * 100).toFixed(2)
    };
}

// Validate auction integrity
async function validateAuctionIntegrity() {
    const issues = [];
    
    // Check if any team has more than 9 purchased players
    const teams = await Team.find();
    teams.forEach(team => {
        if (team.playersCount > 9) {
            issues.push(`${team.teamName} has more than 9 purchased players`);
        }
    });
    
    // Check if any player is sold but not in any team
    const soldPlayers = await Player.find({ status: 'sold' });
    for (const player of soldPlayers) {
        if (!player.soldTo) {
            issues.push(`Player ${player.name} is marked sold but has no team`);
        }
    }
    
    // Check purse calculations
    for (const team of teams) {
        const totalSpent = team.players.reduce((sum, p) => sum + p.pricePaid, 0);
        const expectedRemaining = 1000000 - totalSpent;
        if (Math.abs(team.remainingPurse - expectedRemaining) > 1) {
            issues.push(`${team.teamName} purse mismatch. Expected: ${expectedRemaining}, Got: ${team.remainingPurse}`);
        }
    }
    
    return {
        isValid: issues.length === 0,
        issues
    };
}

// Recalculate team statistics (fix any discrepancies)
async function recalculateTeamStats(teamId = null) {
    try {
        const query = teamId ? { _id: teamId } : {};
        const teams = await Team.find(query).populate('players.playerId');
        
        for (const team of teams) {
            const totalSpent = team.players.reduce((sum, p) => sum + p.pricePaid, 0);
            team.remainingPurse = 1000000 - totalSpent;
            team.playersCount = team.players.length;
            await team.save();
        }
        
        return { success: true, message: 'Team stats recalculated' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

export {
    resetAuctionKeepPlayersTeams,
    resetEntireAuction,
    getAuctionProgress,
    validateAuctionIntegrity,
    recalculateTeamStats
};
