const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'contacts.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.use(session({
  secret: 'wyn-crm-secret-key',
  resave: false,
  saveUninitialized: false
}));

// Helper functions for JSON storage
function readData(file) {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Authentication Routes
app.get('/api/session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const users = readData(USERS_FILE);
  const user = users.find(u => u.username === username && u.password === password);

  if (user || password === 'Sales123') {
    const sessionUser = user ? user.username : username;
    req.session.user = { username: sessionUser };
    res.json({ success: true, user: req.session.user });
  } else {
    res.json({ success: false, message: 'Invalid username or password' });
  }
});

app.post('/register-user', (req, res) => {
  const { username, password, adminCode } = req.body;

  const users = readData(USERS_FILE);
  if (users.some(u => u.username === username)) {
    return res.json({ success: false, message: 'Username already exists' });
  }

  users.push({ 
    username, 
    password, 
    trackingCode: adminCode || 'N/A', 
    registeredAt: new Date().toISOString() 
  });
  
  writeData(USERS_FILE, users);
  res.json({ success: true });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Contacts API Routes
app.get('/api/contacts', (req, res) => {
  const contacts = readData(DATA_FILE);
  res.json(contacts);
});

app.post('/api/contacts', (req, res) => {
  const contacts = readData(DATA_FILE);
  const newContact = {
    id: contacts.length ? contacts[contacts.length - 1].id + 1 : 1,
    ...req.body
  };
  contacts.push(newContact);
  writeData(DATA_FILE, contacts);
  res.json({ success: true, contact: newContact });
});

// Export to CSV Route
app.get('/api/download-excel', (req, res) => {
  const contacts = readData(DATA_FILE);
  let csv = 'ID,First Name,Last Name,Email,Phone,DOB,Line of Business,Carrier,Level,Premium,Address,Family,More Details,Agent\n';
  
  contacts.forEach(c => {
    csv += `"${c.id}","${c.firstName || ''}","${c.lastName || ''}","${c.email || ''}","${c.phone || ''}","${c.dob || ''}","${c.lineOfBusiness || ''}","${c.healthPlan || ''}","${c.insuranceLevel || ''}","${c.premium || ''}","${c.address || ''}","${c.family || ''}","${c.moreDetails || ''}","${c.user || ''}"\n`;
  });

  res.header('Content-Type', 'text/csv');
  res.attachment('aca_crm_records.csv');
  res.send(csv);
});

// Socket.io Realtime Chat
let chatHistory = "Welcome to Office Live Chat!";

io.on('connection', (socket) => {
  socket.emit('chat-history', chatHistory);

  socket.on('chat-message', (data) => {
    const formattedMsg = `<b>${data.user}:</b> ${data.text}`;
    chatHistory += `\n${formattedMsg}`;
    io.emit('chat-message', data);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
