// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Node 18+ has fetch; fallback for older versions
const fetch = global.fetch || ((...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args)));

const USERS_FILE = path.join(__dirname, 'users.json');
const CHATS_FILE = path.join(__dirname, 'chats.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

// ----------------- Helpers -----------------
function ensureFile(file, defaultValue) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
  }
}
ensureFile(USERS_FILE, []);
ensureFile(CHATS_FILE, []);

// load/save
function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return [];
  }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// client ip
function getClientIp(req) {
  // If behind proxy, x-forwarded-for may contain comma-separated list
  const h = req.headers['x-forwarded-for'];
  if (h) return h.split(',')[0].trim();
  // req.socket.remoteAddress may be like ::ffff:127.0.0.1
  return req.socket?.remoteAddress?.replace('::ffff:', '') || 'unknown';
}

// fetch geo/isp using ip-api.com (no key, free tier)
async function getClientInfoFromIp(ip) {
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,query,country,regionName,city,zip,isp,org,as`);
    const j = await res.json();
    if (j.status !== 'success') return { ip, error: j.message || 'lookup failed' };
    return {
      ip: j.query,
      country: j.country,
      region: j.regionName,
      city: j.city,
      zip: j.zip,
      isp: j.isp,
      org: j.org,
      as: j.as
    };
  } catch (err) {
    return { ip, error: 'lookup failed' };
  }
}

// convenience: get client info from express req-like object (works with socket fake req too)
async function getClientInfo(reqLike) {
  const ip = getClientIp(reqLike);
  return await getClientInfoFromIp(ip);
}

// ----------------- Routes -----------------

// Get all users (optionally exclude one)
app.get('/users', (req, res) => {
  const users = loadJSON(USERS_FILE);
  const exclude = req.query.exclude;
  const filtered = exclude ? users.filter(u => u.username !== exclude) : users;
  // return minimal user info (no password)
  const out = filtered.map(u => ({ username: u.username, lastLogin: u.lastLogin || null }));
  res.json({ users: out });
});

// Register
app.post('/register', async (req, res) => {
  const { username, password, phone, securityQuestion, securityAnswer } = req.body || {};
  if (!username || !password || !phone || !securityQuestion || !securityAnswer) {
    return res.json({ success: false, message: 'Missing fields' });
  }

  const users = loadJSON(USERS_FILE);
  if (users.find(u => u.username === username)) return res.json({ success: false, message: 'Username exists' });

  const clientInfo = await getClientInfo(req);
  const newUser = {
    username,
    password,
    phone,
    securityQuestion,
    securityAnswer,
    createdAt: new Date().toISOString(),
    registeredFrom: clientInfo,
    lastLogin: null
  };
  users.push(newUser);
  saveJSON(USERS_FILE, users);
  res.json({ success: true, message: 'Registered successfully', clientInfo });
});

// Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.json({ success: false, message: 'Missing fields' });

  const users = loadJSON(USERS_FILE);
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.json({ success: false, message: 'Invalid login' });

  const clientInfo = await getClientInfo(req);
  user.lastLogin = { time: new Date().toISOString(), ...clientInfo };
  saveJSON(USERS_FILE, users);

  // Do not return password to client
  const safeUser = { username: user.username, phone: user.phone, lastLogin: user.lastLogin };
  res.json({ success: true, message: 'Login successful', user: safeUser });
});

// Forgot password (security question)
app.post('/forgotPassword', (req, res) => {
  const { username, securityAnswer, newPassword } = req.body || {};
  if (!username || !securityAnswer || !newPassword) return res.json({ success: false, message: 'Missing fields' });

  const users = loadJSON(USERS_FILE);
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return res.json({ success: false, message: 'User not found' });

  const user = users[idx];
  if ((user.securityAnswer || '').toLowerCase().trim() !== (securityAnswer || '').toLowerCase().trim()) {
    return res.json({ success: false, message: 'Security answer incorrect' });
  }

  users[idx].password = newPassword;
  saveJSON(USERS_FILE, users);
  res.json({ success: true, message: 'Password updated, you can now login' });
});

// Get chat messages between two users
app.get('/chats', (req, res) => {
  const u1 = req.query.user;
  const u2 = req.query.with;
  if (!u1 || !u2) return res.json({ messages: [] });

  const chats = loadJSON(CHATS_FILE);
  const convo = chats.filter(c =>
    (c.from === u1 && c.to === u2) ||
    (c.from === u2 && c.to === u1)
  );
  convo.sort((a, b) => new Date(a.time) - new Date(b.time));
  res.json({ messages: convo });
});

// Send a single chat message
app.post('/message', (req, res) => {
  const { from, to, text } = req.body || {};
  if (!from || !to || !text) return res.json({ success: false, message: 'Missing fields' });

  const chats = loadJSON(CHATS_FILE);
  const msg = { from, to, text, time: new Date().toISOString() };
  chats.push(msg);
  saveJSON(CHATS_FILE, chats);

  // Emit to both sender and recipient rooms
  io.to(to).emit('newMessage', msg);
  io.to(from).emit('newMessage', msg);

  res.json({ success: true, message: 'Message saved' });
});

// Bulk delete messages (times array)
app.post('/deleteMessages', (req, res) => {
  const { from, times, to, userRequesting } = req.body || {};
  // from: owner of messages (usually currentUser), times: array of time strings, to: chat partner
  if (!Array.isArray(times) || !from) return res.json({ success: false, message: 'Missing fields' });

  let chats = loadJSON(CHATS_FILE);
  const timesSet = new Set(times);

  chats = chats.filter(m => {
    if (!timesSet.has(m.time)) return true; // keep
    // if requested message is self-chat or message.from === userRequesting then allow deletion
    if (m.from === userRequesting && m.from === m.to) return false; // self-chat delete always
    if (m.from === userRequesting) return false; // owner deleting own message (subject to other rules if you want)
    // otherwise skip deletion (keep message)
    return true;
  });

  saveJSON(CHATS_FILE, chats);
  // broadcast deletions to participants
  times.forEach(t => {
    io.emit('messageDeleted', t);
  });

  res.json({ success: true });
});

// Edit message (single)
app.post('/editMessage', (req, res) => {
  const { time, newText, userRequesting } = req.body || {};
  if (!time || typeof newText !== 'string' || !userRequesting) return res.json({ success: false, message: 'Missing fields' });

  const chats = loadJSON(CHATS_FILE);
  const idx = chats.findIndex(m => m.time === time);
  if (idx === -1) return res.json({ success: false, message: 'Message not found' });

  const msg = chats[idx];
  const now = Date.now();
  const msgTime = new Date(msg.time).getTime();
  const diffMs = now - msgTime;

  // self-chat: allow anytime
  if (msg.from === userRequesting && msg.from === msg.to) {
    msg.text = newText;
    msg.edited = true;
    saveJSON(CHATS_FILE, chats);
    io.to(msg.from).emit('messageEdited', msg);
    return res.json({ success: true });
  }

  // other messages: only if requester is sender and within 10 minutes
  if (msg.from !== userRequesting) return res.json({ success: false, message: 'Can only edit your own messages' });
  const TEN_MIN = 10 * 60 * 1000;
  if (diffMs > TEN_MIN) return res.json({ success: false, message: 'Edit time expired' });

  msg.text = newText;
  msg.edited = true;
  saveJSON(CHATS_FILE, chats);
  io.to(msg.from).emit('messageEdited', msg);
  io.to(msg.to).emit('messageEdited', msg);
  return res.json({ success: true });
});

// Delete single message (by time)
app.post('/deleteMessage', (req, res) => {
  const { time, userRequesting } = req.body || {};
  if (!time || !userRequesting) return res.json({ success: false, message: 'Missing fields' });

  let chats = loadJSON(CHATS_FILE);
  const idx = chats.findIndex(m => m.time === time);
  if (idx === -1) return res.json({ success: false, message: 'Message not found' });

  const msg = chats[idx];
  const now = Date.now();
  const msgTime = new Date(msg.time).getTime();
  const diffMs = now - msgTime;

  // self-chat: allow anytime
  if (msg.from === userRequesting && msg.from === msg.to) {
    chats.splice(idx, 1);
    saveJSON(CHATS_FILE, chats);
    io.to(msg.from).emit('messageDeleted', msg.time);
    return res.json({ success: true });
  }

  // other messages: only if requester is sender and within 10 minutes
  if (msg.from !== userRequesting) return res.json({ success: false, message: 'Can only delete your own messages' });
  const TEN_MIN = 10 * 60 * 1000;
  if (diffMs > TEN_MIN) return res.json({ success: false, message: 'Delete time expired' });

  chats.splice(idx, 1);
  saveJSON(CHATS_FILE, chats);
  io.to(msg.from).emit('messageDeleted', msg.time);
  io.to(msg.to).emit('messageDeleted', msg.time);
  return res.json({ success: true });
});

// Clear self-chat
app.post('/clearSelfChat', (req, res) => {
  const { user } = req.body || {};
  if (!user) return res.json({ success: false, message: 'Missing user' });
  let chats = loadJSON(CHATS_FILE);
  chats = chats.filter(m => !(m.from === user && m.to === user));
  saveJSON(CHATS_FILE, chats);
  io.to(user).emit('selfChatCleared');
  res.json({ success: true });
});

// ----------------- Socket.IO -----------------
let onlineUsers = [];

io.on('connection', async socket => {
  // capture IP/geo for this socket (best-effort)
  try {
    const fakeReq = { headers: socket.handshake.headers, socket: { remoteAddress: socket.handshake.address } };
    const info = await getClientInfo(fakeReq);
    // note: do not store global sensitive info here; we're just logging
    console.log('Socket connected, client info:', info);
  } catch (e) {
    // ignore
  }

  let currentUser = null;

  socket.on('join', username => {
    currentUser = username;
    if (!onlineUsers.includes(username)) onlineUsers.push(username);
    socket.join(username);
    io.emit('updateUsers', onlineUsers);
  });

  socket.on('typing', ({ from, to, sentence }) => {
    // forward typing to the recipient only
    socket.to(to).emit('typing', { from, sentence });
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      onlineUsers = onlineUsers.filter(u => u !== currentUser);
      io.emit('updateUsers', onlineUsers);
    }
  });
});

// ----------------- Start server -----------------
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));