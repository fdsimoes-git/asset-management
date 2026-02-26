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
                if (!inUl) { html += '<ul>'; inUl = true; }
                html += '<li>' + ulMatch[1] + '</li>';
            } else if (olMatch) {
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
            // Send last 20 messages as history (excluding the current one we just added)
            const history = chatMessages.slice(-21, -1);

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
        } catch (err) {
            hideLoading();
            appendMessage('assistant', t('chat.errorGeneric'));
        }
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
