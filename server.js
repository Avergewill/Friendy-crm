const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CSV_FILE = 'contacts.csv';
const CHAT_FILE = 'chat-history.txt';

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname)); // <-- Crucial: Serves your index.html and frontend files

// Setup session handling
app.use(session({
  secret: 'my-super-secret-key-123',
  resave: false,
  saveUninitialized: false
}));

// Your 8 mock users
const users = [
    { id: 1, username: 'user1', passwordHash: bcrypt.hashSync('password123', 8) },
    { id: 2, username: 'user2', passwordHash: bcrypt.hashSync('password456', 8) },
    { id: 3, username: 'user3', passwordHash: bcrypt.hashSync('password789', 8) },
    { id: 4, username: 'user4', passwordHash: bcrypt.hashSync('password012', 8) },
    { id: 5, username: 'user5', passwordHash: bcrypt.hashSync('password345', 8) },
    { id: 6, username: 'user6', passwordHash: bcrypt.hashSync('password678', 8) },
    { id: 7, username: 'user7', passwordHash: bcrypt.hashSync('password901', 8) },
    { id: 8, username: 'user8', passwordHash: bcrypt.hashSync('password234', 8) }
];

// Handle login submission
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    if (user && bcrypt.compareSync(password, user.passwordHash)) {
        req.session.user = user;
        res.json({ success: true, message: 'Login successful!' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// --- SOCKET.IO LIVE CHAT & STORAGE ---
io.on('connection', (socket) => {
    console.log('A user connected to the CRM and Chat');

    if (fs.existsSync(CHAT_FILE)) {
        const history = fs.readFileSync(CHAT_FILE, 'utf8');
        socket.emit('chat-history', history);
    }

    socket.on('chat-message', (msgData) => {
        const chatLine = `${msgData.user}: ${msgData.text}\n`;
        fs.appendFileSync(CHAT_FILE, chatLine);
        io.emit('chat-message', msgData);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

// 1. Get all contacts
app.get('/api/contacts', (req, res) => {
    let contacts = [];
    if (fs.existsSync(CSV_FILE)) {
        const fileContent = fs.readFileSync(CSV_FILE, 'utf8');
        const lines = fileContent.trim().split('\n');
        if (lines.length > 1) {
            contacts = lines.slice(1).map(line => {
                const parts = line.split(',');
                return {
                    id: parts[0],
                    firstName: parts[1],
                    lastName: parts[2],
                    email: parts[3],
                    phone: parts[4],
                    dob: parts[5],
                    healthPlan: parts[6],
                    address: parts[7],
                    family: parts[8]
                };
            });
        }
    }
    res.json(contacts);
});

// 2. Save a new contact
app.post('/api/contacts', (req, res) => {
    const { firstName, lastName, email, phone, dob, healthPlan, address, family } = req.body;
    
    const cleanAddress = (address || '').replace(/,/g, ' ');
    const cleanFamily = (family || '').replace(/,/g, '; '); 

    let contacts = [];
    if (fs.existsSync(CSV_FILE)) {
        const fileContent = fs.readFileSync(CSV_FILE, 'utf8');
        const lines = fileContent.trim().split('\n');
        if (lines.length > 1) {
            contacts = lines.slice(1).map(line => {
                const parts = line.split(',');
                return { id: parseInt(parts[0]) || 0 };
            });
        }
    }

    const nextId = contacts.length > 0 ? Math.max(...contacts.map(c => c.id)) + 1 : 1;
    const csvLine = `${nextId},${firstName},${lastName},${email},${phone || ''},${dob || ''},${healthPlan || ''},${cleanAddress},${cleanFamily}\n`;

    if (!fs.existsSync(CSV_FILE)) {
        fs.writeFileSync(CSV_FILE, 'ID,First Name,Last Name,Email,Phone,DOB,Health Plan,Address,Family Members\n');
    }

    fs.appendFileSync(CSV_FILE, csvLine);
    res.json({ success: true, message: 'Contact enrolled successfully!' });
});

// 3. Download CSV Excel Sheet
app.get('/api/download-excel', (req, res) => {
    if (fs.existsSync(CSV_FILE)) {
        res.download(CSV_FILE, 'CRM_Contacts.csv');
    } else {
        res.status(404).send('No contacts file found yet.');
    }
});

// Serve main HTML file explicitly for root route
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});