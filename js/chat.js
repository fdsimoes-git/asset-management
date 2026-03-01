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

        // Headings: ### h3, ## h2, # h1 (check longer prefixes first)
        s = s.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        s = s.replace(/^# (.+)$/gm, '<h3>$1</h3>');
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
                } else if (/^<h[34]>/.test(line)) {
                    html += line;
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
            // Send last 20 messages (user + assistant) as conversation context
            const history = chatMessages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-21, -1);

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
                } else if (data.error === 'invalid_api_key') {
                    appendMessage('assistant', t('chat.errorInvalidKey'));
                } else if (data.error === 'quota_exceeded') {
                    appendMessage('assistant', t('chat.errorQuota'));
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
                renderConfirmationCard(data.pendingEdits);
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

    function renderConfirmationCard(pendingEdits) {
        const isBulk = pendingEdits.length > 1;
        const card = document.createElement('div');
        card.className = 'chat-confirm-card';

        // Title
        const titleText = isBulk
            ? t('chat.confirmEditTitleCount', { count: pendingEdits.length })
            : t('chat.confirmEditTitle');
        let html = '<div class="chat-confirm-title">' + escapeHtml(titleText) + '</div>';

        // Render each entry and its changes
        for (const pe of pendingEdits) {
            const entry = pe.currentEntry;
            const changes = pe.changes;

            html += '<div class="chat-confirm-entry-group">';
            html += '<div class="chat-confirm-entry">';
            html += '<strong>' + escapeHtml(entry.description) + '</strong><br>';
            html += escapeHtml(entry.type) + ' &middot; ' + escapeHtml(entry.month) + ' &middot; ' + escapeHtml(parseFloat(entry.amount).toFixed(2));
            if (entry.tags && entry.tags.length) {
                html += ' &middot; ' + escapeHtml(entry.tags.join(', '));
            }
            html += '</div>';

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
            html += '</div>';
        }

        // Buttons
        const confirmLabel = isBulk ? t('chat.confirmAllEdits') : t('chat.confirmEdit');
        html += '<div class="chat-confirm-actions">';
        html += '<button class="chat-confirm-btn" data-action="confirm">' + escapeHtml(confirmLabel) + '</button>';
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
                let succeeded = 0;
                let failed = 0;
                let expired = false;
                for (const pe of pendingEdits) {
                    const res = await fetch('/api/ai/confirm-edit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ entryId: pe.entryId })
                    });
                    if (res.status === 410) { failed++; expired = true; }
                    else if (!res.ok) { failed++; }
                    else { succeeded++; }
                }
                if (failed > 0 && succeeded === 0) {
                    const errorMsg = expired ? t('chat.editExpired') : t('chat.errorGeneric');
                    replaceCardWithMessage(card, errorMsg, 'error');
                } else if (failed > 0 && succeeded > 0) {
                    const msg = t('chat.partialEditsConfirmed', { succeeded, failed });
                    replaceCardWithMessage(card, msg, 'error');
                    chatMessages.push({ role: 'assistant', content: msg });
                    if (typeof window.loadEntries === 'function') window.loadEntries();
                } else {
                    const msg = isBulk ? t('chat.allEditsConfirmed') : t('chat.editConfirmed');
                    replaceCardWithMessage(card, msg, 'success');
                    chatMessages.push({ role: 'assistant', content: msg });
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
                for (const pe of pendingEdits) {
                    await fetch('/api/ai/cancel-edit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ entryId: pe.entryId })
                    });
                }
            } catch (e) { /* ignore */ }
            const msg = isBulk ? t('chat.allEditsCancelled') : t('chat.editCancelled');
            replaceCardWithMessage(card, msg, 'info');
            chatMessages.push({ role: 'assistant', content: msg });
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
