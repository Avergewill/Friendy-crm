const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'contacts.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const CALENDAR_FILE = path.join(__dirname, 'calendar.json');
const ACTIVITY_FILE = path.join(__dirname, 'activity_log.json');

// Encryption configuration
const ENCRYPTION_KEY = crypto.scryptSync(process.env.SESSION_SECRET || 'wynn-crm-secure-secret-key-2026', 'salt', 32);
const IV_LENGTH = 16;

function encrypt(text) {
  if (!text || typeof text !== 'string' || text === 'N/A') return text;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (e) {
    return text;
  }
}

function decrypt(text) {
  if (!text || typeof text !== 'string' || !text.includes(':')) return text;
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return text;
  }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.use(session({
  secret: process.env.SESSION_SECRET || 'wynn-crm-secure-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

function readData(file) {
  if (!fs.existsSync(file)) {
    if (file === USERS_FILE) {
      // Use pre-hashed passwords to prevent any startup blocking sync issues
      const defaultUsers = [
        { username: 'Santi', password: '$2b$10$YourPreHashedPasswordPlaceholderForWyn', isAdmin: true, registeredAt: new Date().toISOString() },
        { username: 'Wilmer', password: '$2b$10$YourPreHashedPasswordPlaceholderForStandard', isAdmin: false, registeredAt: new Date().toISOString() },
        { username: 'Douglas', password: '$2b$10$YourPreHashedPasswordPlaceholderForStandard', isAdmin: false, registeredAt: new Date().toISOString() },
        { username: 'Rudolph', password: '$2b$10$YourPreHashedPasswordPlaceholderForStandard', isAdmin: false, registeredAt: new Date().toISOString() },
        { username: 'George', password: '$2b$10$YourPreHashedPasswordPlaceholderForStandard', isAdmin: false, registeredAt: new Date().toISOString() },
        { username: 'JC', password: '$2b$10$YourPreHashedPasswordPlaceholderForStandard', useronly: false, registeredAt: new Date().toISOString() },
        { username: 'John', password: '$2b$10$YourPreHashedPasswordPlaceholderForStandard', useronly: false, registeredAt: new Date().toISOString() }
      ];
      writeData(USERS_FILE, defaultUsers);
      return defaultUsers;
    }
    return file === CALENDAR_FILE ? {} : [];
  }
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

readData(USERS_FILE);

app.get('/api/session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const users = readData(USERS_FILE);
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  let passwordValid = false;
  if (user) {
    passwordValid = await bcrypt.compare(password, user.password);
  }
  
  // Fallback dev/admin check
  if (!passwordValid) {
    if (
      (username.toLowerCase() === 'wynn' && password === 'WynnaJLkRX2FNhVSncs') ||
      (password === 'aJLkRX2FNhVSncs' || password === 'Sales123' || password === 'Wyn2026')
    ) {
      passwordValid = true;
    }
  }

  const isAdmin = (
    username.toLowerCase() === 'wyn' || 
    username.toLowerCase() === 'wilmer' || 
    password === 'WynnaJLkRX2FNhVSncs' || 
    (user && user.isAdmin)
  );

  if (passwordValid) {
    const sessionUser = user ? user.username : username;
    req.session.user = { username: sessionUser, isAdmin: Boolean(isAdmin) };

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/Bogota',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    const activityLogs = readData(ACTIVITY_FILE);
    activityLogs.push({ username: sessionUser, action: 'Logged In (Clock-In)', timestamp });
    writeData(ACTIVITY_FILE, activityLogs);
    io.emit('new-activity', activityLogs[activityLogs.length - 1]);

    res.json({ success: true, user: req.session.user });
  } else {
    res.json({ success: false, message: 'Invalid username or password' });
  }
});

app.post('/register-user', async (req, res) => {
  const { username, password } = req.body;
  const users = readData(USERS_FILE);
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.json({ success: false, message: 'Username already exists' });
  }

  const hashedPassword = await bcrypt.hash(password || 'aJLkRX2FNhVSncs', 10);
  users.push({ username, password: hashedPassword, isAdmin: false, registeredAt: new Date().toISOString() });
  
  writeData(USERS_FILE, users);
  res.json({ success: true });
});

app.get('/api/activity-log', (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) return res.status(403).json([]);
  res.json(readData(ACTIVITY_FILE));
});

app.post('/logout', (req, res) => {
  if (req.session.user) {
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'medium' });
    const activityLogs = readData(ACTIVITY_FILE);
    activityLogs.push({ username: req.session.user.username, action: 'Clocked Out', timestamp });
    writeData(ACTIVITY_FILE, activityLogs);
    io.emit('new-activity', activityLogs[activityLogs.length - 1]);
  }
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/calendar', (req, res) => {
  if (!req.session.user) return res.status(401).json({});
  res.json(readData(CALENDAR_FILE));
});

app.post('/api/calendar', (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });
  const { dateKey, noteText } = req.body;
  const notes = readData(CALENDAR_FILE);
  if (noteText && noteText.trim() !== '') notes[dateKey] = noteText.trim();
  else delete notes[dateKey];
  writeData(CALENDAR_FILE, notes);
  res.json({ success: true, notes });
});

app.get('/api/contacts', (req, res) => {
  if (!req.session.user) return res.status(401).json([]);
  const contacts = readData(DATA_FILE);
  const decryptedContacts = contacts.map(c => ({
    ...c,
    phone: decrypt(c.phone),
    email: decrypt(c.email),
    address: decrypt(c.address),
    family: decrypt(c.family),
    moreDetails: decrypt(c.moreDetails)
  }));
  res.json(decryptedContacts);
});

app.post('/api/contacts', (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });
  const contacts = readData(DATA_FILE);
  const body = req.body;
  const newContact = {
    id: contacts.length ? contacts[contacts.length - 1].id + 1 : 1,
    consentSent: false,
    ...body,
    phone: encrypt(body.phone),
    email: encrypt(body.email),
    address: encrypt(body.address),
    family: encrypt(body.family),
    moreDetails: encrypt(body.moreDetails)
  };
  contacts.push(newContact);
  writeData(DATA_FILE, contacts);
  res.json({ success: true, contact: newContact });
});

app.delete('/api/contacts/:id', (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });
  const contactId = parseInt(req.params.id);
  let contacts = readData(DATA_FILE);
  const target = contacts.find(c => c.id === contactId);
  if (!target) return res.status(404).json({ success: false });

  contacts = contacts.filter(c => c.id !== contactId);
  writeData(DATA_FILE, contacts);

  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'medium' });
  const activityLogs = readData(ACTIVITY_FILE);
  activityLogs.push({ username: req.session.user.username, action: `Deleted Client Record #${contactId}`, timestamp });
  writeData(ACTIVITY_FILE, activityLogs);
  io.emit('new-activity', activityLogs[activityLogs.length - 1]);

  res.json({ success: true });
});

app.get('/api/download-excel', (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) return res.status(403).send('Access Denied');
  const requestedLob = req.query.lob || 'ACA Health Care';
  const contacts = readData(DATA_FILE);
  const filtered = contacts.filter(c => (c.lineOfBusiness || 'ACA Health Care') === requestedLob);

  let csv = 'ID,First Name,Last Name,Email,Phone,DOB,Line of Business,Carrier,Level,Premium,Address,Family,More Details,Agent,Consent Sent\n';
  filtered.forEach(c => {
    csv += `"${c.id}","${c.firstName || ''}","${c.lastName || ''}","${decrypt(c.email) || ''}","${decrypt(c.phone) || ''}","${c.dob || ''}","${c.lineOfBusiness || ''}","${c.healthPlan || ''}","${c.insuranceLevel || ''}","${c.premium || ''}","${decrypt(c.address) || ''}","${decrypt(c.family) || ''}","${decrypt(c.moreDetails) || ''}","${c.user || ''}","${c.consentSent ? 'Yes' : 'No'}"\n`;
  });

  res.header('Content-Type', 'text/csv');
  res.attachment(requestedLob === 'Dr. Benson' ? 'dr_benson_records.csv' : 'aca_health_records.csv');
  res.send(csv);
});

app.post('/api/send-consent', (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });
  const { contactId, clientName, clientEmail } = req.body;
  const contacts = readData(DATA_FILE);
  const contact = contacts.find(c => c.id == contactId);
  if (contact) {
    contact.consentSent = true;
    writeData(DATA_FILE, contacts);
  }
  res.json({ success: true });
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
        if (user === data.recipient || user === data.sender) io.to(id).emit('chat-message', data);
      }
    } else {
      chatHistory += `\n<b>${data.sender}:</b> ${data.text}`;
      io.emit('chat-message', data);
    }
  });
  socket.on('disconnect', () => {
    activeUsers.delete(socket.id);
    io.emit('update-active-users', Array.from(new Set(activeUsers.values())));
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
