// ===== Show password on hold =====
const regPassword = document.getElementById('regPassword');
regPassword.addEventListener('mousedown', () => regPassword.type = 'text');
regPassword.addEventListener('mouseup', () => regPassword.type = 'password');
regPassword.addEventListener('mouseleave', () => regPassword.type = 'password');

// ===== Country code dropdown =====
const countrySelect = document.getElementById('countrySelect');
const phoneInput = document.getElementById('phoneInput');

// Create status div above input
const phoneError = document.createElement('div');
phoneError.style.marginBottom = '5px';
phoneInput.parentNode.insertBefore(phoneError, phoneInput);

// Utility to set status
function setPhoneError(msg, color) {
    phoneError.textContent = msg;
    phoneError.style.color = color;
}

// Load country codes JSON
let countryData = [];
fetch('countries.json')
    .then(res => res.json())
    .then(data => {
        countryData = data;

        // Populate dropdown
        data.forEach(c => {
            const option = document.createElement('option');
            option.value = c.code.replace('+', '');
            option.textContent = `${c.country} (+${c.code.replace('+','')})`;
            countrySelect.appendChild(option);
        });

        if (countrySelect.options.length > 0) {
            countrySelect.selectedIndex = 0;
            countrySelect.dispatchEvent(new Event('change'));
        }
    })
    .catch(err => console.error('Could not load country codes:', err));

// Prepend country code to phone input on selection
countrySelect.addEventListener('change', () => {
    const code = countrySelect.value;
    if (code) {
        phoneInput.value = phoneInput.value.replace(/^\+\d{1,4}\s*/, '');
        phoneInput.value = `+${code} `;
        setPhoneError('', 'red');
    }
});

// ===== Format phone as user types =====
phoneInput.addEventListener('input', () => {
    let value = phoneInput.value.replace(/[^0-9+]/g, '');
    const selectedCode = countrySelect.value;

    if (!value.startsWith(`+${selectedCode}`)) {
        value = `+${selectedCode}${value.replace(/^\+?\d*/, '')}`;
    }

    const numberPart = value.slice(selectedCode.length + 1);
    const country = countryData.find(c => c.code.replace('+','') === selectedCode);

    // Format number with spaces
    let groups = [];
    if (country) {
        const validLengths = Array.isArray(country.phoneLength) ? country.phoneLength : [country.phoneLength];
        const currentLen = numberPart.length;
        const targetLen = validLengths.find(l => l >= currentLen) || validLengths[0];

        if (targetLen <= 5) groups = [targetLen];
        else if (targetLen <= 7) groups = [3, targetLen - 3];
        else if (targetLen <= 9) groups = [3, 3, targetLen - 6];
        else if (targetLen <= 11) groups = [3, 3, 3, targetLen - 9];
        else groups = [3, 3, 3, 3];
    }

    const parts = [];
    let idx = 0;
    for (let g of groups) {
        if (numberPart.length > idx) {
            parts.push(numberPart.slice(idx, idx + g));
            idx += g;
        }
    }
    if (idx < numberPart.length) parts.push(numberPart.slice(idx));
    phoneInput.value = `+${selectedCode} ${parts.join(' ')}`;

    // Live validation
    if (numberPart.length === 0) {
        setPhoneError('', 'red');
    } else if (validatePhone(phoneInput.value, false)) {
        setPhoneError('Valid phone number', 'green');
    } else {
        setPhoneError('Invalid phone number', 'red');
    }
});

// ===== Validate phone number =====
function validatePhone(phone, showError = true) {
    const cleaned = phone.replace(/[^0-9+]/g, '');
    const match = cleaned.match(/^\+([0-9]{1,4})(\d+)$/);

    if (!match) {
        if (showError) setPhoneError('Invalid phone format', 'red');
        return false;
    }

    const code = match[1];
    const numberPart = match[2];
    const country = countryData.find(c => c.code.replace('+','') === code);

    if (!country) {
        if (showError) setPhoneError('Unknown or invalid country code', 'red');
        return false;
    }

    const validLengths = Array.isArray(country.phoneLength) ? country.phoneLength : [country.phoneLength];
    if (!validLengths.includes(numberPart.length)) {
        if (showError) setPhoneError('Incomplete number', 'red');
        return false;
    }

    // Check network prefix
    if (country.networks && country.networks.length > 0) {
        const prefixValid = country.networks.some(net =>
            net.prefixes.some(prefix => numberPart.startsWith(prefix))
        );
        if (!prefixValid) {
            if (showError) setPhoneError('Invalid network prefix', 'red');
            return false;
        }
    }

    if (showError) setPhoneError('Valid phone number', 'green');
    return true;
}

// ===== Utility: POST request =====
const post = async (url, data) => {
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await r.json();
    } catch (err) {
        console.error('Server error:', err);
        return { success: false, message: 'Server error' };
    }
};

// ===== Form submission =====
document.getElementById('registerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;

    if (!validatePhone(f.phone.value.trim(), true)) return;

    const payload = {
        username: f.username.value.trim(),
        password: f.password.value,
        phone: f.phone.value.trim(),
        securityQuestion: f.securityQuestion.value.trim(),
        securityAnswer: f.securityAnswer.value.trim()
    };

    const res = await post('/register', payload);
    if (!res.success) {
        setPhoneError(res.message, 'red');
    } else {
        window.location.href = 'login.html';
    }
});