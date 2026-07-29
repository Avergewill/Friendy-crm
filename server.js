const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const CSV_FILE = 'contacts.csv';
const CHAT_FILE = 'chat-history.txt';

// Middleware
app.use(express.json());
app.use(express.static('public'));

// --- SOCKET.IO LIVE CHAT & STORAGE ---
io.on('connection', (socket) => {
    console.log('A user connected to the CRM and Chat');

    // Send existing chat history to newly connected users
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

// 1. Get all contacts (Optional API route if needed)
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

// Start the server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running! Share this with your office: http://192.168.1.10:${PORT}`);
});
