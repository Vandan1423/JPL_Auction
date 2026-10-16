import Player from '../models/Player.js';
import Team from '../models/Team.js';
import AuctionState from '../models/AuctionState.js';

export const showLogin = (req, res) => {
  const error = req.session.error;
  delete req.session.error;
  res.render('admin/login', { error });
};

export const handleLogin = (req, res) => {
  const { password } = req.body;
  const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();

  if (adminPassword && password && password.trim() === adminPassword) {
    req.session.isAdmin = true;
    req.session.adminName = 'Admin';
    return res.redirect('/admin/dashboard');
  }
  
  req.session.error = 'Invalid password';
  res.redirect('/admin/login');
};

export const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/admin/login');
  });
};

export const showDashboard = async (req, res) => {
  try {
    // Count players by status
    const totalPlayers = await Player.countDocuments();
    const soldPlayers = await Player.countDocuments({ status: 'sold' });
    const unsoldPlayers = await Player.countDocuments({ status: 'unsold' });
    const withdrawnPlayers = await Player.countDocuments({ status: 'withdrawn' });

    // Get all teams
    const teams = await Team.find().sort('teamNumber');

    // Get auction state
    const auctionState = await AuctionState.findOne();

    // Calculate total auction value
    const soldPlayersData = await Player.find({ status: 'sold' });
    const totalAuctionValue = soldPlayersData.reduce((sum, player) => sum + (player.soldPrice || 0), 0);

    // Get recent sales (last 10 sold players)
    const recentSoldPlayers = await Player.find({ status: 'sold' })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('soldTo');

    const recentSales = recentSoldPlayers.map(player => ({
      playerName: player.name,
      category: player.category,
      teamName: player.soldTo?.teamName || 'Unknown',
      price: player.soldPrice,
      time: player.createdAt,
    }));

    // Players per category
    const categoryA = await Player.countDocuments({ category: 'A' });
    const categoryB = await Player.countDocuments({ category: 'B' });
    const categoryC = await Player.countDocuments({ category: 'C' });

    // Average sold price
    const avgSoldPrice = soldPlayers > 0 
      ? Math.round(totalAuctionValue / soldPlayers) 
      : 0;

    // Highest sold player
    const highestSoldPlayer = await Player.findOne({ status: 'sold' })
      .sort({ soldPrice: -1 })
      .limit(1);

    // Team with most spending
    const teamWithMostSpending = teams.reduce((max, team) => {
      const spent = team.initialPurse - team.remainingPurse;
      const maxSpent = max.initialPurse - max.remainingPurse;
      return spent > maxSpent ? team : max;
    }, teams[0] || { initialPurse: 1000000, remainingPurse: 1000000 });

    res.render('admin/dashboard', {
      totalPlayers,
      soldPlayers,
      unsoldPlayers,
      withdrawnPlayers,
      teams,
      auctionState,
      totalAuctionValue,
      recentSales,
      categoryA,
      categoryB,
      categoryC,
      avgSoldPrice,
      highestSoldPlayer,
      teamWithMostSpending,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Error loading dashboard');
  }
};

export default {
  showLogin,
  handleLogin,
  logout,
  showDashboard,
};
