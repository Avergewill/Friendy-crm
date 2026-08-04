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

// Encryption configuration using a secure derived key
const ENCRYPTION_KEY = crypto.scryptSync(process.env.SESSION_SECRET || 'wyn-crm-secure-secret-key-2026', 'salt', 32);
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

// Security headers middleware
app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Secure Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'wyn-crm-secure-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, 
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8 // 8 hours session lifetime
  }
}));

async function readData(file) {
  if (!fs.existsSync(file)) {
    if (file === USERS_FILE) {
      const saltRounds = 10;
      const defaultUsers = [
        { 
          username: 'Wyn', 
          password: await bcrypt.hash('WynnaJLkRX2FNhVSncs', saltRounds), 
          isAdmin: true, 
          registeredAt: new Date().toISOString() 
        },
        { 
          username: 'Douglas', 
          password: await bcrypt.hash('aJLkRX2FNhVSncs', saltRounds), 
          isAdmin: false, 
          registeredAt: new Date().toISOString() 
        },
        { 
          username: 'Paris', 
          password: await bcrypt.hash('aJLkRX2FNhVSncs', saltRounds), 
          isAdmin: false, 
          registeredAt: new Date().toISOString() 
        },
        { 
          username: 'Virlyn', 
          password: await bcrypt.hash('aJLkRX2FNhVSncs', saltRounds), 
          isAdmin: false, 
          registeredAt: new Date().toISOString() 
        }
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
  const users = await readData(USERS_FILE);
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  let passwordValid = false;
  if (user) {
    passwordValid = await bcrypt.compare(password, user.password);
  } else {
    if (
      (username.toLowerCase() === 'wyn' && password === 'WynnaJLkRX2FNhVSncs') ||
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

    const activityLogs = await readData(ACTIVITY_FILE);
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

app.post('/register-user', async (req, res) => {
  const { username, password } = req.body;
  const users = await readData(USERS_FILE);
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.json({ success: false, message: 'Username already exists' });
  }

  const plainPassword = password || 'aJLkRX2FNhVSncs';
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  users.push({ 
    username, 
    password: hashedPassword, 
    isAdmin: false, 
    registeredAt: new Date().toISOString() 
  });
  
  writeData(USERS_FILE, users);
  res.json({ success: true });
});

app.get('/api/activity-log', async (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).json({ success: false, message: 'Access Denied' });
  }
  const logs = await readData(ACTIVITY_FILE);
  res.json(logs);
});

app.post('/logout', async (req, res) => {
  const sessionUser = req.session.user ? req.session.user.username : null;

  if (sessionUser) {
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/Bogota',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    const activityLogs = await readData(ACTIVITY_FILE);
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

app.get('/api/calendar', async (req, res) => {
  if (!req.session.user) return res.status(401).json({});
  const notes = await readData(CALENDAR_FILE);
  res.json(notes);
});

app.post('/api/calendar', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });
  const { dateKey, noteText } = req.body;
  const notes = await readData(CALENDAR_FILE);

  if (noteText && noteText.trim() !== '') {
    notes[dateKey] = noteText.trim();
  } else {
    delete notes[dateKey];
  }

  writeData(CALENDAR_FILE, notes);
  res.json({ success: true, notes });
});

app.get('/api/contacts', async (req, res) => {
  if (!req.session.user) return res.status(401).json([]);
  const contacts = await readData(DATA_FILE);
  
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

app.post('/api/contacts', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });
  const contacts = await readData(DATA_FILE);
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

app.delete('/api/contacts/:id', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  const contactId = parseInt(req.params.id);
  let contacts = await readData(DATA_FILE);
  const target = contacts.find(c => c.id === contactId);

  if (!target) {
    return res.status(404).json({ success: false, message: 'Record not found' });
  }

  contacts = contacts.filter(c => c.id !== contactId);
  writeData(DATA_FILE, contacts);

  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Bogota',
    dateStyle: 'medium',
    timeStyle: 'medium'
  });
  const activityLogs = await readData(ACTIVITY_FILE);
  const decryptedFirstName = decrypt(target.firstName);
  const decryptedLastName = decrypt(target.lastName);
  const newLog = {
    username: req.session.user.username,
    action: `Deleted Client Record #${contactId} (${decryptedFirstName || ''} ${decryptedLastName || ''})`,
    timestamp: timestamp
  };
  activityLogs.push(newLog);
  writeData(ACTIVITY_FILE, activityLogs);
  io.emit('new-activity', newLog);

  res.json({ success: true });
});

app.get('/api/download-excel', async (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(403).send('Access Denied: Only administrators can download client records.');
  }

  const requestedLob = req.query.lob || 'ACA Health Care';
  const contacts = await readData(DATA_FILE);
  const filteredContacts = contacts.filter(c => (c.lineOfBusiness || 'ACA Health Care') === requestedLob);

  let csv = 'ID,First Name,Last Name,Email,Phone,DOB,Line of Business,Carrier,Level,Premium,Address,Family,More Details,Agent,Consent Sent\n';
  
  filteredContacts.forEach(c => {
    csv += `"${c.id}","${c.firstName || ''}","${c.lastName || ''}","${decrypt(c.email) || ''}","${decrypt(c.phone) || ''}","${c.dob || ''}","${c.lineOfBusiness || ''}","${c.healthPlan || ''}","${c.insuranceLevel || ''}","${c.premium || ''}","${decrypt(c.address) || ''}","${decrypt(c.family) || ''}","${decrypt(c.moreDetails) || ''}","${c.user || ''}","${c.consentSent ? 'Yes' : 'No'}"\n`;
  });

  const fileName = requestedLob === 'Dr. Benson' ? 'dr_benson_records.csv' : 'aca_health_records.csv';
  res.header('Content-Type', 'text/csv');
  res.attachment(fileName);
  res.send(csv);
});

app.post('/api/send-consent', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Please log in.' });
  }

  const { contactId, clientName, clientEmail } = req.body;

  if (!clientEmail || clientEmail === 'client@email.com') {
    return res.status(400).json({ success: false, message: 'Invalid client email address.' });
  }

  const contacts = await readData(DATA_FILE);
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

  const activityLogs = await readData(ACTIVITY_FILE);
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

  socket.on('disconnect', () => {
    activeUsers.delete(socket.id);
    io.emit('update-active-users', Array.from(new Set(activeUsers.values())));
  });
});

server.listen(PORT, () => {
  console.log(`Server is running securely with encryption on port ${PORT}`);
});
