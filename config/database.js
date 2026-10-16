import mongoose from 'mongoose';

const connectDB = async () => {
	// Read at call time: ES module imports run before dotenv.config() in app.js
	const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/jpl-auction';

	try {
		await mongoose.connect(uri);
		console.log('MongoDB connected');
	} catch (err) {
		console.error('MongoDB connection error:', err);
		process.exit(1);
	}
};

export default connectDB;
