document.addEventListener('DOMContentLoaded', () => {

  // ==================== Login Page ====================
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    const loginPassword = document.getElementById('loginPassword');

    // Show password on focus, hide on blur
    if (loginPassword) {
      loginPassword.addEventListener('focus', () => loginPassword.type = 'text');
      loginPassword.addEventListener('blur', () => loginPassword.type = 'password');
    }

    // Handle login submit
    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;

      try {
        // Detect IP & location automatically
        const ipRes = await fetch('https://api.ipify.org?format=json');
        const { ip } = await ipRes.json();
        const geoRes = await fetch(`http://ip-api.com/json/${ip}`);
        const geo = await geoRes.json();

        const res = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: f.username.value.trim(),
            password: f.password.value,
            lat: geo.lat,
            lon: geo.lon
          })
        }).then(r => r.json());

        if (res.success) {
          sessionStorage.setItem('username', f.username.value.trim());
          sessionStorage.setItem('ip', res.ip);
          sessionStorage.setItem('geo', JSON.stringify(res.geo));
          window.location.href = 'chat.html';
        } else {
          document.getElementById('errorMsg').textContent = res.message;
        }

      } catch (err) {
        console.error("Login error:", err);
        alert("Login failed. Try again.");
      }
    });
  }

  // ==================== Register Page ====================
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    const regPassword = document.getElementById('regPassword');

    // Show password on focus, hide on blur
    if (regPassword) {
      regPassword.addEventListener('focus', () => regPassword.type = 'text');
      regPassword.addEventListener('blur', () => regPassword.type = 'password');
    }

    // Handle registration submit
    registerForm.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;

      const res = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: f.username.value.trim(),
          password: f.password.value,
          phone: f.phone.value.trim(),
          securityQuestion: f.securityQuestion.value.trim(),
          securityAnswer: f.securityAnswer.value.trim()
        })
      }).then(r => r.json());

      alert(res.message);
      if (res.success) window.location.href = 'login.html';
    });
  }

  // ==================== Forgot Password Page ====================
  const forgotForm = document.getElementById('forgotForm');
  if (forgotForm) {
    const forgotPassword = document.getElementById('newPassword');

    if (forgotPassword) {
      forgotPassword.addEventListener('focus', () => forgotPassword.type = 'text');
      forgotPassword.addEventListener('blur', () => forgotPassword.type = 'password');
    }

    forgotForm.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;

      const res = await fetch('/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: f.username.value.trim(),
          securityAnswer: f.securityAnswer.value.trim(),
          newPassword: f.newPassword.value
        })
      }).then(r => r.json());

      const errorMsg = document.getElementById('errorMsg');
      if (res.success) {
        alert(res.message);
        window.location.href = 'login.html';
      } else {
        if (errorMsg) errorMsg.textContent = res.message;
        else alert(res.message);
      }
    });
  }

  // ==================== Chat Page ====================
  const chatBox = document.getElementById('chatBox');
  const chatForm = document.getElementById('chatForm');
  const messageInput = document.getElementById('messageInput');
  const userList = document.getElementById('userList');

  if (chatForm && chatBox) {
    const username = sessionStorage.getItem('username');
    if (!username) window.location.href = 'login.html';

    const socket = io();
    socket.emit('join', username);

    socket.on('updateUsers', users => {
      userList.innerHTML = '';
      users.forEach(u => {
        if (u !== username) {
          const li = document.createElement('li');
          li.textContent = u;
          li.dataset.user = u;
          userList.appendChild(li);
        }
      });
    });

    socket.on('newMessage', data => appendMessage(data.from, data.text, data.time));

    socket.on('typing', ({ from, sentence }) => {
      const typingEl = document.getElementById('typing');
      typingEl.textContent = `${from} is typing...`;
      setTimeout(() => { typingEl.textContent = ''; }, 1500);
    });

    chatForm.addEventListener('submit', async e => {
      e.preventDefault();
      const to = userList.querySelector('li.selected')?.dataset.user;
      const text = messageInput.value.trim();
      if (!to || !text) return;

      await fetch('/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: username, to, text })
      });

      appendMessage(username, text, new Date().toISOString());
      messageInput.value = '';
      socket.emit('typing', { from: username, to, sentence: text });
    });

    userList.addEventListener('click', e => {
      if (e.target.tagName === 'LI') {
        userList.querySelectorAll('li').forEach(li => li.classList.remove('selected'));
        e.target.classList.add('selected');
        loadChat(username, e.target.dataset.user);
      }
    });

    function appendMessage(from, text, time) {
      const div = document.createElement('div');
      div.classList.add('message');
      div.innerHTML = `<strong>${from}:</strong> ${text} <span class="time">${new Date(time).toLocaleTimeString()}</span>`;
      chatBox.appendChild(div);
      chatBox.scrollTop = chatBox.scrollHeight;
    }

    async function loadChat(user1, user2) {
      const res = await fetch(`/chats?user=${user1}&with=${user2}`);
      const data = await res.json();
      chatBox.innerHTML = '';
      data.messages.forEach(m => appendMessage(m.from, m.text, m.time));
    }
  }

});