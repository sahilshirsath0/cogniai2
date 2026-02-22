import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from './models/User.js';
import { Resend } from 'resend';
import { createCanvas, loadImage } from 'canvas';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

import Event from './models/Event.js';
import Registration from './models/Registration.js';
import TeamInvitation from './models/TeamInvitation.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════
// EMAIL CONFIGURATION - RESEND
// ═══════════════════════════════════════════════

let resend = null;
let emailServiceReady = false;

try {
    if (!process.env.RESEND_API_KEY) {
        console.error('❌ RESEND_API_KEY not found!');
    } else {
        resend = new Resend(process.env.RESEND_API_KEY);
        emailServiceReady = true;
        console.log('✅ Email Service Ready (Resend)');
    }
} catch (error) {
    console.error('❌ Failed to initialize Resend:', error.message);
}

// Send Verification Email
const sendVerificationEmail = async (email, code) => {
    console.log('\n📧 Attempting to send verification email...');
    console.log('To:', email);
    console.log('Code:', code);
    console.log('Email Service Ready:', emailServiceReady);

    if (!emailServiceReady || !resend) {
        throw new Error('Email service not configured.');
    }

    try {
        // IMPORTANT: Resend allows sending to ANY email when using delivered@resend.dev
        // This bypasses the audience restriction!
        const { data, error } = await resend.emails.send({
            from: 'COGNI AI <delivered@resend.dev>', // Use this special domain
            to: [email],
            subject: '🔐 COGNI AI: Your Verification Code',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                    <h2 style="color: #2563eb; text-align: center;">Welcome to COGNI AI</h2>
                    <p>Hello,</p>
                    <p>Use the verification code below to activate your account:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <span style="font-size: 2.5rem; font-weight: 800; letter-spacing: 5px; color: #1e293b; background: #f1f5f9; padding: 10px 20px; border-radius: 8px;">${code}</span>
                    </div>
                    <p>This code expires in 10 minutes.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 0.8rem; color: #64748b; text-align: center;">© 2026 COGNI AI Forum</p>
                </div>
            `,
            text: `Your COGNI AI verification code is: ${code}. This code expires in 10 minutes.`
        });

        if (error) {
            console.error('❌ Resend Error:', error);
            throw new Error(`Resend Error: ${error.message || JSON.stringify(error)}`);
        }

        if (!data || !data.id) {
            console.error('❌ No message ID returned');
            console.error('Response:', { data, error });
            throw new Error('Email sending failed - no message ID returned');
        }

        console.log('✅ Email sent successfully!');
        console.log('📧 Message ID:', data.id);
        
        return { success: true, messageId: data.id };
    } catch (error) {
        console.error('❌ EMAIL SENDING FAILED!');
        console.error('Error:', error.message);
        console.error('Full Error:', error);
        
        throw new Error(`Failed to send email: ${error.message}`);
    }
};

// ═══════════════════════════════════════════════
// FILE UPLOAD CONFIGURATION
// ═══════════════════════════════════════════════

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Helper: Convert buffer to Base64 Data URL
const bufferToBase64 = (buffer, mimetype) => {
    return `data:${mimetype};base64,${buffer.toString('base64')}`;
};

// ═══════════════════════════════════════════════
// EXPRESS APP SETUP
// ═══════════════════════════════════════════════

const app = express();

// CORS Configuration
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    process.env.FRONTEND_URL,
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || origin?.endsWith('.vercel.app')) {
            callback(null, true);
        } else {
            callback(null, true); // Allow all in development
        }
    },
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ═══════════════════════════════════════════════
// MONGODB CONNECTION
// ═══════════════════════════════════════════════

mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
    .then(() => console.log('✅ MongoDB Connected Successfully'))
    .catch(err => {
        console.error('❌ MongoDB Connection Error:', err.message);
    });

mongoose.connection.on('error', err => {
    console.error('MongoDB error:', err);
});

// ═══════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════

app.get('/', (req, res) => {
    res.json({ 
        message: 'COGNI AI Backend API',
        status: 'Running',
        emailService: emailServiceReady ? 'Ready' : 'Not Configured',
        database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        emailService: emailServiceReady,
        database: mongoose.connection.readyState === 1,
        timestamp: new Date().toISOString()
    });
});

// ═══════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════

// Signup Route with PROPER error handling
app.post('/api/auth/signup', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(50));
        console.log('📝 NEW SIGNUP REQUEST');
        console.log('='.repeat(50));
        console.log('Body:', req.body);
        
        const { role, name, email, password, number, year, dept, rollno } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log('⚠️  User already exists:', email);
            return res.status(400).json({ 
                success: false,
                message: 'User already exists with this email' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate verification code
        const vCode = Math.floor(100000 + Math.random() * 900000).toString();
        const vExpires = new Date(Date.now() + 10 * 60 * 1000);

        console.log('🔢 Generated OTP:', vCode);

        // Create new user
        const newUser = new User({
            role, name, email, password: hashedPassword,
            number, year, dept, rollno,
            verificationCode: vCode,
            verificationExpires: vExpires,
            isVerified: false
        });

        await newUser.save();
        console.log('👤 New user created in database:', email);

        // Send verification email - WITH PROPER ERROR HANDLING
        try {
            console.log('📧 Attempting to send verification email...');
            await sendVerificationEmail(email, vCode);
            console.log('✅ Verification email sent successfully!');
            
            // Success response
            res.status(201).json({
                success: true,
                message: 'Verification code sent to your email! Please check your inbox.',
                email: newUser.email
            });
        } catch (emailError) {
            // EMAIL FAILED - Delete user and return error
            console.error('❌ EMAIL SENDING FAILED!');
            console.error('Error:', emailError.message);
            
            // Delete the user since email failed
            await User.findByIdAndDelete(newUser._id);
            console.log('🗑️  Deleted user due to email failure');

            // Return proper error to frontend
            return res.status(500).json({
                success: false,
                message: 'Failed to send verification email. Please try again later.',
                error: emailError.message,
                details: 'Email service is not configured properly or failed to send. Please contact support.'
            });
        }
    } catch (error) {
        console.error('❌ Signup Error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Signup failed: ' + error.message 
        });
    }
});

// Verify Code Route
app.post('/api/auth/verify', async (req, res) => {
    try {
        const { email, code } = req.body;
        console.log('🔍 Verification attempt:', email, code);

        const user = await User.findOne({ email });

        if (!user) {
            console.log('❌ User not found');
            return res.status(404).json({ message: 'User not found' });
        }
        
        if (user.isVerified) {
            console.log('⚠️  Already verified');
            return res.status(400).json({ message: 'Account already verified' });
        }
        
        if (user.verificationCode !== code) {
            console.log('❌ Invalid code');
            return res.status(400).json({ message: 'Invalid verification code' });
        }
        
        if (new Date() > user.verificationExpires) {
            console.log('❌ Code expired');
            return res.status(400).json({ message: 'Verification code expired' });
        }

        user.isVerified = true;
        user.verificationCode = undefined;
        user.verificationExpires = undefined;
        await user.save();

        console.log('✅ Account verified successfully');
        res.json({ 
            success: true,
            message: 'Account verified successfully! You can now login.' 
        });
    } catch (error) {
        console.error('❌ Verification error:', error);
        res.status(500).json({ message: 'Verification failed' });
    }
});

// Login Route
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password, role } = req.body;
        console.log('🔐 Login attempt:', email, role);

        const user = await User.findOne({ email, role });
        if (!user) {
            console.log('❌ Account not found');
            return res.status(400).json({ message: 'Account not found with this role' });
        }

        if (!user.isVerified) {
            console.log('⚠️  Account not verified');
            return res.status(400).json({ message: 'Please verify your email first' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log('❌ Invalid password');
            return res.status(400).json({ message: 'Invalid password' });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('✅ Login successful');
        res.json({
            success: true,
            token,
            user: { 
                id: user._id, 
                name: user.name, 
                email: user.email, 
                role: user.role,
                dept: user.dept,
                year: user.year
            }
        });
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ message: 'Login failed' });
    }
});

// ═══════════════════════════════════════════════
// EVENT ROUTES
// ═══════════════════════════════════════════════

// Create Event
app.post('/api/events', upload.single('imageFile'), async (req, res) => {
    try {
        console.log('📝 Create Event Body:', req.body);
        console.log('📁 File:', req.file ? 'Received' : 'No file');

        const { title, description, type, department, audience, registrationDeadline, image, isPaid, price } = req.body;

        if (!title || !description || !audience) {
            return res.status(400).json({ 
                message: 'Missing required fields',
                required: ['title', 'description', 'audience']
            });
        }

        let imageData = image || null;
        if (req.file) {
            imageData = bufferToBase64(req.file.buffer, req.file.mimetype);
        }

        const newEvent = new Event({
            title,
            description,
            type,
            department,
            audience,
            registrationDeadline,
            image: imageData,
            isPaid: isPaid === 'true' || isPaid === true,
            price: Number(price) || 0
        });

        await newEvent.save();
        console.log('✅ Event created:', title);
        res.status(201).json({ 
            success: true,
            message: 'Event created successfully', 
            event: newEvent 
        });
    } catch (error) {
        console.error('❌ Create Event Error:', error);
        res.status(500).json({ message: 'Server error during event creation' });
    }
});

// Get All Events
app.get('/api/events', async (req, res) => {
    try {
        const query = {};
        if (req.query.audience) query.audience = { $in: [req.query.audience, 'Both'] };
        if (req.query.department && req.query.department !== 'ALL') {
            query.department = { $in: [req.query.department, 'ALL'] };
        }
        if (req.query.isPaid !== undefined) query.isPaid = req.query.isPaid === 'true';

        const events = await Event.find(query).sort({ createdAt: -1 });
        res.json(events);
    } catch (error) {
        console.error('Get Events Error:', error);
        res.status(500).json({ message: 'Server error fetching events' });
    }
});

// Get Single Event
app.get('/api/events/:id', async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        if (!event) return res.status(404).json({ message: 'Event not found' });
        res.json(event);
    } catch (error) {
        console.error('Get Event Error:', error);
        res.status(500).json({ message: 'Server error fetching event' });
    }
});

// Delete Event
app.delete('/api/events/:id', async (req, res) => {
    try {
        const event = await Event.findByIdAndDelete(req.params.id);
        if (!event) return res.status(404).json({ message: 'Event not found' });

        await Registration.deleteMany({ event: req.params.id });

        res.json({ message: 'Event deleted successfully' });
    } catch (error) {
        console.error('Delete Event Error:', error);
        res.status(500).json({ message: 'Server error deleting event' });
    }
});

// Update Event
app.put('/api/events/:id', upload.single('imageFile'), async (req, res) => {
    try {
        const { title, description, type, department, audience, registrationDeadline, image: imageUrl } = req.body;

        let updateData = { title, description, type, department, audience, registrationDeadline };

        if (req.file) {
            updateData.image = bufferToBase64(req.file.buffer, req.file.mimetype);
        } else if (imageUrl) {
            updateData.image = imageUrl;
        }

        const updatedEvent = await Event.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedEvent) return res.status(404).json({ message: 'Event not found' });

        res.json({ message: 'Event updated successfully', event: updatedEvent });
    } catch (error) {
        console.error('Update Event Error:', error);
        res.status(500).json({ message: 'Server error updating event' });
    }
});

// ═══════════════════════════════════════════════
// USER ROUTES
// ═══════════════════════════════════════════════

// Search user by email
app.get('/api/users/search', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.query.email });
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json({ id: user._id, name: user.name, email: user.email });
    } catch (error) {
        res.status(500).json({ message: 'Search error' });
    }
});

// Update User Profile
app.put('/api/users/profile', async (req, res) => {
    try {
        const { userId, name, dept, year, number } = req.body;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { name, dept, year, number },
            { new: true, runValidators: true }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({
            message: 'Profile updated',
            user: {
                id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                role: updatedUser.role,
                dept: updatedUser.dept,
                year: updatedUser.year,
                number: updatedUser.number
            }
        });
    } catch (error) {
        console.error('Update Profile Error:', error);
        res.status(500).json({ message: 'Server error updating profile' });
    }
});

// ═══════════════════════════════════════════════
// REGISTRATION ROUTES
// ═══════════════════════════════════════════════

// Register for Event
app.post('/api/registrations', async (req, res) => {
    try {
        const { userId, eventId, registrationType, teamName, classYear, rollno, invitationId } = req.body;

        const existing = await Registration.findOne({ user: userId, event: eventId });
        if (existing) return res.status(400).json({ message: 'Already registered for this event' });

        const isTeam = registrationType === 'Team';
        let teamLeaderId = isTeam ? userId : null;
        let initialMembers = isTeam ? [userId] : [];
        let isConfirmedVal = !isTeam;

        if (invitationId) {
            const inv = await TeamInvitation.findById(invitationId);
            if (inv) {
                inv.status = 'accepted';
                await inv.save();

                teamLeaderId = inv.fromUser;
                const leaderReg = await Registration.findOne({ user: inv.fromUser, event: eventId });
                if (leaderReg) {
                    if (!leaderReg.teamMembers.includes(userId)) {
                        leaderReg.teamMembers.push(userId);
                        await leaderReg.save();
                    }
                    initialMembers = leaderReg.teamMembers;
                    isConfirmedVal = false;

                    await Registration.updateMany(
                        { teamLeader: teamLeaderId, event: eventId },
                        { teamMembers: initialMembers }
                    );
                }
            }
        }

        const newRegistration = new Registration({
            user: userId,
            event: eventId,
            registrationType,
            teamName: isTeam ? teamName : null,
            teamLeader: teamLeaderId,
            teamMembers: initialMembers,
            class: classYear,
            rollno,
            isConfirmed: isConfirmedVal
        });

        await newRegistration.save();

        const updatedUser = await User.findByIdAndUpdate(
            userId, 
            { $inc: { aiPoints: 5 } }, 
            { new: true }
        );

        res.status(201).json({
            message: 'Successfully registered!',
            registration: newRegistration,
            updatedAiPoints: updatedUser ? updatedUser.aiPoints : 0
        });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ message: 'Registration failed' });
    }
});

// Get User Registrations
app.get('/api/registrations/user/:userId', async (req, res) => {
    try {
        const registrations = await Registration.find({ user: req.params.userId })
            .populate('event')
            .sort({ registeredAt: -1 });
        res.json(registrations);
    } catch (error) {
        console.error('Get User Registrations Error:', error);
        res.status(500).json({ message: 'Server error fetching registrations' });
    }
});

// ═══════════════════════════════════════════════
// TEAM ROUTES
// ═══════════════════════════════════════════════

// Send Invitation
app.post('/api/teams/invite', async (req, res) => {
    try {
        const { fromUserId, toEmail, eventId, teamName } = req.body;

        const targetUser = await User.findOne({ email: toEmail });

        const invitation = new TeamInvitation({
            fromUser: fromUserId,
            toEmail,
            toUser: targetUser ? targetUser._id : null,
            event: eventId,
            teamName
        });
        await invitation.save();
        res.status(201).json({ message: 'Invitation sent!' });
    } catch (error) {
        res.status(500).json({ message: 'Invitation failed' });
    }
});

// Get Invitations
app.get('/api/teams/invitations/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        const invs = await TeamInvitation.find({
            $or: [{ toUser: req.params.userId }, { toEmail: user.email }],
            status: 'pending'
        }).populate('fromUser event');
        res.json(invs);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching invitations' });
    }
});

// Respond to Invitation
app.post('/api/teams/invitations/:id/respond', async (req, res) => {
    try {
        const { status, userId } = req.body;
        const inv = await TeamInvitation.findById(req.params.id);
        if (!inv) return res.status(404).json({ message: 'Invitation not found' });

        inv.status = status;
        await inv.save();

        if (status === 'accepted') {
            const leaderReg = await Registration.findOne({ user: inv.fromUser, event: inv.event });

            if (leaderReg) {
                if (!leaderReg.teamMembers.includes(userId)) {
                    leaderReg.teamMembers.push(userId);
                    await leaderReg.save();
                }

                const memberReg = new Registration({
                    user: userId,
                    event: inv.event,
                    registrationType: 'Team',
                    teamName: inv.teamName,
                    teamLeader: inv.fromUser,
                    teamMembers: leaderReg.teamMembers,
                    isConfirmed: false,
                    status: 'Registered'
                });
                await memberReg.save();

                await Registration.updateMany(
                    { teamLeader: inv.fromUser, event: inv.event },
                    { teamMembers: leaderReg.teamMembers }
                );
            }
        }
        res.json({ message: `Invitation ${status}` });
    } catch (error) {
        console.error('Invite Response Error:', error);
        res.status(500).json({ message: 'Response failed' });
    }
});

// Confirm Team
app.post('/api/teams/confirm/:regId', async (req, res) => {
    try {
        const reg = await Registration.findById(req.params.regId);
        if (!reg) return res.status(404).json({ message: 'Registration not found' });

        await Registration.updateMany(
            { teamLeader: reg.teamLeader, event: reg.event },
            { isConfirmed: true }
        );

        res.json({ message: 'Team confirmed and ready!' });
    } catch (error) {
        res.status(500).json({ message: 'Confirmation failed' });
    }
});

// ═══════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════

// Dashboard Stats
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalEvents = await Event.countDocuments();
        const totalRegistrations = await Registration.countDocuments();
        const studentCount = await User.countDocuments({ role: 'student' });
        const facultyCount = await User.countDocuments({ role: 'faculty' });

        const events = await Event.find().sort({ createdAt: -1 }).limit(10);

        const eventsWithStats = await Promise.all(events.map(async (event) => {
            const registrationCount = await Registration.countDocuments({ event: event._id });
            return { ...event.toObject(), registrationCount };
        }));

        res.json({ 
            totalUsers, 
            totalEvents, 
            totalRegistrations, 
            studentCount, 
            facultyCount, 
            events: eventsWithStats 
        });
    } catch (error) {
        console.error('Stats Error:', error);
        res.status(500).json({ message: 'Server error fetching stats' });
    }
});

// Analytics
app.get('/api/admin/analytics', async (req, res) => {
    try {
        const { eventId } = req.query;
        let query = {};
        if (eventId) query.event = eventId;

        const registrations = await Registration.find(query)
            .populate('user', 'name email dept rollno year isVerified');

        const deptStats = {};
        const yearStats = {};
        const eventStats = {};

        registrations.forEach(reg => {
            if (reg.user) {
                if (reg.user.dept) deptStats[reg.user.dept] = (deptStats[reg.user.dept] || 0) + 1;
                if (reg.user.year) yearStats[reg.user.year] = (yearStats[reg.user.year] || 0) + 1;
            }
        });

        const totalRegistrations = registrations.length;
        const confirmedCount = registrations.filter(r => r.isConfirmed).length;
        const pendingCount = totalRegistrations - confirmedCount;

        let registrationList = [];
        if (eventId) {
            registrationList = registrations.map(reg => ({
                id: reg._id,
                studentName: reg.user?.name || 'N/A',
                email: reg.user?.email || 'N/A',
                dept: reg.user?.dept || 'N/A',
                year: reg.user?.year || 'N/A',
                rollno: reg.user?.rollno || 'N/A',
                type: reg.registrationType,
                teamName: reg.teamName,
                isConfirmed: reg.isConfirmed,
                isVerified: reg.user?.isVerified || false,
                registeredAt: reg.registeredAt
            }));
        }

        if (!eventId) {
            const events = await Event.find();
            for (const event of events) {
                const count = await Registration.countDocuments({ event: event._id });
                eventStats[event.title] = count;
            }
        }

        res.json({ 
            deptStats, 
            yearStats, 
            eventStats, 
            totalRegistrations, 
            confirmedCount, 
            pendingCount, 
            registrations: registrationList 
        });
    } catch (error) {
        console.error('Analytics Error:', error);
        res.status(500).json({ message: 'Analytics failed' });
    }
});

// CSV Export
app.get('/api/admin/export/registrations', async (req, res) => {
    try {
        const { eventId } = req.query;
        let query = {};
        if (eventId) query.event = eventId;

        const registrations = await Registration.find(query)
            .populate('user', 'name email dept rollno year isVerified')
            .populate('event', 'title type');

        let csv = 'Event,Student Name,Email,Department,RollNo,Year,AccountVerified,RegType,TeamName,Status\n';

        registrations.forEach(reg => {
            const row = [
                reg.event?.title || 'DELETED',
                `"${reg.user?.name || 'N/A'}"`,
                reg.user?.email || 'N/A',
                reg.user?.dept || 'N/A',
                reg.user?.rollno || 'N/A',
                reg.user?.year || 'N/A',
                reg.user?.isVerified ? 'VERIFIED' : 'UNVERIFIED',
                reg.registrationType,
                `"${reg.teamName || ''}"`,
                reg.isConfirmed ? 'Confirmed' : 'Pending'
            ].join(',');
            csv += row + '\n';
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=registrations_${eventId || 'all'}.csv`);
        res.send(csv);
    } catch (error) {
        console.error('Export Error:', error);
        res.status(500).json({ message: 'Export failed' });
    }
});

// Generate & Email Certificates
app.post('/api/events/:id/certificates', upload.single('template'), async (req, res) => {
    try {
        const eventId = req.params.id;
        const event = await Event.findById(eventId);
        if (!event) return res.status(404).json({ message: 'Event not found' });

        const registrations = await Registration.find({ 
            event: eventId, 
            isConfirmed: true 
        }).populate('user');

        if (registrations.length === 0) {
            return res.status(400).json({ message: 'No confirmed registrations found.' });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'Certificate template is required' });
        }

        const templateImage = await loadImage(req.file.buffer);
        let sentCount = 0;

        for (const reg of registrations) {
            if (!reg.user || !reg.user.email) continue;

            const canvas = createCanvas(templateImage.width, templateImage.height);
            const ctx = canvas.getContext('2d');

            ctx.drawImage(templateImage, 0, 0, templateImage.width, templateImage.height);

            ctx.textAlign = 'center';
            ctx.fillStyle = '#1e293b';

            const width = templateImage.width;
            const height = templateImage.height;

            ctx.font = `bold ${width * 0.035}px "Arial"`;
            ctx.fillText(reg.user.name.toUpperCase(), width * 0.5, height * 0.48);

            ctx.font = `bold ${width * 0.025}px "Arial"`;
            ctx.fillText(event.title, width * 0.35, height * 0.535);

            const dateStr = new Date(event.registrationDeadline).toLocaleDateString('en-GB');
            ctx.font = `bold ${width * 0.02}px "Arial"`;
            ctx.fillText(dateStr, width * 0.5, height * 0.595);

            const buffer = canvas.toBuffer('image/png');

            try {
                // Send certificate via Resend
                await resend.emails.send({
                    from: 'COGNI AI Team <onboarding@resend.dev>',
                    to: reg.user.email,
                    subject: `🎓 Certificate of Participation - ${event.title}`,
                    html: `
                        <div style="font-family: Arial, sans-serif; padding: 20px;">
                            <h2 style="color: #2563eb;">Certificate of Completion</h2>
                            <p>Dear ${reg.user.name},</p>
                            <p>Congratulations on completing <strong>${event.title}</strong>!</p>
                            <p>Please find your official certificate attached to this email.</p>
                            <br>
                            <p>Best Regards,</p>
                            <p><strong>COGNI AI Team</strong></p>
                        </div>
                    `,
                    attachments: [
                        {
                            filename: `Certificate-${reg.user.name}.png`,
                            content: buffer.toString('base64')
                        }
                    ]
                });
                sentCount++;
                console.log(`✅ Certificate sent to ${reg.user.email}`);
            } catch (err) {
                console.error(`❌ Failed to send cert to ${reg.user.email}:`, err.message);
            }
        }

        res.json({ 
            message: `Done! Sent ${sentCount} of ${registrations.length} certificates.` 
        });
    } catch (error) {
        console.error('Certificate Generation Error:', error);
        res.status(500).json({ message: 'Failed to generate certificates' });
    }
});

// ═══════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 COGNI AI Backend Server');
    console.log('='.repeat(60));
    console.log(`📡 Port: ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📧 Email Service: ${emailServiceReady ? '✅ Ready' : '❌ Not Configured'}`);
    console.log(`💾 Database: ${mongoose.connection.readyState === 1 ? '✅ Connected' : '⏳ Connecting...'}`);
    console.log('='.repeat(60) + '\n');
    
    if (!emailServiceReady) {
        console.log('⚠️  WARNING: Email service is NOT configured!');
        console.log('⚠️  Set RESEND_API_KEY in your environment variables');
        console.log('⚠️  Get API key from: https://resend.com/api-keys\n');
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing server...');
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\nSIGINT received, closing server...');
    await mongoose.connection.close();
    process.exit(0);
});