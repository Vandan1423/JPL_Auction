// Default franchises created by "Create Teams" in the admin panel and by `npm run seed`.
// Logos are optional: set `logo` to an image path under /public to show one.
const DEFAULT_TEAMS = [
	{ teamName: 'Mahaveer Indians', teamNumber: 1, color: '#EF4444' },
	{ teamName: 'Mahaveer Kings', teamNumber: 2, color: '#3B82F6' },
	{ teamName: 'Mahaveer Giants', teamNumber: 3, color: '#10B981' },
	{ teamName: 'Mahaveer Champions', teamNumber: 4, color: '#F59E0B' },
	{ teamName: 'Mahaveer Royals', teamNumber: 5, color: '#8B5CF6' },
	{ teamName: 'Mahaveer Capitals', teamNumber: 6, color: '#EC4899' },
	{ teamName: 'Mahaveer Titans', teamNumber: 7, color: '#14B8A6' },
	{ teamName: 'Mahaveer Challengers', teamNumber: 8, color: '#F97316' },
].map((team) => ({ captain: '', logo: '', ...team }));

export default DEFAULT_TEAMS;
