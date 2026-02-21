import mongoose from 'mongoose';

const teamInvitationSchema = new mongoose.Schema({
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toEmail: { type: String, required: true },
    toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Populated if user exists
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    teamName: { type: String, required: true },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'pending'
    },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('TeamInvitation', teamInvitationSchema);
