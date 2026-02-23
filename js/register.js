// ============ PIX PURCHASE LOGIC ============

(function() {
    let pixPollingInterval = null;
    let pixTimerInterval = null;
    let pixCurrentTxid = null;

    async function initPixSection() {
        try {
            const res = await fetch('/api/pix/config');
            const data = await res.json();
            if (!data.enabled) return;

            const section = document.getElementById('pixSection');
            const priceEl = document.getElementById('pixPrice');
            if (!section || !priceEl) return;

            priceEl.textContent = data.price;
            section.classList.add('visible');

            // Toggle collapse
            const toggle = document.getElementById('pixToggle');
            const body = document.getElementById('pixBody');
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('open');
                body.classList.toggle('open');
            });
            toggle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle.click();
                }
            });

            // Generate button
            document.getElementById('pixGenerateBtn').addEventListener('click', createPixCharge);

            // Copy button
            document.getElementById('pixCopyBtn').addEventListener('click', copyPixPayload);
        } catch (err) {
            // PIX not available, silently ignore
        }
    }

    async function createPixCharge() {
        const btn = document.getElementById('pixGenerateBtn');
        const qrArea = document.getElementById('pixQrArea');
        const successEl = document.getElementById('pixSuccess');
        const expiredEl = document.getElementById('pixExpired');
        const statusEl = document.getElementById('pixStatus');

        // Reset state
        clearPixIntervals();
        qrArea.classList.remove('visible');
        successEl.classList.remove('visible');
        expiredEl.classList.remove('visible');
        statusEl.style.display = 'flex';

        btn.disabled = true;
        btn.textContent = 'Creating charge...';

        try {
            const res = await fetch('/api/pix/create-charge', { method: 'POST' });
            const data = await res.json();

            if (!res.ok) {
                btn.disabled = false;
                btn.textContent = 'Generate PIX Payment';
                alert(data.message || 'Failed to create PIX charge');
                return;
            }

            pixCurrentTxid = data.txid;

            // Show QR code
            document.getElementById('pixQrImage').src = 'data:image/png;base64,' + data.qrcode;
            document.getElementById('pixPayload').value = data.payload;
            qrArea.classList.add('visible');

            // Start polling
            startPixPolling(data.txid);

            // Start timer
            startPixTimer(data.expiresInSeconds);

            btn.textContent = 'Generate PIX Payment';
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Generate PIX Payment';
            alert('Failed to create PIX charge. Please try again.');
        }
    }

    function startPixPolling(txid) {
        pixPollingInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/pix/status/' + txid);
                const data = await res.json();

                if (data.status === 'CONCLUIDA' && data.inviteCode) {
                    clearPixIntervals();
                    onPixPaymentConfirmed(data.inviteCode);
                }
            } catch (err) {
                // Silently retry on next interval
            }
        }, 5000);
    }

    function startPixTimer(seconds) {
        const timerEl = document.getElementById('pixTimer');
        let remaining = seconds;

        function updateTimer() {
            const min = Math.floor(remaining / 60);
            const sec = remaining % 60;
            timerEl.textContent = 'Expires in ' + min + ':' + (sec < 10 ? '0' : '') + sec;
        }

        updateTimer();
        pixTimerInterval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearPixIntervals();
                timerEl.textContent = '';
                onPixExpired();
                return;
            }
            updateTimer();
        }, 1000);
    }

    function onPixPaymentConfirmed(inviteCode) {
        const qrArea = document.getElementById('pixQrArea');
        const successEl = document.getElementById('pixSuccess');
        const btn = document.getElementById('pixGenerateBtn');
        const statusEl = document.getElementById('pixStatus');
        const timerEl = document.getElementById('pixTimer');

        statusEl.style.display = 'none';
        timerEl.textContent = '';
        qrArea.classList.remove('visible');
        successEl.classList.add('visible');
        btn.disabled = true;

        // Auto-fill invite code
        const inviteInput = document.getElementById('inviteCode');
        if (inviteInput) {
            inviteInput.value = inviteCode;
            inviteInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    function onPixExpired() {
        const statusEl = document.getElementById('pixStatus');
        const expiredEl = document.getElementById('pixExpired');
        const btn = document.getElementById('pixGenerateBtn');

        statusEl.style.display = 'none';
        expiredEl.classList.add('visible');
        btn.disabled = false;
    }

    function copyPixPayload() {
        const payload = document.getElementById('pixPayload').value;
        if (!payload) return;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(payload).then(() => {
                showCopyFeedback();
            }).catch(() => {
                fallbackCopy(payload);
            });
        } else {
            fallbackCopy(payload);
        }
    }

    function fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showCopyFeedback();
        } catch (err) {
            // Silently fail
        }
        document.body.removeChild(textarea);
    }

    function showCopyFeedback() {
        const btn = document.getElementById('pixCopyBtn');
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 2000);
    }

    function clearPixIntervals() {
        if (pixPollingInterval) { clearInterval(pixPollingInterval); pixPollingInterval = null; }
        if (pixTimerInterval) { clearInterval(pixTimerInterval); pixTimerInterval = null; }
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', clearPixIntervals);

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPixSection);
    } else {
        initPixSection();
    }
})();

// ============ REGISTRATION FORM HANDLER ============

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const inviteCode = document.getElementById('inviteCode').value.trim().toUpperCase();
    const errorMessage = document.getElementById('error-message');
    const successMessage = document.getElementById('success-message');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    // Clear previous messages
    errorMessage.classList.remove('show');
    successMessage.classList.remove('show');

    // Client-side validation
    if (password !== confirmPassword) {
        errorMessage.textContent = 'Passwords do not match';
        errorMessage.classList.add('show');
        return;
    }

    if (password.length < 8) {
        errorMessage.textContent = 'Password must be at least 8 characters';
        errorMessage.classList.add('show');
        return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        errorMessage.textContent = 'Username can only contain letters, numbers, and underscores';
        errorMessage.classList.add('show');
        return;
    }

    if (!inviteCode) {
        errorMessage.textContent = 'Invite code is required';
        errorMessage.classList.add('show');
        return;
    }

    // Show loading state
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password, confirmPassword, inviteCode }),
            credentials: 'include'
        });

        const data = await response.json();

        if (response.ok) {
            successMessage.textContent = 'Registration successful! Redirecting to login...';
            successMessage.classList.add('show');
            setTimeout(() => {
                window.location.href = '/login.html';
            }, 2000);
        } else {
            errorMessage.textContent = data.message || 'Registration failed';
            errorMessage.classList.add('show');
        }
    } catch (error) {
        errorMessage.textContent = 'An error occurred. Please try again.';
        errorMessage.classList.add('show');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
});
