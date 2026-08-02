const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Persistent JSON File Helpers so data doesn't vanish on restart
function readJSONFile(filename, defaultVal) {
    if (fs.existsSync(filename)) {
        try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch (e) { return defaultVal; }
    }
    return defaultVal;
}

function writeJSONFile(filename, data) {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

// Persistent Collections
const users = readJSONFile('users.json', []);
const contacts = readJSONFile('contacts.json', []);
let chatHistory = readJSONFile('chats.json', "Welcome to Office Live Chat!\n");
let sentConsents = readJSONFile('sent-consents.json', []);
let appointments = readJSONFile('appointments.json', []);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'wyn-crm-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 30 * 24 * 60 * 60 * 1000 // Keeps password & login active for 30 days
    }
}));
app.use(express.static(path.join(__dirname)));

// Session verification endpoint
app.get('/api/session', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// Registration: Regular users need only username & password. Admin needs the Wyn2026 passcode.
app.post('/register-user', async (req, res) => {
    const { username, password, adminCode } = req.body;
    let role = 'user';
    if (adminCode && adminCode.trim() !== '') {
        if (adminCode !== 'Wyn2026') {
            return res.json({ success: false, message: 'Invalid Admin Passcode.' });
        }
        role = 'admin';
    }
    const existingUser = users.find(u => u.username === username);
    if (existingUser) {
        return res.json({ success: false, message: 'Username already exists.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ username, password: hashedPassword, role });
    writeJSONFile('users.json', users);
    res.json({ success: true });
});

// Login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    if (!user) {
        return res.json({ success: false, message: 'Invalid username or password.' });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
        return res.json({ success: false, message: 'Invalid username or password.' });
    }
    req.session.user = { username: user.username, role: user.role };
    res.json({ success: true, user: req.session.user });
});

// Logout
app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// Contacts API with search query filter support
app.get('/api/contacts', (req, res) => {
    const search = req.query.search ? req.query.search.toLowerCase() : '';
    if (!search) {
        return res.json(contacts);
    }
    const filtered = contacts.filter(c => 
        (c.firstName && c.firstName.toLowerCase().includes(search)) || 
        (c.lastName && c.lastName.toLowerCase().includes(search)) || 
        (c.phone && c.phone.includes(search)) || 
        (c.email && c.email.toLowerCase().includes(search)) || 
        (c.user && c.user.toLowerCase().includes(search))
    );
    res.json(filtered);
});

app.post('/api/contacts', (req, res) => {
    const newContact = { id: contacts.length + 1, ...req.body };
    contacts.push(newContact);
    writeJSONFile('contacts.json', contacts);
    res.json({ success: true, contact: newContact });
});

// Nodemailer Transporter Setup using Render Environment Variables
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// Consent / Contact Form Email Route with Duplicate Check & Resend Confirmation
app.post('/api/contact-email', async (req, res) => {
    const { name, email, message, forceResend } = req.body;

    const existingEntry = sentConsents.find(c => c.email === email && (Date.now() - c.timestamp < 300000));
    
    if (existingEntry && !forceResend) {
        return res.json({ 
            success: false, 
            needsConfirmation: true,
            message: 'A consent form was already sent to this email recently. Are you sure you want to resend it? (Check if the email address was correct).' 
        });
    }

    try {
        await transporter.sendMail({
            from: `"Company Website" <${process.env.SMTP_USER}>`,
            to: process.env.RECEIVER_EMAIL,
            subject: 'New Consent / Contact Form Submission',
            text: `Name: ${name}\nEmail: ${email}\nMessage: ${message}`,
            replyTo: email,
        });

        if (!existingEntry) {
            sentConsents.push({ name, email, timestamp: Date.now() });
        } else {
            existingEntry.timestamp = Date.now();
        }
        writeJSONFile('sent-consents.json', sentConsents);

        res.json({ 
            success: true, 
            message: 'Email sent successfully!', 
            totalCount: sentConsents.length 
        });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ success: false, error: 'Failed to send email' });
    }
});

// Endpoint to fetch the total count of sent consent forms
app.get('/api/consent-count', (req, res) => {
    res.json({ totalCount: sentConsents.length });
});

// Shared Appointments API (DC Benson & ACA visible to all users)
app.get('/api/appointments', (req, res) => {
    res.json(appointments);
});

app.post('/api/appointments', (req, res) => {
    const { title, date, type, notes, color } = req.body;
    const newAppointment = { 
        id: Date.now(), 
        title, 
        date, 
        type, 
        notes: notes || '', 
        color: notes ? '#10b981' : (color || '#3b82f6'), // Auto-changes color if note is added
        createdBy: req.session.user ? req.session.user.username : 'Guest'
    };
    appointments.push(newAppointment);
    writeJSONFile('appointments.json', appointments);
    res.json({ success: true, appointment: newAppointment });
});

// Download Route: Strictly protected for ADMIN ONLY
app.get('/api/download-excel', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send('Access Denied. Administrator access required.');
    }
    let csv = 'ID,First Name,Last Name,Email,Phone,DOB,Line of Business,Carrier,Level,Premium,Address,Family Notes,More Details,Agent\n';
    contacts.forEach(c => {
        csv += `"${c.id}","${c.firstName}","${c.lastName}","${c.email}","${c.phone}","${c.dob}","${c.lineOfBusiness}","${c.healthPlan}","${c.insuranceLevel}","${c.premium}","${c.address}","${c.family}","${c.moreDetails}","${c.user}"\n`;
    });
    res.header('Content-Type', 'text/csv');
    res.attachment('wyn-crm-contacts.csv');
    res.send(csv);
});

io.on('connection', (socket) => {
    socket.emit('chat-history', chatHistory);
    socket.on('chat-message', (data) => {
        const messageLine = `${data.user}: ${data.text}\n`;
        chatHistory += messageLine;
        writeJSONFile('chats.json', chatHistory);
        io.emit('chat-message', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
