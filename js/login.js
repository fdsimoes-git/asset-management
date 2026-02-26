(function() {
    const loginForm = document.getElementById('loginForm');
    const loginFormContainer = loginForm.closest('.login-form');
    const twofaStep = document.getElementById('twofa-step');
    const errorMessage = document.getElementById('error-message');
    const twofaError = document.getElementById('twofa-error');
    const twofaCodeInput = document.getElementById('twofaCode');
    const verify2FABtn = document.getElementById('verify2FABtn');
    const backToLoginLink = document.getElementById('backToLogin');

    let pendingTempToken = null;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        errorMessage.classList.remove('show');

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });

            const data = await response.json();

            if (response.ok) {
                if (data.requires2FA) {
                    pendingTempToken = data.tempToken;
                    show2FAStep();
                } else {
                    window.location.href = '/index.html';
                }
            } else {
                errorMessage.textContent = data.message || t('login.errorDefault');
                errorMessage.classList.add('show');
            }
        } catch (error) {
            errorMessage.textContent = t('login.errorGeneric');
            errorMessage.classList.add('show');
        }
    });

    function show2FAStep() {
        loginFormContainer.style.display = 'none';
        twofaStep.style.display = '';
        twofaCodeInput.value = '';
        twofaError.classList.remove('show');
        twofaCodeInput.focus();
        applyTranslations();
    }

    function showLoginForm() {
        twofaStep.style.display = 'none';
        loginFormContainer.style.display = '';
        pendingTempToken = null;
    }

    async function verify2FA() {
        const code = twofaCodeInput.value.trim();
        if (!code) return;

        twofaError.classList.remove('show');
        verify2FABtn.classList.add('loading');
        verify2FABtn.disabled = true;

        try {
            const response = await fetch('/api/login/verify-2fa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tempToken: pendingTempToken, totpCode: code }),
                credentials: 'include'
            });

            const data = await response.json();

            if (response.ok) {
                window.location.href = '/index.html';
            } else {
                twofaError.textContent = data.message || t('login.twoFAInvalid');
                twofaError.classList.add('show');
            }
        } catch (error) {
            twofaError.textContent = t('login.errorGeneric');
            twofaError.classList.add('show');
        } finally {
            verify2FABtn.classList.remove('loading');
            verify2FABtn.disabled = false;
        }
    }

    verify2FABtn.addEventListener('click', verify2FA);

    twofaCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verify2FA();
    });

    backToLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        showLoginForm();
    });
})();
