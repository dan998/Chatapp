const socket = io();

// Elements
const contactsBox = document.getElementById('contacts');
const chatBox = document.getElementById('chatBox');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typingIndicator');
const clearSelfChatBtn = document.getElementById('clearSelfChatBtn');

let currentUser = sessionStorage.getItem('username');
if (!currentUser) {
    alert('Please login first');
    window.location.href = 'login.html';
}

let selectedContact = null;
let selectedMessages = new Set();

// ------------------- Load Contacts -------------------
async function loadContacts() {
    const res = await fetch(`/users?exclude=${currentUser}`);
    const data = await res.json();
    contactsBox.innerHTML = '';

    // Add self contact
    const selfDiv = document.createElement('div');
    selfDiv.classList.add('contact');
    selfDiv.dataset.username = currentUser;
    selfDiv.textContent = currentUser; 
    contactsBox.appendChild(selfDiv);

    // Add other users
    data.users.forEach(u => {
        const div = document.createElement('div');
        div.classList.add('contact');
        div.dataset.username = u.username;
        div.textContent = `${u.username} (offline)`;
        contactsBox.appendChild(div);
    });
}
loadContacts();

// ------------------- Join Socket -------------------
socket.emit('join', currentUser);

// ------------------- Update Online Users -------------------
socket.on('updateUsers', users => {
    document.querySelectorAll('#contacts .contact').forEach(div => {
        const name = div.dataset.username;
        if (name === currentUser) {
            div.textContent = currentUser; // self
        } else {
            div.textContent = users.includes(name) ? `${name} (online)` : `${name} (offline)`;
        }
    });
});

// ------------------- Select Contact -------------------
contactsBox.addEventListener('click', e => {
    if(e.target.classList.contains('contact')){
        selectedContact = e.target.dataset.username;
        document.querySelectorAll('#contacts .contact').forEach(c => c.classList.remove('selected'));
        e.target.classList.add('selected');
        typingIndicator.textContent = '';
        selectedMessages.clear();
        loadChat();
    }
});

// ------------------- Load Chat -------------------
async function loadChat(){
    if(!selectedContact) return;
    const res = await fetch(`/chats?user=${currentUser}&with=${selectedContact}`);
    const data = await res.json();
    chatBox.innerHTML = '';
    data.messages.forEach(m => addMessage(m));
}

// ------------------- Add Message -------------------
function addMessage(message){
    const div = document.createElement('div');
    div.classList.add('message', message.from === currentUser ? 'you' : 'them');
    div.dataset.time = message.time;
    div.dataset.from = message.from;
    div.textContent = `${message.from}: ${message.text}`;

    // Context menu for own messages
    if(message.from === currentUser){
        div.addEventListener('contextmenu', e => {
            e.preventDefault();
            showMessageOptions(div, message);
        });
    }

    // Multi-select on click
    div.addEventListener('click', e => {
        if(e.ctrlKey || e.metaKey){
            div.classList.toggle('selected-msg');
            if(div.classList.contains('selected-msg')){
                selectedMessages.add(div.dataset.time);
            } else {
                selectedMessages.delete(div.dataset.time);
            }
        }
    });

    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// ------------------- Message Options -------------------
function showMessageOptions(div, message){
    const menu = document.createElement('div');
    menu.className = 'msg-menu';
    menu.style.top = div.offsetTop + 'px';
    menu.innerHTML = `
        <button id="editBtn">Edit</button>
        <button id="deleteBtn">Delete</button>
    `;
    document.body.appendChild(menu);

    // Edit
    menu.querySelector('#editBtn').addEventListener('click', async () => {
        const newText = prompt("Edit message:", message.text);
        if(newText !== null && newText.trim() !== ''){
            await fetch('/editMessage', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({userRequesting: currentUser, time: message.time, newText})
            });
            div.textContent = `${currentUser}: ${newText}`;
        }
        menu.remove();
    });

    // Delete
    menu.querySelector('#deleteBtn').addEventListener('click', async () => {
        const confirmDelete = confirm("Delete this message?");
        if(confirmDelete){
            await fetch('/deleteMessage', {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({userRequesting: currentUser, time: message.time})
            });
            div.remove();
        }
        menu.remove();
    });

    document.addEventListener('click', ()=>menu.remove(), {once:true});
}

// ------------------- Send Message -------------------
sendBtn.addEventListener('click', async () => {
    const text = msgInput.value.trim();
    if(!text || !selectedContact) return;
    const res = await fetch('/message', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({from:currentUser, to:selectedContact, text})
    });
    const data = await res.json();
    if(data.success){
        addMessage({from: currentUser, text, time: new Date().toISOString()});
        msgInput.value = '';
        socket.emit('typing', {from:currentUser, to:selectedContact, sentence:''});
    }
});

// ------------------- Typing -------------------
msgInput.addEventListener('input', () => {
    if(!selectedContact) return;
    socket.emit('typing',{from:currentUser, to:selectedContact, sentence: msgInput.value});
});

socket.on('typing', ({from, sentence}) => {
    if(selectedContact === from){
        typingIndicator.textContent = sentence.length ? `${from} is typing...` : '';
    }
});

// ------------------- Incoming Messages -------------------
socket.on('newMessage', ({from, text, time})=>{
    if(selectedContact === from || selectedContact === currentUser){
        addMessage({from, text, time});
    }
});

// ------------------- Auto Refresh -------------------
setInterval(()=>{ if(selectedContact) loadChat(); },3000);

// ------------------- Clear Self Chat -------------------
clearSelfChatBtn.addEventListener('click', async () => {
    if(!confirm('Clear all messages to yourself?')) return;
    await fetch('/clearSelfChat', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({user: currentUser})
    });
    loadChat();
});

// ------------------- Bulk Delete Selected -------------------
document.addEventListener('keydown', async (e)=>{
    if((e.key === 'Delete' || e.key === 'Backspace') && selectedMessages.size){
        if(confirm('Delete selected messages?')){
            for(let time of selectedMessages){
                await fetch('/deleteMessage', {
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({userRequesting: currentUser, time})
                });
            }
            selectedMessages.clear();
            loadChat();
        }
    }
});