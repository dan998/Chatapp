const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

// JSON file paths
const USERS_FILE = path.join(__dirname,'users.json');
const CHATS_FILE = path.join(__dirname,'chats.json');

// Serve static files
app.use(express.static(path.join(__dirname,'public')));
app.use(bodyParser.json());

// ------------------ Helper ------------------
function loadJSON(file){
    if(!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file,'utf-8'));
}
function saveJSON(file,data){
    fs.writeFileSync(file,JSON.stringify(data,null,2));
}

// ------------------ Users ------------------
app.get('/users', (req,res)=>{
    const exclude = req.query.exclude;
    const users = loadJSON(USERS_FILE);
    if(exclude) res.json({users: users.filter(u=>u.username!==exclude)});
    else res.json({users});
});

app.post('/register', (req,res)=>{
    const {username,password,phone,securityQuestion,securityAnswer} = req.body;
    if(!username||!password||!phone||!securityQuestion||!securityAnswer)
        return res.json({success:false,message:'Missing fields'});
    const users = loadJSON(USERS_FILE);
    if(users.find(u=>u.username===username)) return res.json({success:false,message:'Username exists'});
    users.push({username,password,phone,securityQuestion,securityAnswer,createdAt:new Date().toISOString()});
    saveJSON(USERS_FILE,users);
    res.json({success:true,message:'Registered'});
});

app.post('/login', (req,res)=>{
    const {username,password} = req.body;
    const users = loadJSON(USERS_FILE);
    const user = users.find(u=>u.username===username && u.password===password);
    if(!user) return res.json({success:false,message:'Invalid login'});
    res.json({success:true,message:'Login successful'});
});

app.post('/resetPassword',(req,res)=>{
    const {username,phone,securityAnswer,newPassword} = req.body;
    if(!username||!phone||!securityAnswer||!newPassword) return res.json({success:false,message:'Missing fields'});
    const users = loadJSON(USERS_FILE);
    const index = users.findIndex(u=>u.username===username);
    if(index===-1) return res.json({success:false,message:'User not found'});
    const user = users[index];
    if((new Date()-new Date(user.createdAt)) > 24*60*60*1000)
        return res.json({success:false,message:'Reset window expired (24h)'});
    if(user.phone!==phone || user.securityAnswer.toLowerCase()!==securityAnswer.toLowerCase())
        return res.json({success:false,message:'Phone or security answer incorrect'});
    users[index].password = newPassword;
    saveJSON(USERS_FILE,users);
    res.json({success:true,message:'Password updated'});
});

// ------------------ Chats ------------------
app.get('/chats',(req,res)=>{
    const {user,with:user2} = req.query;
    if(!user||!user2) return res.json({messages:[]});
    const chats = loadJSON(CHATS_FILE);
    const convo = chats.filter(c=>
        (c.from===user && c.to===user2) || (c.from===user2 && c.to===user)
    );
    res.json({messages:convo});
});

app.post('/message',(req,res)=>{
    const {from,to,text} = req.body;
    if(!from||!to||!text) return res.json({success:false,message:'Missing fields'});
    const chats = loadJSON(CHATS_FILE);
    chats.push({from,to,text,time:new Date().toISOString()});
    saveJSON(CHATS_FILE,chats);
    res.json({success:true,message:'Message sent'});
});

// ------------------ Socket.IO ------------------
let onlineUsers = [];

io.on('connection', socket=>{
    let currentUser = null;

    // Join user and update online list
    socket.on('join', username=>{
        currentUser = username;
        if(!onlineUsers.includes(username)) onlineUsers.push(username);
        io.emit('updateUsers', onlineUsers);
        socket.join(username); // join a personal room
    });

    // Typing events
    socket.on('typing', ({from,to,sentence})=>{
        socket.to(to).emit('typing',{from,sentence});
    });

    // Disconnect
    socket.on('disconnect', ()=>{
        if(currentUser){
            onlineUsers = onlineUsers.filter(u=>u!==currentUser);
            io.emit('updateUsers', onlineUsers);
        }
    });
});

server.listen(PORT,()=>console.log(`Server running at http://localhost:${PORT}`));