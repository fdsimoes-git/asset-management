// ============ PAYPAL PURCHASE LOGIC ============

(function() {
    async function initPaypalSection() {
        try {
            const res = await fetch('/api/paypal/config');
            const data = await res.json();
            if (!data.enabled) return;

            const section = document.getElementById('paypalSection');
            const priceEl = document.getElementById('paypalPrice');
            if (!section || !priceEl) return;

            priceEl.textContent = data.price;
            section.classList.add('visible');

            // Toggle collapse
            const toggle = document.getElementById('paypalToggle');
            const body = document.getElementById('paypalBody');
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('open');
                body.classList.toggle('open');
                toggle.setAttribute('aria-expanded', toggle.classList.contains('open'));
            });
            toggle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle.click();
                }
            });

            // Dynamically load PayPal JS SDK
            const script = document.createElement('script');
            script.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(data.clientId) + '&currency=BRL&intent=capture&disable-funding=paypal';
            script.onload = function() {
                renderPaypalButtons();
            };
            script.onerror = function() {
                console.error('Failed to load PayPal SDK');
                var errorEl = document.getElementById('paypalError');
                var containerEl = document.getElementById('paypalButtonContainer');
                if (containerEl) containerEl.style.display = 'none';
                if (errorEl) {
                    errorEl.textContent = 'Unable to load PayPal at the moment. Please try again later.';
                    errorEl.classList.add('visible');
                }
            };
            document.head.appendChild(script);
        } catch (err) {
            // PayPal not available, silently ignore
        }
    }

    function renderPaypalButtons() {
        var successEl = document.getElementById('paypalSuccess');
        var errorEl = document.getElementById('paypalError');
        var containerEl = document.getElementById('paypalButtonContainer');

        paypal.Buttons({
            style: {
                layout: 'vertical',
                color: 'gold',
                shape: 'rect',
                label: 'pay'
            },
            createOrder: function() {
                // Hide previous messages
                successEl.classList.remove('visible');
                errorEl.classList.remove('visible');

                return fetch('/api/paypal/create-order', { method: 'POST' })
                    .then(function(res) {
                        return res.json().then(function(json) {
                            if (!res.ok) throw new Error(json.message || 'Failed to create order');
                            return json;
                        });
                    })
                    .then(function(data) {
                        return data.orderId;
                    });
            },
            onApprove: function(data) {
                return fetch('/api/paypal/capture-order/' + data.orderID, { method: 'POST' })
                    .then(function(res) {
                        return res.json().then(function(json) {
                            if (!res.ok) throw new Error(json.message || 'Failed to capture payment');
                            return json;
                        });
                    })
                    .then(function(result) {
                        // Auto-fill invite code
                        var inviteInput = document.getElementById('inviteCode');
                        if (inviteInput && result.inviteCode) {
                            inviteInput.value = result.inviteCode;
                            inviteInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }

                        // Show success state
                        containerEl.style.display = 'none';
                        successEl.classList.add('visible');
                    })
                    .catch(function(err) {
                        errorEl.textContent = err.message || 'Payment capture failed. Please try again.';
                        errorEl.classList.add('visible');
                    });
            },
            onError: function(err) {
                errorEl.textContent = 'Payment error. Please try again.';
                errorEl.classList.add('visible');
            },
            onCancel: function() {
                // User closed PayPal popup — no action needed
            }
        }).render('#paypalButtonContainer');
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPaypalSection);
    } else {
        initPaypalSection();
    }
})();

// ============ REGISTRATION FORM HANDLER ============

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
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
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errorMessage.textContent = 'A valid email address is required';
        errorMessage.classList.add('show');
        return;
    }

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
            body: JSON.stringify({ username, email, password, confirmPassword, inviteCode }),
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
