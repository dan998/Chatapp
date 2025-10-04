const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const USERS_FILE = path.join(__dirname,'users.json');
const CHATS_FILE = path.join(__dirname,'chats.json');

app.use(express.static(path.join(__dirname,'public')));
app.use(bodyParser.json());

// Helper functions
const loadJSON = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf-8')) : [];
const saveJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// Users API
app.get('/users', (req,res)=>{
  const exclude = req.query.exclude;
  const users = loadJSON(USERS_FILE);
  res.json({ users: exclude ? users.filter(u=>u.username!==exclude) : users });
});

app.post('/register', (req,res)=>{
  const {username,password,phone,securityQuestion,securityAnswer} = req.body;
  if(!username||!password||!phone||!securityQuestion||!securityAnswer)
    return res.json({success:false,message:'Missing fields'});

  const users = loadJSON(USERS_FILE);
  if(users.find(u=>u.username===username))
    return res.json({success:false,message:'Username exists'});

  users.push({username,password,phone,securityQuestion,securityAnswer,createdAt:new Date().toISOString()});
  saveJSON(USERS_FILE, users);
  res.json({success:true,message:'Registered'});
});

app.post('/login', (req,res)=>{
  const {username,password} = req.body;
  const users = loadJSON(USERS_FILE);
  const user = users.find(u=>u.username===username && u.password===password);
  if(!user) return res.json({success:false,message:'Invalid login'});
  res.json({success:true,message:'Login successful'});
});

// Chat API
app.get('/chats', (req,res)=>{
  const {user, with:other} = req.query;
  if(!user||!other) return res.json({messages:[]});
  const chats = loadJSON(CHATS_FILE);
  const convo = chats.filter(c=> (c.from===user && c.to===other) || (c.from===other && c.to===user));
  res.json({messages:convo});
});

app.post('/message', (req,res)=>{
  const {from,to,text} = req.body;
  if(!from||!to||!text) return res.json({success:false,message:'Missing fields'});

  const chats = loadJSON(CHATS_FILE);
  chats.push({from,to,text,time:new Date().toISOString()});
  saveJSON(CHATS_FILE, chats);
  res.json({success:true,message:'Message sent'});
});

// Socket.IO for real-time typing
let typingStatus = {};

io.on('connection', socket => {
  socket.on('typing', ({from,to,sentence})=>{
    if(!typingStatus[from]) typingStatus[from]={};
    typingStatus[from][to] = sentence.trim();
    io.emit('typingStatus', typingStatus);
  });
});

server.listen(PORT, ()=> console.log(`Server running at http://localhost:${PORT}`));
