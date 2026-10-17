// Demo tournament for screenshots and local testing. Every person here is
// fictional: names are invented, photos are randomuser.me stock portraits
// (made for mock data) and no phone numbers are stored.

const BAT = 'Batsman';
const BOWL = 'Bowler';
const BAT_AR = 'Batting All-Rounder';
const BOWL_AR = 'Bowling All-Rounder';
const WK = 'Wicket-Keeper Batsman';

export const DEMO_SLUG = 'skyline-premier-league-2026';

export const tournament = {
	name: 'Skyline Premier League',
	shortName: 'SPL',
	season: '2026',
	slug: DEMO_SLUG,
	venue: 'Riverside Cricket Ground, Pune',
	auctionDate: new Date('2026-11-08T17:00:00+05:30'),
	currency: 'INR',
	status: 'active',
	setupStep: 6,
	teamCount: 8,
	squad: { min: 11, max: 14 },
	purse: 1000000,
	maxBidPerPlayer: null,
	categories: [
		{ name: 'Platinum', basePrice: 50000, color: '#F59E0B', maxPerTeam: 3, increments: [] },
		{ name: 'Gold', basePrice: 20000, color: '#6366F1', maxPerTeam: null, increments: [] },
		{ name: 'Silver', basePrice: 10000, color: '#10B981', maxPerTeam: null, increments: [] },
	],
	bidIncrements: [
		{ from: 0, step: 2000 },
		{ from: 50000, step: 5000 },
		{ from: 100000, step: 10000 },
	],
	roles: [BAT, BOWL, BAT_AR, BOWL_AR, WK],
	roleRequirements: [{ role: WK, min: 1 }],
	playerFields: { phone: 'hidden', jerseySize: 'optional', jerseyNumber: 'optional', age: 'optional' },
	unsoldPolicy: 'move_down',
};

// owner.gender picks the portrait set; `plays` makes the owner a squad member.
export const teams = [
	{ name: 'Thunder Strikers', shortName: 'TS', color: '#EF4444', owner: { name: 'Rajesh Khurana', gender: 'men' } },
	{ name: 'Royal Falcons', shortName: 'RF', color: '#3B82F6', owner: { name: 'Priya Venkatesh', gender: 'women' } },
	{ name: 'Coastal Titans', shortName: 'CT', color: '#14B8A6', owner: { name: 'Sanjay Bhatnagar', gender: 'men', plays: true, role: BAT } },
	{ name: 'Desert Hawks', shortName: 'DH', color: '#F97316', owner: { name: 'Meera Rathod', gender: 'women' } },
	{ name: 'Northern Knights', shortName: 'NK', color: '#8B5CF6', owner: { name: 'Vikas Grover', gender: 'men', plays: true, role: BAT_AR } },
	{ name: 'Golden Panthers', shortName: 'GP', color: '#EAB308', owner: { name: 'Anjali Shekhar', gender: 'women' } },
	{ name: 'Metro Warriors', shortName: 'MW', color: '#EC4899', owner: { name: 'Kavya Raman', gender: 'women' } },
	{ name: 'Storm Chasers', shortName: 'SC', color: '#0EA5E9', owner: { name: 'Nitesh Bhalla', gender: 'men', plays: true, role: BOWL } },
];

// [name, role] per category, in registration order.
export const players = {
	Platinum: [
		['Arjun Mehta', BAT], ['Karthik Iyer', WK], ['Vikram Rathore', BOWL], ['Rohan Deshmukh', BAT_AR],
		['Siddharth Nair', BOWL], ['Aditya Kulkarni', BAT], ['Pranav Reddy', BOWL_AR], ['Nikhil Chauhan', BAT],
		['Harshvardhan Joshi', BOWL], ['Aman Sandhu', BAT_AR], ['Yash Malhotra', BOWL], ['Ishaan Kapoor', WK],
		['Dhruv Bhatt', BOWL_AR], ['Kunal Saxena', BAT], ['Varun Pillai', BOWL], ['Abhinav Rao', BAT_AR],
	],
	Gold: [
		['Manish Agarwal', BAT], ['Tushar Patil', BOWL], ['Gaurav Bansal', BAT], ['Sameer Qureshi', BOWL],
		['Ankit Verma', BOWL_AR], ['Rahul Menon', WK], ['Saurabh Dubey', BAT], ['Mohit Sinha', BOWL],
		['Kartik Bhandari', BAT_AR], ['Deepak Choudhary', BOWL], ['Akash Jain', BAT], ['Vivek Rawat', BOWL_AR],
		['Pratik Shetty', WK], ['Rajat Mishra', BAT], ['Sahil Bhatia', BOWL], ['Tarun Goyal', BAT_AR],
		['Omkar Jadhav', BOWL], ['Ritesh Tiwari', BAT], ['Arnav Sethi', BOWL_AR], ['Chetan Rajput', BOWL],
		['Mayank Bhardwaj', BAT], ['Neeraj Kumar', BOWL], ['Parth Desai', WK], ['Ayush Tripathi', BAT_AR],
		['Shivam Ghosh', BOWL], ['Lakshay Arora', BAT], ['Devansh Mathur', BOWL_AR], ['Rishabh Ahuja', BAT],
		['Nitin Hegde', BOWL], ['Kabir Bose', BAT], ['Uday Shekhawat', BOWL], ['Jatin Khanna', BAT_AR],
	],
	Silver: [
		['Aarav Sharma', BAT], ['Vihaan Gupta', BOWL], ['Krish Malik', BAT], ['Reyansh Bajaj', BOWL_AR],
		['Atharv Gokhale', WK], ['Shaurya Rana', BOWL], ['Advait Pawar', BAT], ['Ayaan Siddiqui', BOWL],
		['Rudra Chaturvedi', BAT_AR], ['Kian Fernandes', BAT], ['Ritvik Shukla', BOWL], ['Dev Prajapati', BOWL_AR],
		['Arush Kamat', WK], ['Moksh Thapar', BAT], ['Viraj Sawant', BOWL], ['Aniket Bhosale', BAT],
		['Hrithik Negi', BOWL_AR], ['Sarthak Puri', BOWL], ['Tanmay Kelkar', BAT], ['Rishi Upadhyay', BOWL],
		['Siddhant Dhillon', BAT_AR], ['Manav Oberoi', WK], ['Ved Chopra', BOWL], ['Nakul Bhargava', BAT],
		['Abhay Solanki', BOWL_AR], ['Jay Mistry', BOWL], ['Kunal Gaikwad', BAT], ['Pranay Lal', BOWL],
		['Om Hiremath', BAT_AR], ['Rahil Ansari', BAT], ['Samarth Naik', WK], ['Tejas Kamble', BOWL],
		['Ujjwal Srivastava', BAT], ['Yuvan Krishnan', BOWL_AR], ['Zaid Shaikh', BOWL], ['Darsh Vyas', BAT],
		['Eshan Mukherjee', BOWL], ['Farhan Mirza', BAT_AR], ['Gautam Bhat', BAT], ['Himanshu Yadav', BOWL],
		['Indrajit Sen', WK], ['Jayesh Parmar', BOWL], ['Keshav Rastogi', BAT], ['Lokesh Dutta', BOWL_AR],
		['Mihir Kaushik', BOWL], ['Naman Tandon', BAT], ['Parag Dixit', BOWL_AR], ['Ronak Vohra', WK],
	],
};

// How hard teams chase each category: final price = base × a factor in [min, max].
// `unsold` is the chance nobody bids the first time a player comes up.
export const demand = {
	Platinum: { min: 1.2, max: 4.4, unsold: 0.04 },
	Gold: { min: 1, max: 4, unsold: 0.1 },
	Silver: { min: 1, max: 3.2, unsold: 0.16 },
};

export const JERSEY_SIZES = ['S', 'M', 'M', 'L', 'L', 'L', 'XL', 'XL', 'XXL'];

/** randomuser.me portrait (0–99 per gender). */
export const portraitUrl = (gender, index) => `https://randomuser.me/api/portraits/${gender}/${index}.jpg`;
