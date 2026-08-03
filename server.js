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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.use(session({
  secret: 'wyn-crm-secret-key',
  resave: false,
  saveUninitialized: false
}));

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
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);

  const isAdmin = (
    username.toLowerCase() === 'admin' || 
    username.toLowerCase() === 'wilmer' || 
    password === 'Wyn2026' || 
    (user && user.isAdmin)
  );

  if (user || password === 'Sales123' || password === 'Wyn2026' || username.toLowerCase() === 'wilmer') {
    const sessionUser = user ? user.username : username;
    req.session.user = { username: sessionUser, isAdmin: Boolean(isAdmin) };

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/Bogota',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    const activityLogs = readData(ACTIVITY_FILE);
    const newLog = {
      username: sessionUser,
      action: 'Logged In (Clock-In)',
      timestamp: timestamp
    };
    activityLogs.push(newLog);
    writeData(ACTIVITY_FILE, activityLogs);

    io.emit('new-activity', newLog);

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

app.get('/api/activity-log', (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Access Denied' });
  }
  const logs = readData(ACTIVITY_FILE);
  res.json(logs);
});

app.delete('/api/users/:username', (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Access Denied: Only administrators can delete users.' });
  }

  const targetUsername = req.params.username;
  if (req.session.user.username === targetUsername) {
    return res.status(400).json({ success: false, message: 'You cannot delete your own active account.' });
  }

  let users = readData(USERS_FILE);
  const initialLength = users.length;
  users = users.filter(u => u.username !== targetUsername);

  if (users.length === initialLength) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }

  writeData(USERS_FILE, users);
  res.json({ success: true, message: `User ${targetUsername} successfully deleted.` });
});

app.post('/logout', (req, res) => {
  const sessionUser = req.session.user ? req.session.user.username : null;

  if (sessionUser) {
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/Bogota',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    const activityLogs = readData(ACTIVITY_FILE);
    const newLog = {
      username: sessionUser,
      action: 'Clocked Out',
      timestamp: timestamp
    };
    activityLogs.push(newLog);
    writeData(ACTIVITY_FILE, activityLogs);

    io.emit('new-activity', newLog);
  }

  req.session.destroy(() => {
    res.json({ success: true });
  });
});

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

app.get('/api/contacts', (req, res) => {
  const contacts = readData(DATA_FILE);
  res.json(contacts);
});

app.post('/api/contacts', (req, res) => {
  const contacts = readData(DATA_FILE);
  const newContact = {
    id: contacts.length ? contacts[contacts.length - 1].id + 1 : 1,
    consentSent: false,
    ...req.body
  };
  contacts.push(newContact);
  writeData(DATA_FILE, contacts);
  res.json({ success: true, contact: newContact });
});

app.get('/api/download-excel', (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).send('Access Denied: Only administrators can download client records.');
  }

  const requestedLob = req.query.lob || 'ACA Health Care';
  const contacts = readData(DATA_FILE);
  const filteredContacts = contacts.filter(c => (c.lineOfBusiness || 'ACA Health Care') === requestedLob);

  let csv = 'ID,First Name,Last Name,Email,Phone,DOB,Line of Business,Carrier,Level,Premium,Address,Family,More Details,Agent,Consent Sent\n';
  
  filteredContacts.forEach(c => {
    csv += `"${c.id}","${c.firstName || ''}","${c.lastName || ''}","${c.email || ''}","${c.phone || ''}","${c.dob || ''}","${c.lineOfBusiness || ''}","${c.healthPlan || ''}","${c.insuranceLevel || ''}","${c.premium || ''}","${c.address || ''}","${c.family || ''}","${c.moreDetails || ''}","${c.user || ''}","${c.consentSent ? 'Yes' : 'No'}"\n`;
  });

  const fileName = requestedLob === 'Dr. Benson' ? 'dr_benson_records.csv' : 'aca_health_records.csv';
  res.header('Content-Type', 'text/csv');
  res.attachment(fileName);
  res.send(csv);
});

app.post('/api/send-consent', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Please log in.' });
  }

  const { contactId, clientName, clientEmail } = req.body;

  if (!clientEmail || clientEmail === 'client@email.com') {
    return res.status(400).json({ success: false, message: 'Invalid client email address.' });
  }

  const contacts = readData(DATA_FILE);
  const contact = contacts.find(c => c.id == contactId);
  if (contact) {
    contact.consentSent = true;
    writeData(DATA_FILE, contacts);
  }

  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Bogota',
    dateStyle: 'medium',
    timeStyle: 'medium'
  });

  const activityLogs = readData(ACTIVITY_FILE);
  const newLog = {
    username: req.session.user.username,
    action: `Generated & Sent ACA Consent Agreement for ${clientName} (${clientEmail})`,
    timestamp: timestamp
  };
  activityLogs.push(newLog);
  writeData(ACTIVITY_FILE, activityLogs);

  io.emit('new-activity', newLog);

  res.json({ success: true, message: `Consent agreement generated for ${clientName}` });
});

const activeUsers = new Map();
let chatHistory = "Welcome to Office Live Chat!";

io.on('connection', (socket) => {
  socket.emit('chat-history', chatHistory);

  socket.on('register-user', (username) => {
    if (username) {
      activeUsers.set(socket.id, username);
      io.emit('update-active-users', Array.from(new Set(activeUsers.values())));
    }
  });

  socket.on('chat-message', (data) => {
    if (data.recipient && data.recipient !== 'All') {
      for (let [id, user] of activeUsers.entries()) {
        if (user === data.recipient || user === data.sender) {
          io.to(id).emit('chat-message', data);
        }
      }
    } else {
      const formattedMsg = `<b>${data.sender}:</b> ${data.text}`;
      chatHistory += `\n${formattedMsg}`;
      io.emit('chat-message', data);
    }
  });

  socket.on('clear-chat', () => {
    chatHistory = "Welcome to Office Live Chat!";
    io.emit('clear-chat-client');
  });

  socket.on('disconnect', () => {
    activeUsers.delete(socket.id);
    io.emit('update-active-users', Array.from(new Set(activeUsers.values())));
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
