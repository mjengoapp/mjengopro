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

// Middleware
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
// ROOT ROUTE
// ============================================================
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

// ============================================================
// EMAIL VERIFICATION ROUTE
// ============================================================
app.get('/verify', (req, res) => {
    const { code, email } = req.query;
    
    if (!code || !email) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                    .error { background: #fff3e0; padding: 30px; border-radius: 12px; border: 2px solid #ff9800; }
                    .button { display: inline-block; background: #1b3b5c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="error">
                    <h1>❌ Invalid Verification Link</h1>
                    <p>The verification link is missing required parameters.</p>
                    <a href="${process.env.BASE_URL || 'https://mjengoapp.co.ke'}" class="button">🏠 Go to App</a>
                </div>
            </body>
            </html>
        `);
    }
    
    const data = readData();
    const user = data.users.find(u => u.email === email);
    
    if (!user) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                    .error { background: #fff3e0; padding: 30px; border-radius: 12px; border: 2px solid #ff9800; }
                    .button { display: inline-block; background: #1b3b5c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="error">
                    <h1>❌ User Not Found</h1>
                    <p>No account found with this email address.</p>
                    <a href="${process.env.BASE_URL || 'https://mjengoapp.co.ke'}" class="button">🏠 Go to App</a>
                </div>
            </body>
            </html>
        `);
    }
    
    if (user.verified) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                    .success { background: #e8f5e9; padding: 30px; border-radius: 12px; border: 2px solid #4caf50; }
                    .button { display: inline-block; background: #1b3b5c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="success">
                    <h1>✅ Email Already Verified</h1>
                    <p>Your email was already verified.</p>
                    <a href="${process.env.BASE_URL || 'https://mjengoapp.co.ke'}" class="button">🚀 Go to App</a>
                </div>
            </body>
            </html>
        `);
    }
    
    if (user.verificationCode === code) {
        user.verified = true;
        user.verificationCode = null;
        writeData(data);
        
        if (req.session.user && req.session.user.email === email) {
            req.session.user = user;
        }
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                    .success { background: #e8f5e9; padding: 30px; border-radius: 12px; border: 2px solid #4caf50; }
                    .button { display: inline-block; background: #1b3b5c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                    .credits { background: #fff3e0; padding: 15px; border-radius: 8px; margin: 15px 0; }
                </style>
            </head>
            <body>
                <div class="success">
                    <h1>✅ Email Verified Successfully!</h1>
                    <p>Your email <strong>${email}</strong> has been verified.</p>
                    
                    <div class="credits">
                        <h3>🎁 Your Free Credits Are Ready!</h3>
                        <p>You have <strong>3 free calculations</strong> for each calculator type.</p>
                        <ul style="text-align: left; max-width: 300px; margin: 10px auto;">
                            <li>🧱 Walling: 3 free</li>
                            <li>🧪 Concrete: 3 free</li>
                            <li>🧹 Plaster: 3 free</li>
                            <li>🏗️ RC Structures: 3 free</li>
                            <li>🏠 Roof: 3 free</li>
                            <li>🎨 Painting: 3 free</li>
                            <li>🪠 Tiling: 3 free</li>
                            <li>🏗️ Site Works: 3 free</li>
                        </ul>
                    </div>
                    
                    <a href="${process.env.BASE_URL || 'https://mjengoapp.co.ke'}" class="button">🚀 Go to App</a>
                    
                    <p style="color: #6a8aa8; font-size: 0.85rem; margin-top: 20px;">
                        You can now close this page and return to the app.
                    </p>
                </div>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                    .error { background: #fff3e0; padding: 30px; border-radius: 12px; border: 2px solid #ff9800; }
                    .button { display: inline-block; background: #1b3b5c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="error">
                    <h1>❌ Invalid Verification Code</h1>
                    <p>The verification code is incorrect or has expired.</p>
                    <a href="${process.env.BASE_URL || 'https://mjengoapp.co.ke'}" class="button">🏠 Go to App</a>
                </div>
            </body>
            </html>
        `);
    }
});

// ============================================================
// EMAIL VERIFICATION - SEND
// ============================================================
app.post('/api/send-verification', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Invalid email' });
        }

        const verificationCode = crypto.randomBytes(16).toString('hex');
        
        const data = readData();
        let user = data.users.find(u => u.email === email);
        
        if (user && user.verified) {
            return res.json({ message: 'Email already verified', verified: true });
        }
        
        if (!user) {
            user = {
                email: email,
                verified: false,
                verificationCode: verificationCode,
                walletBalance: 0,
                freeCredits: {
                    add_wall: 3,
                    add_concrete: 3,
                    add_plaster: 3,
                    add_rc: 3,
                    add_roof: 3,
                    add_painting: 3,
                    add_tiling: 3,
                    add_siteworks: 3
                },
                paidCredits: {
                    add_wall: 0,
                    add_concrete: 0,
                    add_plaster: 0,
                    add_rc: 0,
                    add_roof: 0,
                    add_painting: 0,
                    add_tiling: 0,
                    add_siteworks: 0
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

        const baseUrl = process.env.BASE_URL || 'https://mjengoapp.co.ke';
        const verificationLink = `${baseUrl}/verify?code=${verificationCode}&email=${encodeURIComponent(email)}`;

        const mailOptions = {
            from: process.env.EMAIL_USER || 'your-email@gmail.com',
            to: email,
            subject: '🔐 Verify Your Email - Construction Pro',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: #1b3b5c; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
                        .content { background: #f8faff; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e8eef5; }
                        .button { display: inline-block; background: #1b3b5c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
                        .footer { text-align: center; color: #6a8aa8; font-size: 0.8rem; margin-top: 20px; }
                        .free-credits { background: #e8f5e9; padding: 15px; border-radius: 8px; margin: 15px 0; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>🏗️ Construction Pro</h1>
                    </div>
                    <div class="content">
                        <h2>Welcome to Construction Pro!</h2>
                        <p>Click the button below to verify your email address and get started.</p>
                        
                        <div style="text-align: center;">
                            <a href="${verificationLink}" class="button">✅ Verify My Email</a>
                        </div>
                        
                        <div class="free-credits">
                            <strong>🎁 You'll receive 3 FREE calculations for each calculator type!</strong>
                            <ul>
                                <li>🧱 Walling: 3 free</li>
                                <li>🧪 Concrete: 3 free</li>
                                <li>🧹 Plaster: 3 free</li>
                                <li>🏗️ RC Structures: 3 free</li>
                                <li>🏠 Roof: 3 free</li>
                                <li>🎨 Painting: 3 free</li>
                                <li>🪠 Tiling: 3 free</li>
                                <li>🏗️ Site Works: 3 free</li>
                            </ul>
                        </div>
                        
                        <p style="font-size: 0.9rem; color: #6a8aa8;">
                            This link expires in 24 hours. If you didn't sign up, you can ignore this email.
                        </p>
                    </div>
                    <div class="footer">
                        <p>Construction Pro © 2026</p>
                        <p>If you have questions, contact: support@mjengoapp.co.ke</p>
                    </div>
                </body>
                </html>
            `
        };

        await transporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            message: 'Verification email sent',
            verified: false 
        });
        
    } catch (error) {
        console.error('Send verification error:', error);
        res.status(500).json({ error: 'Failed to send verification email' });
    }
});

// ============================================================
// WALLET FUNCTIONS
// ============================================================

// Initialize payment to load wallet
app.post('/api/load-wallet', async (req, res) => {
    try {
        const { email, amount } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        if (!amount || amount < 10) {
            return res.status(400).json({ error: 'Minimum load amount is KES 10' });
        }

        const data = readData();
        const user = data.users.find(u => u.email === email);
        if (!user || !user.verified) {
            return res.status(403).json({ error: 'Email not verified' });
        }

        const response = await axios.post('https://api.paystack.co/transaction/initialize', {
            email: email,
            amount: amount * 100,
            metadata: {
                action: 'wallet_load',
                email: email,
                amount: amount
            },
            callback_url: `${req.protocol}://${req.get('host')}/payment/verify`
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
        console.error('Wallet load error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to load wallet' });
    }
});

// Check wallet balance
app.get('/api/wallet-balance/:email', (req, res) => {
    try {
        const { email } = req.params;
        const data = readData();
        const user = data.users.find(u => u.email === email);
        
        if (user) {
            const freeTotal = Object.values(user.freeCredits || {}).reduce((a, b) => a + b, 0);
            const paidTotal = Object.values(user.paidCredits || {}).reduce((a, b) => a + b, 0);
            
            res.json({
                email: user.email,
                walletBalance: user.walletBalance || 0,
                freeCredits: freeTotal,
                paidCredits: paidTotal,
                totalCredits: freeTotal + paidTotal + (user.walletBalance || 0),
                verified: user.verified
            });
        } else {
            res.json({ error: 'User not found', verified: false });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to get wallet balance' });
    }
});

// Use wallet to pay for calculation
app.post('/api/use-wallet', (req, res) => {
    try {
        const { email, action } = req.body;
        const COST_PER_CALCULATION = 5;
        
        const data = readData();
        const user = data.users.find(u => u.email === email);
        
        if (!user) {
            return res.json({ success: false, error: 'User not found' });
        }
        
        if (!user.verified) {
            return res.json({ success: false, error: 'Email not verified' });
        }
        
        // Check free credits first
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
        
        // Then check wallet balance
        const currentBalance = user.walletBalance || 0;
        
        if (currentBalance >= COST_PER_CALCULATION) {
            // Deduct from wallet
            user.walletBalance = currentBalance - COST_PER_CALCULATION;
            user.totalSpent = (user.totalSpent || 0) + COST_PER_CALCULATION;
            
            // Add to paid credits
            if (!user.paidCredits) {
                user.paidCredits = {
                    add_wall: 0,
                    add_concrete: 0,
                    add_plaster: 0,
                    add_rc: 0,
                    add_roof: 0,
                    add_painting: 0,
                    add_tiling: 0,
                    add_siteworks: 0
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
        res.status(500).json({ error: 'Failed to use wallet' });
    }
});

// ============================================================
// CREDIT CHECKING
// ============================================================
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
                freeCredits: 0,
                paidCredits: 0,
                walletBalance: 0,
                message: 'User not found'
            });
        }
        
        if (!user.verified) {
            return res.json({ 
                credits: 0, 
                hasCredit: false, 
                verified: false,
                freeCredits: 0,
                paidCredits: 0,
                walletBalance: 0,
                message: 'Please verify your email first'
            });
        }
        
        const freeCredits = user.freeCredits?.[action] || 0;
        const paidCredits = user.paidCredits?.[action] || 0;
        const walletCanAfford = (user.walletBalance || 0) >= 5;
        const totalCredits = freeCredits + paidCredits + (walletCanAfford ? 1 : 0);
        
        console.log(`[CHECK] ${email} - ${action}: free=${freeCredits}, paid=${paidCredits}, wallet=${user.walletBalance}`);
        
        res.json({ 
            credits: totalCredits,
            freeCredits: freeCredits,
            paidCredits: paidCredits,
            walletBalance: user.walletBalance || 0,
            hasCredit: totalCredits > 0 || walletCanAfford,
            verified: true
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check credits' });
    }
});

// Use credit (free or paid)
app.post('/api/use-credit', (req, res) => {
    try {
        const { email, action } = req.body;
        const data = readData();
        const user = data.users.find(u => u.email === email);
        
        if (!user) {
            return res.json({ success: false, error: 'User not found' });
        }
        
        if (!user.verified) {
            return res.json({ success: false, error: 'Email not verified' });
        }
        
        // Use free credits first
        if (user.freeCredits && user.freeCredits[action] > 0) {
            user.freeCredits[action]--;
            user.totalFreeUsed = (user.totalFreeUsed || 0) + 1;
            writeData(data);
            
            if (req.session.user && req.session.user.email === email) {
                req.session.user = user;
            }
            
            console.log(`[USED] Free credit for ${email} - ${action}, remaining: ${user.freeCredits[action]}`);
            
            return res.json({ 
                success: true, 
                remaining: user.freeCredits[action],
                type: 'free'
            });
        }
        
        // Then use paid credits from wallet
        const currentBalance = user.walletBalance || 0;
        if (currentBalance >= 5) {
            user.walletBalance = currentBalance - 5;
            user.totalSpent = (user.totalSpent || 0) + 5;
            
            if (!user.paidCredits) {
                user.paidCredits = {
                    add_wall: 0,
                    add_concrete: 0,
                    add_plaster: 0,
                    add_rc: 0,
                    add_roof: 0,
                    add_painting: 0,
                    add_tiling: 0,
                    add_siteworks: 0
                };
            }
            user.paidCredits[action] = (user.paidCredits[action] || 0) + 1;
            
            writeData(data);
            
            if (req.session.user && req.session.user.email === email) {
                req.session.user = user;
            }
            
            console.log(`[USED] Wallet for ${email} - ${action}, remaining balance: ${user.walletBalance}`);
            
            return res.json({ 
                success: true, 
                remaining: user.walletBalance,
                type: 'wallet'
            });
        }
        
        res.json({ success: false, error: 'No credits available' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to use credit' });
    }
});

// ============================================================
// GET USER SUMMARY
// ============================================================
app.get('/api/user-summary/:email', (req, res) => {
    try {
        const { email } = req.params;
        const data = readData();
        const user = data.users.find(u => u.email === email);
        
        if (user) {
            const totalFree = Object.values(user.freeCredits || {}).reduce((a, b) => a + b, 0);
            const totalPaid = Object.values(user.paidCredits || {}).reduce((a, b) => a + b, 0);
            const totalCredits = totalFree + totalPaid + (user.walletBalance || 0);
            
            res.json({
                email: user.email,
                verified: user.verified,
                walletBalance: user.walletBalance || 0,
                freeCredits: user.freeCredits,
                paidCredits: user.paidCredits,
                totalFree: totalFree,
                totalPaid: totalPaid,
                totalCredits: totalCredits,
                totalFreeUsed: user.totalFreeUsed || 0,
                totalSpent: user.totalSpent || 0,
                createdAt: user.createdAt
            });
        } else {
            res.json({ error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to get user summary' });
    }
});

// ============================================================
// PAYMENT VERIFICATION
// ============================================================
app.get('/payment/verify', async (req, res) => {
    try {
        const { reference } = req.query;
        
        if (!reference) {
            return res.redirect('/?payment=error&message=Missing reference');
        }

        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: {
                'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
            }
        });

        if (response.data.status && response.data.data.status === 'success') {
            const metadata = response.data.data.metadata;
            const email = metadata.email || response.data.data.customer.email;
            const action = metadata.action || 'add_wall';
            const amount = response.data.data.amount / 100;

            const data = readData();
            
            if (!data.transactions) data.transactions = [];
            
            const transaction = data.transactions.find(t => t.reference === reference);
            if (transaction) {
                transaction.status = 'completed';
                transaction.paidAt = new Date().toISOString();
            }

            if (!data.users) data.users = [];
            
            let user = data.users.find(u => u.email === email);
            if (!user) {
                user = {
                    email: email,
                    verified: true,
                    walletBalance: 0,
                    freeCredits: {
                        add_wall: 3,
                        add_concrete: 3,
                        add_plaster: 3,
                        add_rc: 3,
                        add_roof: 3,
                        add_painting: 3,
                        add_tiling: 3,
                        add_siteworks: 3
                    },
                    paidCredits: {
                        add_wall: 0,
                        add_concrete: 0,
                        add_plaster: 0,
                        add_rc: 0,
                        add_roof: 0,
                        add_painting: 0,
                        add_tiling: 0,
                        add_siteworks: 0
                    },
                    totalFreeUsed: 0,
                    totalSpent: 0,
                    createdAt: new Date().toISOString()
                };
                data.users.push(user);
            }

            if (action === 'wallet_load') {
                user.walletBalance = (user.walletBalance || 0) + amount;
                user.totalSpent = (user.totalSpent || 0) + amount;
            } else {
                if (!user.paidCredits) {
                    user.paidCredits = {
                        add_wall: 0,
                        add_concrete: 0,
                        add_plaster: 0,
                        add_rc: 0,
                        add_roof: 0,
                        add_painting: 0,
                        add_tiling: 0,
                        add_siteworks: 0
                    };
                }
                user.paidCredits[action] = (user.paidCredits[action] || 0) + 1;
                user.totalSpent = (user.totalSpent || 0) + amount;
            }

            writeData(data);
            req.session.user = user;

            res.redirect(`/?payment=success&action=${action}`);
        } else {
            res.redirect('/?payment=error&message=Payment verification failed');
        }
    } catch (error) {
        console.error('Payment verification error:', error.message);
        res.redirect('/?payment=error&message=Verification failed');
    }
});

// ============================================================
// WEBHOOK
// ============================================================
app.post('/webhook/paystack', (req, res) => {
    try {
        const signature = req.headers['x-paystack-signature'];
        const body = req.body;

        const hash = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
            .update(JSON.stringify(body))
            .digest('hex');

        if (hash !== signature) {
            return res.status(401).send('Invalid signature');
        }

        if (body.event === 'charge.success') {
            const data = body.data;
            const metadata = data.metadata;
            const email = metadata.email || data.customer.email;
            const action = metadata.action || 'add_wall';
            const reference = data.reference;
            const amount = data.amount / 100;

            const jsonData = readData();
            
            if (!jsonData.transactions) jsonData.transactions = [];
            
            const transaction = jsonData.transactions.find(t => t.reference === reference);
            if (transaction) {
                transaction.status = 'completed';
                transaction.paidAt = new Date().toISOString();
            }

            if (!jsonData.users) jsonData.users = [];
            
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
                        add_rc: 3,
                        add_roof: 3,
                        add_painting: 3,
                        add_tiling: 3,
                        add_siteworks: 3
                    },
                    paidCredits: {
                        add_wall: 0,
                        add_concrete: 0,
                        add_plaster: 0,
                        add_rc: 0,
                        add_roof: 0,
                        add_painting: 0,
                        add_tiling: 0,
                        add_siteworks: 0
                    },
                    totalFreeUsed: 0,
                    totalSpent: 0,
                    createdAt: new Date().toISOString()
                };
                jsonData.users.push(user);
            }

            if (action === 'wallet_load') {
                user.walletBalance = (user.walletBalance || 0) + amount;
                user.totalSpent = (user.totalSpent || 0) + amount;
            } else {
                if (!user.paidCredits) {
                    user.paidCredits = {
                        add_wall: 0,
                        add_concrete: 0,
                        add_plaster: 0,
                        add_rc: 0,
                        add_roof: 0,
                        add_painting: 0,
                        add_tiling: 0,
                        add_siteworks: 0
                    };
                }
                user.paidCredits[action] = (user.paidCredits[action] || 0) + 1;
                user.totalSpent = (user.totalSpent || 0) + amount;
            }

            writeData(jsonData);
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(500);
    }
});

app.listen(PORT, () => {
    console.log(`Mjengo Pro server running on http://localhost:${PORT}`);
});
