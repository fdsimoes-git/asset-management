let storedUsername = '';

document.getElementById('step1Form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const errorMessage = document.getElementById('error-message');
    const infoMessage = document.getElementById('info-message');
    const btn = document.getElementById('step1Btn');

    errorMessage.classList.remove('show');
    infoMessage.classList.remove('show');

    if (!username) {
        errorMessage.textContent = t('forgot.errorUsername');
        errorMessage.classList.add('show');
        return;
    }

    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = t('forgot.sending');

    try {
        const response = await fetch('/api/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });

        const data = await response.json();

        // Always move to step 2 regardless of response (prevents user enumeration)
        storedUsername = username;
        document.getElementById('step1Form').style.display = 'none';
        document.getElementById('step2Form').style.display = 'block';
        document.querySelector('.subtitle').textContent = t('forgot.step2Subtitle');

        infoMessage.textContent = data.message;
        infoMessage.classList.add('show');

        document.getElementById('resetCode').focus();
    } catch (error) {
        errorMessage.textContent = t('forgot.errorGeneric');
        errorMessage.classList.add('show');
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = t('forgot.sendCode');
    }
});

document.getElementById('step2Form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const code = document.getElementById('resetCode').value.trim();
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorMessage = document.getElementById('error-message');
    const infoMessage = document.getElementById('info-message');
    const successMessage = document.getElementById('success-message');
    const btn = document.getElementById('step2Btn');

    errorMessage.classList.remove('show');
    infoMessage.classList.remove('show');

    if (!code || !newPassword || !confirmPassword) {
        errorMessage.textContent = t('forgot.errorAllFields');
        errorMessage.classList.add('show');
        return;
    }

    if (newPassword.length < 8) {
        errorMessage.textContent = t('forgot.errorPasswordLength');
        errorMessage.classList.add('show');
        return;
    }

    if (newPassword !== confirmPassword) {
        errorMessage.textContent = t('forgot.errorPasswordMatch');
        errorMessage.classList.add('show');
        return;
    }

    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = t('forgot.resetting');

    try {
        const response = await fetch('/api/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: storedUsername,
                code: code,
                newPassword: newPassword
            })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('step2Form').style.display = 'none';
            successMessage.classList.add('show');

            setTimeout(() => {
                window.location.href = '/login.html';
            }, 2000);
        } else {
            errorMessage.textContent = data.message || t('forgot.errorResetFailed');
            errorMessage.classList.add('show');
        }
    } catch (error) {
        errorMessage.textContent = t('forgot.errorGeneric');
        errorMessage.classList.add('show');
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = t('forgot.resetBtn');
    }
});
