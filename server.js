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
const CALENDAR_FILE = path.join(__dirname, 'calendar.json');
const ACTIVITY_FILE = path.join(__dirname, 'activity_log.json');

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
  if (!fs.existsSync(file)) return file === CALENDAR_FILE ? {} : [];
  try {
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content || (file === CALENDAR_FILE ? '{}' : '[]'));
  } catch (e) {
    return file === CALENDAR_FILE ? {} : [];
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

  // Automatically grant admin if username is admin or password is Wyn2026
  const isAdmin = (username.toLowerCase() === 'admin' || password === 'Wyn2026' || (user && user.isAdmin));

  if (user || password === 'Sales123' || password === 'Wyn2026') {
    const sessionUser = user ? user.username : username;
    req.session.user = { username: sessionUser, isAdmin: Boolean(isAdmin) };

    // --- CLOCK FUNCTION / ACTIVITY LOG ---
    activityLogs.push({
      username: sessionUser,
      action: 'Logged In (Clock-In)',
      timestamp: new Date().toLocaleString('en-US', {
        timeZone: 'America/Bogota', // Change to your local timezone (e.g., 'America/New_York')
        dateStyle: 'medium',
        timeStyle: 'medium'
      })
    });
    writeData(ACTIVITY_FILE, activityLogs);
    // -------------------------------------

    res.json({ success: true, user: req.session.user });
  } else {
    res.json({ success: false, message: 'Invalid username or password' });
  }
});

app.post('/register-user', (req, res) => {
  const { username, password } = req.body;

  const users = readData(USERS_FILE);
  if (users.some(u => u.username === username)) {
    return res.json({ success: false, message: 'Username already exists' });
  }

  users.push({ 
    username, 
    password, 
    isAdmin: false, 
    registeredAt: new Date().toISOString() 
  });
  
  writeData(USERS_FILE, users);
  res.json({ success: true });
});

// Get Login Activity Log (Admin Only)
app.get('/api/activity-log', (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Access Denied' });
  }
  const logs = readData(ACTIVITY_FILE);
  res.json(logs);
});

// Delete User Route (Admin Only)
app.delete('/api/users/:username', (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Access Denied: Only administrators can delete users.' });
  }

  const targetUsername = req.params.username;
  
  // Prevent admin from deleting themselves accidentally
  if (req.session.user.username === targetUsername) {
    return res.status(400).json({ success: false, message: 'You cannot delete your own active account.' });
  }

  let users = readData(USERS_FILE);
  const initialLength = users.length;
  
  // Filter out the user to delete
  users = users.filter(u => u.username !== targetUsername);

  if (users.length === initialLength) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  writeData(USERS_FILE, users);
  res.json({ success: true, message: `User ${targetUsername} successfully deleted.` });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Shared Calendar Notes API
app.get('/api/calendar', (req, res) => {
  const notes = readData(CALENDAR_FILE);
  res.json(notes);
});

app.post('/api/calendar', (req, res) => {
  const { dateKey, noteText } = req.body;
  const notes = readData(CALENDAR_FILE);

  if (noteText && noteText.trim() !== '') {
    notes[dateKey] = noteText.trim();
  } else {
    delete notes[dateKey];
  }

  writeData(CALENDAR_FILE, notes);
  res.json({ success: true, notes });
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

// Export to CSV Route (Admin Only)
app.get('/api/download-excel', (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).send('Access Denied: Only administrators can download client records.');
  }

  const requestedLob = req.query.lob || 'ACA Health Care';
  const contacts = readData(DATA_FILE);
  const filteredContacts = contacts.filter(c => (c.lineOfBusiness || 'ACA Health Care') === requestedLob);

  let csv = 'ID,First Name,Last Name,Email,Phone,DOB,Line of Business,Carrier,Level,Premium,Address,Family,More Details,Agent\n';
  
  filteredContacts.forEach(c => {
    csv += `"${c.id}","${c.firstName || ''}","${c.lastName || ''}","${c.email || ''}","${c.phone || ''}","${c.dob || ''}","${c.lineOfBusiness || ''}","${c.healthPlan || ''}","${c.insuranceLevel || ''}","${c.premium || ''}","${c.address || ''}","${c.family || ''}","${c.moreDetails || ''}","${c.user || ''}"\n`;
  });

  const fileName = requestedLob === 'Dr. Benson' ? 'dr_benson_records.csv' : 'aca_health_records.csv';
  res.header('Content-Type', 'text/csv');
  res.attachment(fileName);
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
