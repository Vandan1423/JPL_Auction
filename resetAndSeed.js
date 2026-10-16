import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import DEFAULT_TEAMS from './config/defaultTeams.js';
import Player from './models/Player.js';
import Team from './models/Team.js';

const PLAYER_TYPES = [
	'Batsman',
	'Bowler',
	'Batting All Rounder',
	'Bowling All Rounder',
	'Wicket Keeper Batsman',
];

const JERSEY_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

const CATEGORIES = ['A', 'B', 'C'];

// 100 fictional player names for demo data
const PLAYER_NAMES = [
	'Aarav Sharma', 'Vihaan Patel', 'Aditya Joshi', 'Sai Kumar', 'Arjun Reddy',
	'Reyansh Gupta', 'Ayaan Singh', 'Krishna Iyer', 'Ishaan Mehta', 'Dhruv Malhotra',
	'Kabir Verma', 'Ritvik Nair', 'Arnav Deshmukh', 'Vedant Kulkarni', 'Shaurya Jain',
	'Atharv Mishra', 'Advait Rao', 'Pranav Chauhan', 'Vivaan Saxena', 'Rohan Kapoor',
	'Anirudh Menon', 'Parth Agarwal', 'Yash Tiwari', 'Kunal Bhatt', 'Neel Pandey',
	'Harsh Sinha', 'Dev Bhatia', 'Ansh Thakur', 'Rishi Pillai', 'Kartik Deshpande',
	'Manav Tripathi', 'Rudra Hegde', 'Siddharth Choudhary', 'Lakshya Bansal', 'Mihir Khandelwal',
	'Akash Mukherjee', 'Nikhil Parmar', 'Rahul Sethi', 'Varun Bose', 'Aayush Rathore',
	'Soham Naik', 'Tejas Yadav', 'Tanmay Chatterjee', 'Gaurav Pawar', 'Karan Goyal',
	'Sahil Rawat', 'Chirag Sundaram', 'Prateek Bajaj', 'Mayank Soni', 'Abhi Dalal',
	'Nakul Dhawan', 'Anil Patil', 'Deepak Rajput', 'Sameer Kamath', 'Vikram Shekhawat',
	'Rajat Wagh', 'Tushar Chandra', 'Mohit Lal', 'Suraj Darshan', 'Jayesh Kini',
	'Hemant Gaikwad', 'Piyush Oberoi', 'Ankur Mahapatra', 'Tarun Saini', 'Aman Balaji',
	'Shivam Raina', 'Bhavesh Kothari', 'Omkar Dixit', 'Yuvraj Shetty', 'Darshan Gill',
	'Nitin Khanna', 'Ajay Ranganath', 'Vishal Ahuja', 'Saurabh Bhandari', 'Raghav Mangeshkar',
	'Prasad Gopalan', 'Dinesh Thapar', 'Arun Venkatesh', 'Ashwin Subramaniam', 'Ganesh Prabhu',
	'Madhav Rastogi', 'Vinay Chakraborty', 'Sachin Shirke', 'Naveen Kashyap', 'Ramesh Dandapani',
	'Sandeep Grover', 'Abhishek Chawla', 'Vikas Wadhwa', 'Sumit Pandit', 'Girish Unnikrishnan',
	'Surya Mittal', 'Harish Chhabra', 'Amrit Luthra', 'Farhan Baig', 'Lokesh Tandon',
	'Chandran Nambiar', 'Hitesh Solanki', 'Prashant Dutta', 'Gopal Mahajan', 'Rajesh Vyas',
];

function generatePhone(index) {
	// Obviously fake, unique 10-digit numbers: 0000000001, 0000000002, ...
	return String(index + 1).padStart(10, '0');
}

function pick(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}

function getCategory(index) {
	// First 8 players → A, next 57 → B, remaining 35 → C
	if (index < 8) return 'A';
	if (index < 65) return 'B';
	return 'C';
}

function getPlayerType(index) {
	// Distribute across types somewhat realistically
	const distribution = [
		...Array(30).fill('Batsman'),
		...Array(25).fill('Bowler'),
		...Array(18).fill('Batting All Rounder'),
		...Array(17).fill('Bowling All Rounder'),
		...Array(10).fill('Wicket Keeper Batsman'),
	];
	return distribution[index % distribution.length];
}

async function resetAndSeed() {
	try {
		await connectDB();

		// ── Drop the entire database ──
		console.log('Dropping entire database...');
		await mongoose.connection.db.dropDatabase();
		console.log('Database dropped successfully!');

		// ── Insert 100 players ──
		console.log('Inserting 100 players...');

		const CATEGORY_BASE_PRICE = { A: 75000, B: 30000, C: 10000 };

		const players = PLAYER_NAMES.map((name, i) => {
			const category = getCategory(i);
			const basePrice = CATEGORY_BASE_PRICE[category];
			return {
				name,
				phoneNumber: generatePhone(i),
				jerseySize: pick(JERSEY_SIZES),
				playerType: getPlayerType(i),
				category,
				basePrice,
				currentPrice: basePrice,
				status: 'unsold',
				playerNumber: i + 1,
			};
		});

		await Player.insertMany(players);
		console.log('100 players inserted successfully!');

		// ── Insert 8 teams ──
		console.log('Inserting 8 teams...');

		await Team.insertMany(DEFAULT_TEAMS);
		console.log('8 teams inserted successfully!');

		// Verify
		const count = await Player.countDocuments();
		const teamCount = await Team.countDocuments();
		console.log(`Verification: ${count} players in database`);
		console.log(`Verification: ${teamCount} teams in database`);

		// Show summary
		const catA = await Player.countDocuments({ category: 'A' });
		const catB = await Player.countDocuments({ category: 'B' });
		const catC = await Player.countDocuments({ category: 'C' });
		console.log(`\nCategory breakdown:`);
		console.log(`  A (₹75,000): ${catA} players`);
		console.log(`  B (₹30,000): ${catB} players`);
		console.log(`  C (₹10,000): ${catC} players`);

		const types = await Player.aggregate([
			{ $group: { _id: '$playerType', count: { $sum: 1 } } },
			{ $sort: { count: -1 } },
		]);
		console.log(`\nPlayer type breakdown:`);
		types.forEach((t) => console.log(`  ${t._id}: ${t.count}`));

	} catch (err) {
		console.error('Error:', err);
	} finally {
		await mongoose.disconnect();
		console.log('\nDone. Database reset complete.');
	}
}

resetAndSeed();
