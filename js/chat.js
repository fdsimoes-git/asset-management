// ============ AI CHAT FINANCIAL ADVISOR ============

(function () {
    'use strict';

    let chatMessages = [];
    let chatOpen = false;
    let chatLoading = false;
    let welcomeSent = false;

    const fab = document.getElementById('chatFab');
    const win = document.getElementById('chatWindow');
    const messagesEl = document.getElementById('chatMessages');
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    const closeBtn = document.getElementById('chatCloseBtn');

    // No visibility toggle needed — index.html is the dashboard page itself.
    // Unauthenticated users are redirected to login.html before this runs.

    function toggleChat() {
        if (chatOpen) {
            closeChat();
        } else {
            openChat();
        }
    }

    function openChat() {
        chatOpen = true;
        win.classList.add('open');
        input.focus();

        if (!welcomeSent) {
            welcomeSent = true;
            const welcomeText = t('chat.welcome') + '\n\n' + t('chat.welcomeExamples');
            appendMessage('assistant', welcomeText);
        }
    }

    function closeChat() {
        chatOpen = false;
        win.classList.remove('open');
    }

    function appendMessage(role, content) {
        chatMessages.push({ role, content });
        renderMessage(role, content);
        scrollToBottom();
    }

    function renderMessage(role, content) {
        const div = document.createElement('div');
        div.className = role === 'user' ? 'chat-message-user' : 'chat-message-assistant';

        if (role === 'assistant') {
            div.innerHTML = parseMarkdown(content);
        } else {
            div.textContent = content;
        }

        messagesEl.appendChild(div);
    }

    function parseMarkdown(text) {
        // Escape HTML first
        let s = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Bold: **text**
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic: *text* (negative lookbehind/lookahead to avoid matching inside bold tags)
        s = s.replace(/(?<!\w)\*(?!\*)(.+?)(?<!\*)\*(?!\w)/g, '<em>$1</em>');
        // Inline code: `text`
        s = s.replace(/`(.+?)`/g, '<code>$1</code>');

        // Convert lines to handle lists and paragraphs
        const lines = s.split('\n');
        let html = '';
        let inUl = false;
        let inOl = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const ulMatch = line.match(/^[\s]*[-•]\s+(.*)/);
            const olMatch = line.match(/^[\s]*(\d+)[.)]\s+(.*)/);

            if (ulMatch) {
                if (inOl) { html += '</ol>'; inOl = false; }
                if (!inUl) { html += '<ul>'; inUl = true; }
                html += '<li>' + ulMatch[1] + '</li>';
            } else if (olMatch) {
                if (inUl) { html += '</ul>'; inUl = false; }
                if (!inOl) { html += '<ol>'; inOl = true; }
                html += '<li>' + olMatch[2] + '</li>';
            } else {
                if (inUl) { html += '</ul>'; inUl = false; }
                if (inOl) { html += '</ol>'; inOl = false; }
                if (line.trim() === '') {
                    html += '<br>';
                } else {
                    html += line + '<br>';
                }
            }
        }
        if (inUl) html += '</ul>';
        if (inOl) html += '</ol>';

        // Clean up trailing <br>
        html = html.replace(/(<br>)+$/, '');

        return html;
    }

    function showLoading() {
        chatLoading = true;
        sendBtn.disabled = true;
        const loader = document.createElement('div');
        loader.className = 'chat-loading';
        loader.id = 'chatLoadingIndicator';
        loader.innerHTML = '<div class="chat-loading-dot"></div><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div>';
        messagesEl.appendChild(loader);
        scrollToBottom();
    }

    function hideLoading() {
        chatLoading = false;
        sendBtn.disabled = false;
        const loader = document.getElementById('chatLoadingIndicator');
        if (loader) loader.remove();
    }

    function scrollToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function sendMessage() {
        const text = input.value.trim();
        if (!text || chatLoading) return;

        input.value = '';
        appendMessage('user', text);
        showLoading();

        try {
            // Send last 20 user messages as history (server only accepts user role)
            const history = chatMessages.filter(m => m.role === 'user').slice(-21, -1);

            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history, message: text })
            });

            hideLoading();

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                if (data.error === 'no_api_key') {
                    appendMessage('assistant', t('chat.errorNoKey'));
                } else if (res.status === 429) {
                    appendMessage('assistant', t('chat.errorRateLimit'));
                } else {
                    appendMessage('assistant', t('chat.errorGeneric'));
                }
                return;
            }

            const data = await res.json();
            appendMessage('assistant', data.reply || t('chat.errorGeneric'));
            if (data.pendingEdits && data.pendingEdits.length > 0) {
                data.pendingEdits.forEach(pe => renderConfirmationCard(pe));
            }
        } catch (err) {
            hideLoading();
            appendMessage('assistant', t('chat.errorGeneric'));
        }
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatFieldValue(key, value) {
        if (key === 'amount') return parseFloat(value).toFixed(2);
        if (key === 'tags' && Array.isArray(value)) return value.join(', ') || '—';
        return String(value);
    }

    function renderConfirmationCard(pendingEdit) {
        const card = document.createElement('div');
        card.className = 'chat-confirm-card';

        const entry = pendingEdit.currentEntry;
        const changes = pendingEdit.changes;

        // Title
        let html = '<div class="chat-confirm-title">' + escapeHtml(t('chat.confirmEditTitle')) + '</div>';

        // Current entry summary
        html += '<div class="chat-confirm-entry">';
        html += '<strong>' + escapeHtml(entry.description) + '</strong><br>';
        html += escapeHtml(entry.type) + ' &middot; ' + escapeHtml(entry.month) + ' &middot; ' + escapeHtml(parseFloat(entry.amount).toFixed(2));
        if (entry.tags && entry.tags.length) {
            html += ' &middot; ' + escapeHtml(entry.tags.join(', '));
        }
        html += '</div>';

        // Proposed changes
        html += '<div class="chat-confirm-changes">';
        for (const [key, newVal] of Object.entries(changes)) {
            const currentVal = entry[key];
            html += '<div class="chat-confirm-change">';
            html += '<span class="chat-confirm-change-label">' + escapeHtml(key) + '</span>';
            html += '<span class="chat-confirm-change-current">' + escapeHtml(formatFieldValue(key, currentVal)) + '</span>';
            html += '<span class="chat-confirm-change-arrow">&rarr;</span>';
            html += '<span class="chat-confirm-change-new">' + escapeHtml(formatFieldValue(key, newVal)) + '</span>';
            html += '</div>';
        }
        html += '</div>';

        // Buttons
        html += '<div class="chat-confirm-actions">';
        html += '<button class="chat-confirm-btn" data-action="confirm">' + escapeHtml(t('chat.confirmEdit')) + '</button>';
        html += '<button class="chat-cancel-btn" data-action="cancel">' + escapeHtml(t('chat.cancelEdit')) + '</button>';
        html += '</div>';

        card.innerHTML = html;
        messagesEl.appendChild(card);

        const confirmBtn = card.querySelector('[data-action="confirm"]');
        const cancelBtn = card.querySelector('[data-action="cancel"]');

        confirmBtn.addEventListener('click', async function () {
            confirmBtn.disabled = true;
            cancelBtn.disabled = true;
            try {
                const res = await fetch('/api/ai/confirm-edit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entryId: pendingEdit.entryId })
                });
                if (res.status === 410) {
                    replaceCardWithMessage(card, t('chat.editExpired'), 'error');
                } else if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    replaceCardWithMessage(card, err.error || t('chat.errorGeneric'), 'error');
                } else {
                    replaceCardWithMessage(card, t('chat.editConfirmed'), 'success');
                    chatMessages.push({ role: 'assistant', content: t('chat.editConfirmed') });
                    // Refresh dashboard entries table so changes are visible immediately
                    if (typeof window.loadEntries === 'function') window.loadEntries();
                }
            } catch (e) {
                replaceCardWithMessage(card, t('chat.errorGeneric'), 'error');
            }
        });

        cancelBtn.addEventListener('click', async function () {
            confirmBtn.disabled = true;
            cancelBtn.disabled = true;
            try {
                await fetch('/api/ai/cancel-edit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entryId: pendingEdit.entryId })
                });
            } catch (e) { /* ignore */ }
            replaceCardWithMessage(card, t('chat.editCancelled'), 'info');
            chatMessages.push({ role: 'assistant', content: t('chat.editCancelled') });
        });

        scrollToBottom();
    }

    function replaceCardWithMessage(card, text, type) {
        const msg = document.createElement('div');
        msg.className = 'chat-confirm-result chat-confirm-result--' + type;
        msg.textContent = text;
        card.replaceWith(msg);
        scrollToBottom();
    }

    // Event listeners
    fab.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', closeChat);
    sendBtn.addEventListener('click', sendMessage);

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendMessage();
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && chatOpen) {
            closeChat();
        }
    });
})();
