import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    image: { type: String }, // URL or path
    type: {
        type: String,
        required: true
    },
    department: { type: String, required: true },
    audience: {
        type: String,
        required: true,
        enum: ['Student', 'Faculty', 'Both']
    },
    registrationDeadline: { type: Date, required: true },
    isPaid: { type: Boolean, default: false },
    price: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Event', eventSchema);
