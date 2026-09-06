const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// LOGGING HELPER
// ============================================================
const LOG = {
    info: (msg, data = null) => {
        console.log(`[INFO] ${new Date().toISOString()} - ${msg}`);
        if (data) console.log('  📦 Data:', JSON.stringify(data, null, 2));
    },
    error: (msg, error = null) => {
        console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`);
        if (error) {
            console.error('  ❌ Error:', error.message || error);
            if (error.stack) console.error('  📚 Stack:', error.stack);
        }
    },
    success: (msg, data = null) => {
        console.log(`[SUCCESS] ${new Date().toISOString()} - ${msg}`);
        if (data) console.log('  ✅ Data:', JSON.stringify(data, null, 2));
    },
    request: (req) => {
        console.log(`[REQUEST] ${new Date().toISOString()} - ${req.method} ${req.url}`);
        if (req.body && Object.keys(req.body).length > 0) {
            console.log('  📨 Body:', JSON.stringify(req.body, null, 2));
        }
        if (req.params && Object.keys(req.params).length > 0) {
            console.log('  📌 Params:', JSON.stringify(req.params, null, 2));
        }
        if (req.query && Object.keys(req.query).length > 0) {
            console.log('  🔍 Query:', JSON.stringify(req.query, null, 2));
        }
    }
};

// ============================================================
// SUPABASE CONNECTION
// ============================================================
LOG.info('Connecting to Supabase...');
LOG.info('SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ Set' : '❌ MISSING');
LOG.info('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ MISSING');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);
LOG.success('Supabase client created');

// ============================================================
// MIDDLEWARE
// ============================================================
LOG.info('Configuring middleware...');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
LOG.success('Session middleware configured');

// ============================================================
// REQUEST LOGGING MIDDLEWARE
// ============================================================
app.use((req, res, next) => {
    LOG.request(req);
    next();
});

// ============================================================
// VIEW ENGINE
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
LOG.success('View engine configured');

// ============================================================
// HELPER FUNCTIONS
// ============================================================

async function getUserByEmail(email) {
    LOG.info(`Getting user by email: ${email}`);
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error && error.code !== 'PGRST116') {
            LOG.error('Supabase error:', error);
            return null;
        }

        if (data) {
            LOG.success(`User found: ${email}`);
            return data;
        } else {
            LOG.info(`User not found: ${email}`);
            return null;
        }
    } catch (error) {
        LOG.error('getUserByEmail error:', error);
        return null;
    }
}

async function updateUser(email, updates) {
    LOG.info(`Updating user: ${email}`, updates);
    try {
        const { data, error } = await supabase
            .from('users')
            .update(updates)
            .eq('email', email)
            .select()
            .single();

        if (error) {
            LOG.error('Update error:', error);
            return null;
        }

        LOG.success(`User updated: ${email}`);
        return data;
    } catch (error) {
        LOG.error('updateUser error:', error);
        return null;
    }
}

// ============================================================
// AUTHENTICATION ROUTES
// ============================================================

// ===== CHECK SESSION =====
app.get('/api/session', (req, res) => {
    LOG.info('Session check');
    if (req.session.user) {
        LOG.success('User logged in:', req.session.user);
        res.json({ loggedIn: true, email: req.session.user.email });
    } else {
        LOG.info('No active session');
        res.json({ loggedIn: false });
    }
});

// ===== REGISTER =====
app.post('/api/register', async (req, res) => {
    LOG.info('=== REGISTER REQUEST STARTED ===');
    LOG.request(req);

    try {
        const { email, password } = req.body;
        LOG.info('Email:', email);
        LOG.info('Password length:', password ? password.length : 0);

        if (!email) {
            LOG.error('Email is missing');
            return res.status(400).json({ error: 'Email is required' });
        }

        if (!password) {
            LOG.error('Password is missing');
            return res.status(400).json({ error: 'Password is required' });
        }

        if (password.length < 6) {
            LOG.error('Password too short:', password.length);
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        LOG.info('Checking if user exists...');
        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            LOG.error('User already exists:', email);
            return res.status(400).json({ error: 'Email already registered' });
        }

        LOG.info('Hashing password...');
        const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
        LOG.info('Password hashed successfully');

        LOG.info('Creating user in Supabase...');
        const result = await supabase.from('users').insert({
            email: email,
            password: hashedPassword,
            verified: false,
            free_credits: {
                add_wall: 3,
                add_concrete: 3,
                add_plaster: 3,
                add_painting: 3,
                add_tiling: 3
            },
            paid_credits: {
                add_wall: 0,
                add_concrete: 0,
                add_plaster: 0,
                add_painting: 0,
                add_tiling: 0
            },
            wallet_balance: 0,
            total_free_used: 0,
            total_spent: 0
        });

        if (result.error) {
            LOG.error('Supabase insert error:', result.error);
            return res.status(500).json({ error: 'Database error: ' + result.error.message });
        }

        LOG.success('User created in Supabase:', email);

        req.session.user = { email };
        LOG.success('Session set for user:', email);

        LOG.success('=== REGISTER COMPLETED SUCCESSFULLY ===');
        res.json({ success: true });

    } catch (error) {
        LOG.error('=== REGISTER FAILED ===');
        LOG.error('Error:', error);
        res.status(500).json({ error: 'Registration failed: ' + error.message });
    }
});

// ===== LOGIN =====
app.post('/api/login', async (req, res) => {
    LOG.info('=== LOGIN REQUEST STARTED ===');
    LOG.request(req);

    try {
        const { email, password } = req.body;
        LOG.info('Email:', email);

        if (!email || !password) {
            LOG.error('Email or password missing');
            return res.status(400).json({ error: 'Email and password required' });
        }

        LOG.info('Looking up user...');
        const user = await getUserByEmail(email);
        if (!user) {
            LOG.error('User not found:', email);
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        LOG.info('User found, verifying password...');
        const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
        LOG.info('Hashed password:', hashedPassword);
        LOG.info('Stored password:', user.password);

        if (user.password !== hashedPassword) {
            LOG.error('Password mismatch for:', email);
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        LOG.success('Password verified for:', email);

        req.session.user = { email };
        LOG.success('Session set for:', email);

        LOG.success('=== LOGIN COMPLETED SUCCESSFULLY ===');
        res.json({ success: true });

    } catch (error) {
        LOG.error('=== LOGIN FAILED ===');
        LOG.error('Error:', error);
        res.status(500).json({ error: 'Login failed: ' + error.message });
    }
});

// ===== LOGOUT =====
app.post('/api/logout', (req, res) => {
    LOG.info('=== LOGOUT REQUEST ===');
    req.session.destroy();
    LOG.success('Session destroyed');
    res.json({ success: true });
});

// ============================================================
// APP ROUTES
// ============================================================

// ===== ROOT =====
app.get('/', (req, res) => {
    LOG.info('Serving index page');
    res.render('index', { user: req.session.user || null });
});

// ===== TEST =====
app.get('/api/test', (req, res) => {
    LOG.info('Test endpoint called');
    res.json({
        status: 'ok',
        message: 'API is working!',
        timestamp: new Date().toISOString(),
        env: {
            supabase_url: process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing',
            paystack_key: process.env.PAYSTACK_SECRET_KEY ? '✅ Set' : '❌ Missing',
            session_secret: process.env.SESSION_SECRET ? '✅ Set' : '❌ Missing'
        }
    });
});

// ===== CHECK CREDITS =====
app.get('/api/check-credits/:email/:action', async (req, res) => {
    LOG.info('=== CHECK CREDITS ===');
    LOG.request(req);

    try {
        const { email, action } = req.params;
        const user = await getUserByEmail(email);

        if (!user) {
            LOG.info('User not found, returning default');
            return res.json({
                credits: 0,
                hasCredit: false,
                verified: false,
                exists: false,
                freeCredits: 0,
                paidCredits: 0,
                walletBalance: 0
            });
        }

        const freeCredits = user.free_credits?.[action] || 0;
        const paidCredits = user.paid_credits?.[action] || 0;
        const walletBalance = user.wallet_balance || 0;

        LOG.success('Credit check complete', { freeCredits, paidCredits, walletBalance });

        res.json({
            credits: freeCredits + paidCredits,
            freeCredits,
            paidCredits,
            walletBalance,
            hasCredit: (freeCredits + paidCredits) > 0 || walletBalance >= 5,
            verified: user.verified || false,
            exists: true
        });
    } catch (error) {
        LOG.error('Error checking credits:', error);
        res.status(500).json({ error: 'Failed to check credits' });
    }
});

// ===== BOQ ROUTE =====
app.get('/boq', (req, res) => {
    LOG.info('=== BOQ PAGE REQUEST ===');
    // Check if user is logged in
    if (!req.session.user) {
        LOG.info('User not logged in, redirecting to home');
        return res.redirect('/');
    }
    LOG.success('User logged in, serving BOQ page');
    res.render('boq', { user: req.session.user || null });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log(`🚀 Mjengo Pro server running on http://localhost:${PORT}`);
    console.log('='.repeat(60));
    console.log('📝 Test the API:');
    console.log(`   http://localhost:${PORT}/api/test`);
    console.log(`   http://localhost:${PORT}/api/session`);
    console.log('='.repeat(60));
    console.log('📋 Environment Check:');
    console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅' : '❌'}`);
    console.log(`   PAYSTACK_SECRET_KEY: ${process.env.PAYSTACK_SECRET_KEY ? '✅' : '❌'}`);
    console.log(`   SESSION_SECRET: ${process.env.SESSION_SECRET ? '✅' : '❌'}`);
    console.log(`   EMAIL_USER: ${process.env.EMAIL_USER ? '✅' : '❌'}`);
    console.log('='.repeat(60));
    console.log('📋 BOQ Route:');
    console.log(`   http://localhost:${PORT}/boq`);
    console.log('='.repeat(60));
});

module.exports = app;
