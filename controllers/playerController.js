import Player from '../models/Player.js';
import { validatePlayerData, getCategoryConfig } from '../utils/helpers.js';

// 1. Get all players with filtering and grouping
export const getAllPlayers = async (req, res) => {
	try {
		// Get filters from query params
		const category = req.query.category;
		const status = req.query.status;
		const search = req.query.search;

		// Build MongoDB query object
		const query = {};

		if (category && category !== 'all') {
			query.category = category;
		}

		if (status && status !== 'all') {
			query.status = status;
		}

		if (search) {
			query.name = { $regex: search, $options: 'i' };
		}

		// Execute query
		const players = await Player.find(query)
			.populate('soldTo', 'teamName')
			.sort({ playerNumber: 1 });

		// Count players by status for filter display
		const statusCounts = {
			total: await Player.countDocuments(),
			unsold: await Player.countDocuments({ status: 'unsold' }),
			sold: await Player.countDocuments({ status: 'sold' }),
			withdrawn: await Player.countDocuments({ status: 'withdrawn' }),
		};

		// Store applied filters for UI
		const appliedFilters = {
			category: category || 'all',
			status: status || 'all',
			search: search || '',
		};

		res.render('admin/players', {
			players,
			appliedFilters,
			statusCounts,
			title: 'Players Management',
		});
	} catch (error) {
		console.error('Error fetching players:', error);
		res.status(500).send('Error loading players');
	}
};

// 2. Show add player form
export const showAddPlayerForm = (req, res) => {
	const success = req.session.success;
	const error = req.session.error;

	// Clear messages from session
	delete req.session.success;
	delete req.session.error;

	res.render('admin/add-player', {
		success,
		error,
		title: 'Add Player',
	});
};

// 3. Add new player
export const addPlayer = async (req, res) => {
	try {
		const { name, phoneNumber, jerseySize, age, category, playerType } = req.body;

		// Validate player data
		const validation = validatePlayerData({ name, phoneNumber, category, playerType, jerseySize });

		if (!validation.isValid) {
			req.session.error = validation.errors.join(', ');
			return res.redirect('/admin/players/add');
		}

		// Check for duplicate phone number
		const existingPlayer = await Player.findOne({ phoneNumber });

		if (existingPlayer) {
			req.session.error = `Phone number ${phoneNumber} is already registered for player: ${existingPlayer.name}`;
			return res.redirect('/admin/players/add');
		}

		// Create new player
		const player = new Player({
			name: name.trim(),
			phoneNumber: phoneNumber.trim(),
			jerseySize,
			...(age ? { age: Number(age) } : {}),
			category,
			playerType,
			// basePrice will be auto-set by pre-save hook
			// playerNumber will be auto-generated
		});

		await player.save();

		req.session.success = `Player "${name}" added successfully with number #${player.playerNumber}`;
		return res.redirect('/admin/players/add');
	} catch (error) {
		console.error('Error adding player:', error);
		req.session.error = 'Failed to add player. Please try again.';
		return res.redirect('/admin/players/add');
	}
};

// 4. Show bulk add form
export const showBulkAddForm = (req, res) => {
	const success = req.session.success;
	const error = req.session.error;

	delete req.session.success;
	delete req.session.error;

	res.render('admin/bulk-add', {
		success,
		error,
		title: 'Bulk Add Players',
	});
};

// 5. Bulk add players
export const bulkAddPlayers = async (req, res) => {
	try {
		const { players } = req.body;

		if (!players || !Array.isArray(players) || players.length === 0) {
			return res.json({
				success: false,
				message: 'No player data provided',
			});
		}

		const validPlayers = [];
		const failedPlayers = [];
		const phoneNumbers = new Set();

		// Validate each player
		for (let i = 0; i < players.length; i++) {
			const playerData = players[i];
			const rowNum = i + 1;

			// Validate data
			const validation = validatePlayerData(playerData);

			if (!validation.isValid) {
				failedPlayers.push({
					row: rowNum,
					name: playerData.name || 'N/A',
					reason: validation.errors.join(', '),
				});
				continue;
			}

			// Check for duplicate phone in batch
			if (phoneNumbers.has(playerData.phoneNumber)) {
				failedPlayers.push({
					row: rowNum,
					name: playerData.name,
					reason: 'Duplicate phone number in batch',
				});
				continue;
			}

			// Check for duplicate phone in database
			const existing = await Player.findOne({
				phoneNumber: playerData.phoneNumber,
			});

			if (existing) {
				failedPlayers.push({
					row: rowNum,
					name: playerData.name,
					reason: `Phone number already exists for ${existing.name}`,
				});
				continue;
			}

			phoneNumbers.add(playerData.phoneNumber);
			validPlayers.push({
				name: playerData.name.trim(),
				phoneNumber: playerData.phoneNumber.trim(),
				jerseySize: playerData.jerseySize,
				playerType: playerData.playerType,
				category: playerData.category,
			});
		}

		// Bulk insert valid players
		let addedCount = 0;
		if (validPlayers.length > 0) {
			const result = await Player.insertMany(validPlayers, { ordered: false });
			addedCount = result.length;
		}

		return res.json({
			success: true,
			added: addedCount,
			failed: failedPlayers,
			message:
				failedPlayers.length > 0
					? `Added ${addedCount} players. ${failedPlayers.length} failed.`
					: `Successfully added ${addedCount} players!`,
		});
	} catch (error) {
		console.error('Error in bulk add:', error);
		return res.json({
			success: false,
			message: 'Server error during bulk add: ' + error.message,
		});
	}
};

// 6. Show edit player form
export const showEditPlayerForm = async (req, res) => {
	try {
		const playerId = req.params.id;
		const player = await Player.findById(playerId);

		if (!player) {
			req.session.error = 'Player not found';
			return res.redirect('/admin/players');
		}

		const success = req.session.success;
		const error = req.session.error;

		delete req.session.success;
		delete req.session.error;

		res.render('admin/edit-player', {
			player,
			success,
			error,
			title: 'Edit Player',
		});
	} catch (error) {
		console.error('Error loading edit form:', error);
		req.session.error = 'Failed to load player details';
		res.redirect('/admin/players');
	}
};

// 7. Edit player
export const editPlayer = async (req, res) => {
	try {
		const playerId = req.params.id;
		const { name, phoneNumber, jerseySize, category, playerType } = req.body;

		// Find player
		const player = await Player.findById(playerId);

		if (!player) {
			req.session.error = 'Player not found';
			return res.redirect('/admin/players');
		}

		// Validate data
		const validation = validatePlayerData({ name, phoneNumber, category, playerType, jerseySize });

		if (!validation.isValid) {
			req.session.error = validation.errors.join(', ');
			return res.redirect(`/admin/players/edit/${playerId}`);
		}

		// Check if player is sold and category is being changed
		if (player.status === 'sold' && player.category !== category) {
			req.session.error =
				'Cannot change category of a sold player. Please withdraw the player first.';
			return res.redirect(`/admin/players/edit/${playerId}`);
		}

		// Check for duplicate phone number (excluding current player)
		if (phoneNumber !== player.phoneNumber) {
			const existingPlayer = await Player.findOne({
				phoneNumber,
				_id: { $ne: playerId },
			});

			if (existingPlayer) {
				req.session.error = `Phone number ${phoneNumber} is already registered for player: ${existingPlayer.name}`;
				return res.redirect(`/admin/players/edit/${playerId}`);
			}
		}

		// Update player fields
		player.name = name.trim();
		player.phoneNumber = phoneNumber.trim();
		player.jerseySize = jerseySize;
		player.playerType = playerType;

		// Update category and recalculate base price if changed
		if (player.category !== category) {
			player.category = category;
			const categoryConfig = getCategoryConfig(category);
			if (categoryConfig) {
				player.basePrice = categoryConfig.basePrice;
			}
		}

		await player.save();

		req.session.success = `Player "${name}" updated successfully`;
		return res.redirect('/admin/players');
	} catch (error) {
		console.error('Error updating player:', error);
		req.session.error = 'Failed to update player';
		return res.redirect(`/admin/players/edit/${req.params.id}`);
	}
};

// 8. Delete player
export const deletePlayer = async (req, res) => {
	try {
		const playerId = req.params.id;
		const player = await Player.findById(playerId);

		if (!player) {
			req.session.error = 'Player not found';
			return res.redirect('/admin/players');
		}

		// Check if player can be deleted
		if (player.status === 'sold') {
			req.session.error = `Cannot delete sold player "${player.name}". Player is owned by a team.`;
			return res.redirect('/admin/players');
		}

		// Delete player if status is unsold or withdrawn
		await Player.findByIdAndDelete(playerId);

		req.session.success = `Player "${player.name}" deleted successfully`;
		return res.redirect('/admin/players');
	} catch (error) {
		console.error('Error deleting player:', error);
		req.session.error = 'Failed to delete player';
		return res.redirect('/admin/players');
	}
};

// 9. Search players (AJAX endpoint)
export const searchPlayers = async (req, res) => {
	try {
		const term = req.query.term || '';

		const players = await Player.find({
			name: { $regex: term, $options: 'i' },
			status: 'unsold',
		})
			.limit(20)
			.select('_id name playerNumber category basePrice');

		res.json(players);
	} catch (error) {
		console.error('Error searching players:', error);
		res.status(500).json({ error: 'Search failed' });
	}
};

// 10. Get players by category (AJAX endpoint)
export const getPlayersByCategory = async (req, res) => {
	try {
		const category = req.params.category;

		const players = await Player.find({
			category,
			status: 'unsold',
		})
			.sort({ playerNumber: 1 })
			.select('_id name playerNumber category basePrice');

		res.json(players);
	} catch (error) {
		console.error('Error fetching players by category:', error);
		res.status(500).json({ error: 'Failed to fetch players' });
	}
};

// 11. Show player reorder page
export const showReorderPage = async (req, res) => {
	try {
		const players = await Player.find({ status: 'unsold' })
			.sort({ auctionOrder: 1, playerNumber: 1 })
			.select('_id name playerNumber category playerType auctionOrder basePrice')
			.lean();

		res.render('admin/reorder-players', {
			players,
			title: 'Reorder Players',
		});
	} catch (error) {
		console.error('Error loading reorder page:', error);
		res.status(500).send('Error loading reorder page');
	}
};

// 12. Save player auction order (AJAX)
export const savePlayerOrder = async (req, res) => {
	try {
		const { playerIds } = req.body;

		if (!Array.isArray(playerIds) || playerIds.length === 0) {
			return res.status(400).json({ success: false, message: 'No player IDs provided' });
		}

		const bulkOps = playerIds.map((id, index) => ({
			updateOne: {
				filter: { _id: id },
				update: { $set: { auctionOrder: index + 1 } },
			},
		}));

		await Player.bulkWrite(bulkOps);

		return res.json({ success: true, message: 'Order saved successfully' });
	} catch (error) {
		console.error('Error saving player order:', error);
		return res.status(500).json({ success: false, message: 'Failed to save order' });
	}
};

export default {
	getAllPlayers,
	showAddPlayerForm,
	addPlayer,
	showBulkAddForm,
	bulkAddPlayers,
	showEditPlayerForm,
	editPlayer,
	deletePlayer,
	searchPlayers,
	getPlayersByCategory,
	showReorderPage,
	savePlayerOrder,
};
