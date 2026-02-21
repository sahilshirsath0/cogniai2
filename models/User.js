import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    role: {
        type: String,
        required: true,
        enum: ['student', 'faculty', 'admin']
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    number: {
        type: String,
        required: true
    },
    // Student specific
    year: String,
    dept: String,
    rollno: String,
    // Verification
    isVerified: {
        type: Boolean,
        default: false
    },
    verificationCode: String,
    verificationExpires: Date,
    // Gamification
    aiPoints: {
        type: Number,
        default: 0
    },
    // Timestamp
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

export default mongoose.model('User', userSchema);
