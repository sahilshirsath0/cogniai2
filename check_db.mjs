import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';

dotenv.config();

async function checkDatabase() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected!');

        const count = await User.countDocuments();
        console.log(`Total users in database: ${count}`);

        const users = await User.find({}, { password: 0 }); // Fetch all users but hide passwords
        console.log('--- Registered Users ---');
        console.table(users.map(u => ({
            name: u.name,
            email: u.email,
            role: u.role,
            dept: u.dept || 'N/A'
        })));

        await mongoose.disconnect();
        console.log('Disconnected.');
    } catch (error) {
        console.error('Error checking database:', error);
    }
}

checkDatabase();
