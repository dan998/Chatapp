const socket = io();

// Elements
const contactsBox = document.getElementById('contacts');
const chatBox = document.getElementById('chatBox');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typingIndicator');

// Current user
let currentUser = sessionStorage.getItem('username');
if (!currentUser) {
    alert('Please login first');
    window.location.href = 'login.html';
}

// Selected contact (null for self-note)
let selectedContact = null;

// ------------------- Load Contacts -------------------
async function loadContacts(){
    const res = await fetch(`/users?exclude=${currentUser}`);
    const data = await res.json();
    contactsBox.innerHTML = '';

    // Self-note
    const selfDiv = document.createElement('div');
    selfDiv.classList.add('contact');
    selfDiv.textContent = 'Self Note';
    selfDiv.dataset.username = currentUser;
    contactsBox.appendChild(selfDiv);

    data.users.forEach(u=>{
        const div = document.createElement('div');
        div.classList.add('contact');
        div.textContent = `${u.username} (offline)`;
        div.dataset.username = u.username;
        contactsBox.appendChild(div);
    });
}
loadContacts();

// ------------------- Join Socket -------------------
socket.emit('join', currentUser);

// Update online users
socket.on('updateUsers', users=>{
    document.querySelectorAll('#contacts .contact').forEach(div=>{
        const name = div.dataset.username;
        if(name===currentUser){
            div.textContent = 'Self Note';
        } else if(users.includes(name)){
            div.textContent = `${name} (online)`;
        } else {
            div.textContent = `${name} (offline)`;
        }
    });
});

// ------------------- Select Contact -------------------
contactsBox.addEventListener('click', e=>{
    if(e.target.classList.contains('contact')){
        selectedContact = e.target.dataset.username;
        typingIndicator.textContent = '';
        loadChat();
    }
});

// ------------------- Load Chat -------------------
async function loadChat(){
    if(!selectedContact) return;
    const res = await fetch(`/chats?user=${currentUser}&with=${selectedContact}`);
    const data = await res.json();
    chatBox.innerHTML = '';
    data.messages.forEach(m=>addMessage(m.from,m.text));
}

// ------------------- Add Message -------------------
function addMessage(user,text){
    if(!text) return;
    const div = document.createElement('div');

    if(user===currentUser && (!selectedContact || selectedContact===currentUser)){
        div.classList.add('message','selfnote');
        div.textContent = text;
    } else {
        div.classList.add('message',user===currentUser?'you':'them');
        div.textContent = `${user}: ${text}`;
    }

    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// ------------------- Send Message -------------------
sendBtn.addEventListener('click', async ()=>{
    const text = msgInput.value.trim();
    if(!text) return;
    const to = selectedContact || currentUser;
    const res = await fetch('/message',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({from:currentUser,to,text})
    });
    const data = await res.json();
    if(data.success){
        addMessage(currentUser,text);
        msgInput.value='';
        socket.emit('typing',{from:currentUser,to,sentence:''}); // stop typing
    }
});

// ------------------- Typing -------------------
msgInput.addEventListener('input', ()=>{
    if(!selectedContact) return;
    socket.emit('typing',{from:currentUser,to:selectedContact,sentence: msgInput.value});
});

socket.on('typing', ({from,sentence})=>{
    if(selectedContact===from && sentence.length>0){
        typingIndicator.textContent = `${from} is typing...`;
    } else if(selectedContact===from){
        typingIndicator.textContent = '';
    }
});

// ------------------- Auto Refresh Chat -------------------
setInterval(()=>{ if(selectedContact) loadChat(); },3000);