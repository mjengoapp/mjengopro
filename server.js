require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================================
// EMAIL SETUP
// ============================================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASSWORD || 'your-app-password'
    }
});

// ============================================================
// DATA STORAGE
// ============================================================
const DATA_FILE = path.join(__dirname, 'data', 'users.json');

function initializeDataFile() {
    if (!fs.existsSync(path.join(__dirname, 'data'))) {
        fs.mkdirSync(path.join(__dirname, 'data'));
    }
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ 
            users: [], 
            transactions: [] 
        }, null, 2));
    }
}

function readData() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(data);
        if (!parsed.transactions) parsed.transactions = [];
        if (!parsed.users) parsed.users = [];
        return parsed;
    } catch (error) {
        return { users: [], transactions: [] };
    }
}

function writeData(data) {
    if (!data.transactions) data.transactions = [];
    if (!data.users) data.users = [];
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

initializeDataFile();

// ============================================================
// AUTHENTICATION ROUTES
// ============================================================

// ===== SESSION CHECK =====
app.get('/api/session', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, email: req.session.user.email });
    } else {
        res.json({ loggedIn: false });
    }
});

// ===== REGISTER =====
app.post('/api/register', async (req, res) => {
    console.log('=== REGISTER REQUEST ===');
    console.log('Body:', req.body);
    
    try {
        const { email, password } = req.body;
        
        if (!email || !email.includes('@') || !password || password.length < 6) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }
        
        const data = readData();
        const existingUser = data.users.find(u => u.email === email);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
        
        const newUser = {
            email: email,
            password: hashedPassword,
            verified: false,
            verificationCode: crypto.randomBytes(16).toString('hex'),
            walletBalance: 0,
            freeCredits: {
                add_wall: 3,
                add_concrete: 3,
                add_plaster: 3,
                add_painting: 3,
                add_tiling: 3,
                add_boq: 3
            },
            paidCredits: {
                add_wall: 0,
                add_concrete: 0,
                add_plaster: 0,
                add_painting: 0,
                add_tiling: 0,
                add_boq: 0
            },
            totalFreeUsed: 0,
            totalSpent: 0,
            createdAt: new Date().toISOString()
        };
        
        data.users.push(newUser);
        writeData(data);
        
        req.session.user = { email };
        console.log('User registered:', email);
        res.json({ success: true });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ===== LOGIN =====
app.post('/api/login', async (req, res) => {
    console.log('=== LOGIN REQUEST ===');
    console.log('Body:', req.body);
    
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        const data = readData();
        const user = data.users.find(u => u.email === email);
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
        
        if (user.password !== hashedPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        req.session.user = { email };
        console.log('User logged in:', email);
        res.json({ success: true });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ===== LOGOUT =====
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ============================================================
// ROOT & VIEW ROUTES
// ============================================================

// ===== ROOT =====
app.get('/', (req, res) => {
    let user = null;
    if (req.session.user && req.session.user.email) {
        const data = readData();
        const foundUser = data.users.find(u => u.email === req.session.user.email);
        if (foundUser) {
            user = foundUser;
            req.session.user = user;
        } else {
            req.session.user = null;
        }
    }
    res.render('index', { user: user });
});

// ===== BOQ ROUTE =====
app.get('/boq', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    res.render('boq', { user: req.session.user || null });
});

// ===== VERIFY EMAIL =====
app.get('/verify', async (req, res) => {
    const { code, email } = req.query;
    if (!code || !email) {
        return res.send('<h1>❌ Invalid Link</h1><a href="/">Go to App</a>');
    }
    
    try {
        const data = readData();
        const user = data.users.find(u => u.email === email);
        
        if (!user) return res.send('<h1>❌ User Not Found</h1><a href="/">Go to App</a>');
        if (user.verified) return res.send('<h1>✅ Already Verified</h1><a href="/">Go to App</a>');
        if (user.verificationCode === code) {
            user.verified = true;
            user.verificationCode = null;
            writeData(data);
            return res.send('<h1>✅ Verified! <a href="/">Go to App</a></h1>');
        }
        return res.send('<h1>❌ Invalid Code</h1><a href="/">Go to App</a>');
    } catch (error) {
        return res.send('<h1>❌ Error</h1><a href="/">Go to App</a>');
    }
});

// ===== TEMPORARY: AUTO-VERIFY =====
app.get('/auto-verify/:email', (req, res) => {
    const { email } = req.params;
    const data = readData();
    const user = data.users.find(u => u.email === email);
    
    if (!user) {
        return res.send(`<h1>❌ User not found: ${email}</h1><a href="/">Go to App</a>`);
    }
    
    user.verified = true;
    user.verificationCode = null;
    writeData(data);
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                .success { background: #e8f5e9; padding: 30px; border-radius: 12px; border: 2px solid #4caf50; }
                .button { display: inline-block; background: #1b3b5c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class="success">
                <h1>✅ Email Verified Successfully!</h1>
                <p>Email <strong>${email}</strong> has been verified.</p>
                <p>You now have <strong>3 free credits</strong> for each calculator type!</p>
                <a href="/" class="button">🚀 Go to App</a>
            </div>
        </body>
        </html>
    `);
});

// ============================================================
// API ROUTES
// ============================================================

// ===== TEST =====
app.get('/api/test', (req, res) => {
    res.json({
        status: 'ok',
        message: 'API is working!',
        timestamp: new Date().toISOString()
    });
});

// ===== SEND VERIFICATION EMAIL =====
app.post('/api/send-verification', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Invalid email' });
        }
        
        const data = readData();
        let user = data.users.find(u => u.email === email);
        
        if (user && user.verified) {
            return res.json({ message: 'Email already verified', verified: true, success: true });
        }
        
        const verificationCode = crypto.randomBytes(16).toString('hex');
        
        if (!user) {
            user = {
                email: email,
                password: null,
                verified: false,
                verificationCode: verificationCode,
                walletBalance: 0,
                freeCredits: {
                    add_wall: 3,
                    add_concrete: 3,
                    add_plaster: 3,
                    add_painting: 3,
                    add_tiling: 3,
                    add_boq: 3
                },
                paidCredits: {
                    add_wall: 0,
                    add_concrete: 0,
                    add_plaster: 0,
                    add_painting: 0,
                    add_tiling: 0,
                    add_boq: 0
                },
                totalFreeUsed: 0,
                totalSpent: 0,
                createdAt: new Date().toISOString()
            };
            data.users.push(user);
        } else {
            user.verificationCode = verificationCode;
        }
        writeData(data);
        
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const verificationLink = `${baseUrl}/verify?code=${verificationCode}&email=${encodeURIComponent(email)}`;
        
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: '🔐 Verify Your Email - Mjengo Pro',
            html: `
                <h1>Welcome to Mjengo Pro!</h1>
                <p>Click the link below to verify your email:</p>
                <a href="${verificationLink}" style="display:inline-block; background:#1b3b5c; color:white; padding:12px 24px; text-decoration:none; border-radius:8px;">Verify Email</a>
                <p>This link expires in 24 hours.</p>
            `
        });
        
        res.json({ success: true, message: 'Verification email sent' });
    } catch (error) {
        console.error('Send verification error:', error);
        res.status(500).json({ error: 'Failed to send verification email' });
    }
});

// ============================================================
// WALLET & CREDIT ROUTES
// ============================================================

// ===== CHECK CREDITS =====
app.get('/api/check-credits/:email/:action', (req, res) => {
    try {
        const { email, action } = req.params;
        const data = readData();
        const user = data.users.find(u => u.email === email);
        
        if (!user) {
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
        
        const freeCredits = user.freeCredits?.[action] || 0;
        const paidCredits = user.paidCredits?.[action] || 0;
        const walletBalance = user.walletBalance || 0;
        
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
        console.error('Error checking credits:', error);
        res.status(500).json({ error: 'Failed to check credits' });
    }
});

// ===== USE CREDIT =====
app.post('/api/use-credit', async (req, res) => {
    try {
        const { email, action } = req.body;
        const COST_PER_CALCULATION = 5;
        
        const data = readData();
        const user = data.users.find(u => u.email === email);
        
        if (!user) return res.json({ success: false, error: 'User not found' });
        if (!user.verified) return res.json({ success: false, error: 'Email not verified' });
        
        const freeCredits = user.freeCredits?.[action] || 0;
        if (freeCredits > 0) {
            user.freeCredits[action]--;
            user.totalFreeUsed = (user.totalFreeUsed || 0) + 1;
            writeData(data);
            
            if (req.session.user && req.session.user.email === email) {
                req.session.user = user;
            }
            
            return res.json({ success: true, type: 'free' });
        }
        
        const walletBalance = user.walletBalance || 0;
        if (walletBalance >= COST_PER_CALCULATION) {
            user.walletBalance = walletBalance - COST_PER_CALCULATION;
            user.totalSpent = (user.totalSpent || 0) + COST_PER_CALCULATION;
            
            if (!user.paidCredits) {
                user.paidCredits = {
                    add_wall: 0,
                    add_concrete: 0,
                    add_plaster: 0,
                    add_painting: 0,
                    add_tiling: 0,
                    add_boq: 0
                };
            }
            user.paidCredits[action] = (user.paidCredits[action] || 0) + 1;
            
            writeData(data);
            
            if (req.session.user && req.session.user.email === email) {
                req.session.user = user;
            }
            
            return res.json({ success: true, type: 'wallet' });
        }
        
        res.json({ success: false, error: 'No credits available' });
    } catch (error) {
        console.error('Error using credit:', error);
        res.status(500).json({ error: 'Failed to use credit' });
    }
});

// ===== LOAD WALLET =====
app.post('/api/load-wallet', async (req, res) => {
    try {
        const { email, amount } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });
        if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum load amount is KES 10' });
        
        const data = readData();
        const user = data.users.find(u => u.email === email);
        if (!user || !user.verified) return res.status(403).json({ error: 'Email not verified' });
        
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const response = await axios.post('https://api.paystack.co/transaction/initialize', {
            email: email,
            amount: amount * 100,
            metadata: { action: 'wallet_load', email, amount },
            callback_url: `${baseUrl}/payment/verify`
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.data.status) {
            if (!data.transactions) data.transactions = [];
            data.transactions.push({
                reference: response.data.data.reference,
                email: email,
                action: 'wallet_load',
                amount: amount,
                status: 'pending',
                createdAt: new Date().toISOString()
            });
            writeData(data);
            
            res.json({
                success: true,
                authorization_url: response.data.data.authorization_url,
                reference: response.data.data.reference
            });
        } else {
            res.status(400).json({ error: response.data.message });
        }
    } catch (error) {
        console.error('Wallet load error:', error);
        res.status(500).json({ error: 'Failed to load wallet' });
    }
});

// ===== WALLET BALANCE =====
app.get('/api/wallet-balance/:email', (req, res) => {
    try {
        const { email } = req.params;
        const data = readData();
        const user = data.users.find(u => u.email === email);
        
        if (!user) return res.json({ error: 'User not found', verified: false });
        
        const totalFree = Object.values(user.freeCredits || {}).reduce((a, b) => a + b, 0);
        const totalPaid = Object.values(user.paidCredits || {}).reduce((a, b) => a + b, 0);
        
        res.json({
            email: user.email,
            walletBalance: user.walletBalance || 0,
            freeCredits: totalFree,
            paidCredits: totalPaid,
            verified: user.verified || false
        });
    } catch (error) {
        console.error('Error getting wallet balance:', error);
        res.status(500).json({ error: 'Failed to get wallet balance' });
    }
});

// ===== USE WALLET =====
app.post('/api/use-wallet', (req, res) => {
    try {
        const { email, action } = req.body;
        const COST_PER_CALCULATION = 5;
        
        const data = readData();
        const user = data.users.find(u => u.email === email);
        
        if (!user) return res.json({ success: false, error: 'User not found' });
        if (!user.verified) return res.json({ success: false, error: 'Email not verified' });
        
        if (user.freeCredits && user.freeCredits[action] > 0) {
            user.freeCredits[action]--;
            user.totalFreeUsed = (user.totalFreeUsed || 0) + 1;
            writeData(data);
            
            if (req.session.user && req.session.user.email === email) {
                req.session.user = user;
            }
            
            return res.json({
                success: true,
                remaining: user.freeCredits[action],
                type: 'free',
                message: 'Used free credit'
            });
        }
        
        const currentBalance = user.walletBalance || 0;
        if (currentBalance >= COST_PER_CALCULATION) {
            user.walletBalance = currentBalance - COST_PER_CALCULATION;
            user.totalSpent = (user.totalSpent || 0) + COST_PER_CALCULATION;
            
            if (!user.paidCredits) {
                user.paidCredits = {
                    add_wall: 0,
                    add_concrete: 0,
                    add_plaster: 0,
                    add_painting: 0,
                    add_tiling: 0,
                    add_boq: 0
                };
            }
            user.paidCredits[action] = (user.paidCredits[action] || 0) + 1;
            
            writeData(data);
            
            if (req.session.user && req.session.user.email === email) {
                req.session.user = user;
            }
            
            return res.json({
                success: true,
                remaining: user.walletBalance,
                type: 'wallet',
                message: `KES ${COST_PER_CALCULATION} deducted from wallet`
            });
        } else {
            return res.json({
                success: false,
                error: 'Insufficient balance',
                balance: currentBalance,
                cost: COST_PER_CALCULATION,
                message: `Your balance (KES ${currentBalance}) is insufficient. Please load more funds.`
            });
        }
    } catch (error) {
        console.error('Error using wallet:', error);
        res.status(500).json({ error: 'Failed to use wallet' });
    }
});

// ===== USER SUMMARY =====
app.get('/api/user-summary/:email', (req, res) => {
    try {
        const { email } = req.params;
        const data = readData();
        const user = data.users.find(u => u.email === email);
        
        if (!user) return res.json({ error: 'User not found' });
        
        const totalFree = Object.values(user.freeCredits || {}).reduce((a, b) => a + b, 0);
        const totalPaid = Object.values(user.paidCredits || {}).reduce((a, b) => a + b, 0);
        
        res.json({
            email: user.email,
            verified: user.verified,
            walletBalance: user.walletBalance || 0,
            freeCredits: user.freeCredits,
            paidCredits: user.paidCredits,
            totalFree,
            totalPaid,
            totalCredits: totalFree + totalPaid + (user.walletBalance || 0),
            totalFreeUsed: user.totalFreeUsed || 0,
            totalSpent: user.totalSpent || 0,
            createdAt: user.createdAt
        });
    } catch (error) {
        console.error('Error getting user summary:', error);
        res.status(500).json({ error: 'Failed to get user summary' });
    }
});

// ============================================================
// PAYMENT ROUTES
// ============================================================

// ===== PAYMENT VERIFY =====
app.get('/payment/verify', async (req, res) => {
    try {
        const { reference } = req.query;
        if (!reference) return res.redirect('/?payment=error');
        
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        });
        
        if (response.data.status && response.data.data.status === 'success') {
            const data = response.data.data;
            const email = data.metadata?.email || data.customer.email;
            const amount = data.amount / 100;
            
            const jsonData = readData();
            
            const transaction = jsonData.transactions.find(t => t.reference === reference);
            if (transaction) {
                transaction.status = 'completed';
                transaction.paidAt = new Date().toISOString();
            }
            
            let user = jsonData.users.find(u => u.email === email);
            if (!user) {
                user = {
                    email: email,
                    verified: true,
                    walletBalance: 0,
                    freeCredits: {
                        add_wall: 3,
                        add_concrete: 3,
                        add_plaster: 3,
                        add_painting: 3,
                        add_tiling: 3,
                        add_boq: 3
                    },
                    paidCredits: {
                        add_wall: 0,
                        add_concrete: 0,
                        add_plaster: 0,
                        add_painting: 0,
                        add_tiling: 0,
                        add_boq: 0
                    },
                    totalFreeUsed: 0,
                    totalSpent: 0,
                    createdAt: new Date().toISOString()
                };
                jsonData.users.push(user);
            }
            
            user.walletBalance = (user.walletBalance || 0) + amount;
            user.totalSpent = (user.totalSpent || 0) + amount;
            
            writeData(jsonData);
            req.session.user = user;
            
            res.redirect('/?payment=success');
        } else {
            res.redirect('/?payment=error');
        }
    } catch (error) {
        console.error('Payment verification error:', error);
        res.redirect('/?payment=error');
    }
});

// ===== WEBHOOK =====
app.post('/webhook/paystack', (req, res) => {
    try {
        const signature = req.headers['x-paystack-signature'];
        const hash = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
            .update(JSON.stringify(req.body))
            .digest('hex');
        if (hash !== signature) return res.status(401).send('Invalid signature');
        if (req.body.event === 'charge.success') {
            const data = req.body.data;
            const email = data.metadata?.email || data.customer.email;
            const amount = data.amount / 100;
            
            const jsonData = readData();
            
            const transaction = jsonData.transactions.find(t => t.reference === data.reference);
            if (transaction) {
                transaction.status = 'completed';
                transaction.paidAt = new Date().toISOString();
            }
            
            let user = jsonData.users.find(u => u.email === email);
            if (!user) {
                user = {
                    email: email,
                    verified: true,
                    walletBalance: 0,
                    freeCredits: {
                        add_wall: 3,
                        add_concrete: 3,
                        add_plaster: 3,
                        add_painting: 3,
                        add_tiling: 3,
                        add_boq: 3
                    },
                    paidCredits: {
                        add_wall: 0,
                        add_concrete: 0,
                        add_plaster: 0,
                        add_painting: 0,
                        add_tiling: 0,
                        add_boq: 0
                    },
                    totalFreeUsed: 0,
                    totalSpent: 0,
                    createdAt: new Date().toISOString()
                };
                jsonData.users.push(user);
            }
            
            user.walletBalance = (user.walletBalance || 0) + amount;
            user.totalSpent = (user.totalSpent || 0) + amount;
            
            writeData(jsonData);
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(500);
    }
});

// ============================================================
// START SERVER
// ============================================================
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Mjengo Pro server running on http://localhost:${PORT}`);
        console.log(`📝 Test API: http://localhost:${PORT}/api/test`);
        console.log(`🔐 Register: http://localhost:${PORT}/api/register`);
        console.log(`🔑 Login: http://localhost:${PORT}/api/login`);
        console.log(`📋 BOQ: http://localhost:${PORT}/boq`);
        console.log(`✅ Auto-verify: http://localhost:${PORT}/auto-verify/your-email`);
        console.log('='.repeat(50));
    });
}

module.exports = app;
