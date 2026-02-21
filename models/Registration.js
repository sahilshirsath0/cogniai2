import mongoose from 'mongoose';

const registrationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    registrationType: { type: String, enum: ['Individual', 'Team'], default: 'Individual' },
    teamName: String,
    teamLeader: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teamMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    class: String, // SE, TE, BE
    rollno: String,
    isConfirmed: { type: Boolean, default: true }, // Team remains false until leader confirms completion
    registeredAt: { type: Date, default: Date.now },
    status: { type: String, default: 'Registered' } // Registered, Attended, Cancelled
});

export default mongoose.model('Registration', registrationSchema);
