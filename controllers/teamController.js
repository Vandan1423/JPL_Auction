import Team from '../models/Team.js';
import Player from '../models/Player.js';
import { calculateMaxBid, calculateMaxBidDirect } from '../utils/helpers.js';
import DEFAULT_TEAMS from '../config/defaultTeams.js';

// Show teams setup page
export const showTeamsSetup = async (req, res) => {
  try {
    const teamCount = await Team.countDocuments();
    
    if (teamCount > 0) {
      // Teams already exist, get all teams
      const teams = await Team.find()
        .sort('teamNumber')
        .populate('players.playerId');
      
      return res.render('admin/teams', { teams });
    } else {
      // No teams, render setup form
      return res.render('admin/teams', { teams: [] });
    }
  } catch (error) {
    console.error('Error in showTeamsSetup:', error);
    req.session.error = 'Error loading teams setup';
    res.redirect('/admin/dashboard');
  }
};

// Create initial 8 teams
export const createInitialTeams = async (req, res) => {
  try {
    // Check if teams already created
    const teamCount = await Team.countDocuments();
    
    if (teamCount > 0) {
      req.session.error = 'Teams already created';
      return res.redirect('/admin/teams');
    }
    
    await Team.insertMany(DEFAULT_TEAMS);
    
    req.session.success = '8 teams created successfully!';
    res.redirect('/admin/teams');
  } catch (error) {
    console.error('Error creating teams:', error);
    req.session.error = 'Error creating teams';
    res.redirect('/admin/teams');
  }
};

// Get all teams with statistics
export const getAllTeams = async (req, res) => {
  try {
    const teams = await Team.find()
      .sort('teamNumber')
      .populate('players.playerId');
    
    // Calculate statistics for each team
    const teamsWithStats = teams.map(team => {
      const totalSpent = team.initialPurse - team.remainingPurse;
      const budgetUtilization = (totalSpent / team.initialPurse) * 100;
      
      // Calculate category breakdown
      const categoryBreakdown = { A: 0, B: 0, C: 0 };
      team.players.forEach(p => {
        if (categoryBreakdown[p.category] !== undefined) {
          categoryBreakdown[p.category]++;
        }
      });
      
      const averagePlayerPrice = team.playersCount > 0 
        ? totalSpent / team.playersCount 
        : 0;
      
      return {
        ...team.toObject(),
        totalSpent,
        budgetUtilization,
        categoryBreakdown,
        averagePlayerPrice
      };
    });
    
    // Calculate auction statistics
    const totalPlayersSold = teamsWithStats.reduce((sum, team) => sum + team.playersCount, 0);
    const totalMoneySpent = teamsWithStats.reduce((sum, team) => sum + team.totalSpent, 0);
    const totalPlayers = await Player.countDocuments();
    const remainingPlayers = totalPlayers - totalPlayersSold;
    const totalBudget = teamsWithStats.reduce((sum, team) => sum + team.initialPurse, 0);
    
    res.render('admin/teams', {
      teams: teamsWithStats,
      totalPlayersSold,
      totalMoneySpent,
      remainingPlayers,
      totalPlayers,
      totalBudget
    });
  } catch (error) {
    console.error('Error in getAllTeams:', error);
    req.session.error = 'Error loading teams';
    res.redirect('/admin/dashboard');
  }
};

// Get detailed team information
export const getTeamDetails = async (req, res) => {
  try {
    const teamId = req.params.id;
    
    const team = await Team.findById(teamId).populate({
      path: 'players.playerId',
      select: 'name category basePrice'
    });
    
    if (!team) {
      req.session.error = 'Team not found';
      return res.redirect('/admin/teams');
    }
    
    // Calculate detailed statistics
    const totalSpent = team.initialPurse - team.remainingPurse;
    
    // Category breakdown
    const categoryBreakdown = { A: 0, B: 0, C: 0 };
    const categorySpending = { A: 0, B: 0, C: 0 };
    
    team.players.forEach(p => {
      if (categoryBreakdown[p.category] !== undefined) {
        categoryBreakdown[p.category]++;
        categorySpending[p.category] += p.pricePaid;
      }
    });
    
    // Most expensive player
    let mostExpensivePlayer = null;
    if (team.players.length > 0) {
      const maxPlayer = team.players.reduce((max, p) => 
        p.pricePaid > max.pricePaid ? p : max
      );
      mostExpensivePlayer = {
        name: maxPlayer.playerName,
        price: maxPlayer.pricePaid
      };
    }
    
    // Best value player (lowest paid vs base price ratio)
    let bestValuePlayer = null;
    if (team.players.length > 0) {
      const valuePlayer = team.players.reduce((best, p) => {
        const currentRatio = p.pricePaid / p.playerId.basePrice;
        const bestRatio = best ? (best.pricePaid / best.playerId.basePrice) : Infinity;
        return currentRatio < bestRatio ? p : best;
      }, null);
      
      if (valuePlayer) {
        bestValuePlayer = {
          name: valuePlayer.playerName,
          valuePercent: ((valuePlayer.pricePaid / valuePlayer.playerId.basePrice) * 100).toFixed(0)
        };
      }
    }
    
    // Recommended budget per remaining player
    const remainingSlots = 9 - team.playersCount;
    const recommendedBudget = remainingSlots > 0 
      ? Math.floor(team.remainingPurse / remainingSlots)
      : 0;
    
    // Calculate max bid allowed
    const maxBidAllowed = calculateMaxBidDirect(team.remainingPurse, team.playersCount);
    
    res.render('admin/team-details', {
      team,
      totalSpent,
      categoryBreakdown,
      categorySpending,
      mostExpensivePlayer,
      bestValuePlayer,
      recommendedBudget,
      maxBidAllowed
    });
  } catch (error) {
    console.error('Error in getTeamDetails:', error);
    req.session.error = 'Error loading team details';
    res.redirect('/admin/teams');
  }
};

// Update team information (AJAX)
export const updateTeamInfo = async (req, res) => {
  try {
    const teamId = req.params.id;
    const { teamName, captain } = req.body;
    
    const updateFields = {};
    if (teamName) updateFields.teamName = teamName;
    if (captain !== undefined) updateFields.captain = captain;
    
    const team = await Team.findByIdAndUpdate(
      teamId,
      updateFields,
      { new: true }
    );
    
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }
    
    res.json({ success: true, team });
  } catch (error) {
    console.error('Error updating team:', error);
    res.status(500).json({ success: false, message: 'Error updating team' });
  }
};

// Get teams summary for AJAX
export const getTeamsSummary = async (req, res) => {
  try {
    const teams = await Team.find()
      .select('teamName teamNumber color remainingPurse playersCount')
      .sort('teamNumber');
    
    res.json(teams);
  } catch (error) {
    console.error('Error getting teams summary:', error);
    res.status(500).json({ error: 'Error fetching teams' });
  }
};

// Reset team (emergency function)
export const resetTeam = async (req, res) => {
  try {
    const teamId = req.params.id;
    
    const team = await Team.findById(teamId);
    if (!team) {
      req.session.error = 'Team not found';
      return res.redirect('/admin/teams');
    }
    
    // Get all players bought by this team
    const playerIds = team.players.map(p => p.playerId);
    
    // Reset all players to unsold
    await Player.updateMany(
      { _id: { $in: playerIds } },
      { 
        status: 'unsold',
        soldTo: null,
        soldPrice: null
      }
    );
    
    // Reset team
    team.remainingPurse = team.initialPurse;
    team.playersCount = 0;
    team.players = [];
    await team.save();
    
    req.session.success = `${team.teamName} has been reset successfully`;
    res.redirect('/admin/teams');
  } catch (error) {
    console.error('Error resetting team:', error);
    req.session.error = 'Error resetting team';
    res.redirect('/admin/teams');
  }
};

// Calculate max bid for team (AJAX)
export const calculateMaxBidForTeam = async (req, res) => {
  try {
    const teamId = req.params.id;
    
    const team = await Team.findById(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    const maxBid = calculateMaxBidDirect(team.remainingPurse, team.playersCount);
    const playersNeeded = 9 - team.playersCount;
    
    res.json({ 
      maxBid, 
      playersNeeded,
      remainingPurse: team.remainingPurse 
    });
  } catch (error) {
    console.error('Error calculating max bid:', error);
    res.status(500).json({ error: 'Error calculating max bid' });
  }
};
