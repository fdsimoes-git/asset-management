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
        // Step 1: Protect fenced code blocks from other processing
        const codeBlocks = [];
        text = text.replace(/```([^\n]*)\n?([\s\S]*?)```/g, function (match, lang, code) {
            var idx = codeBlocks.length;
            lang = (lang || '').trim();
            var safeLang = lang.replace(/[^A-Za-z0-9_-]+/g, '-');
            if (!safeLang) { safeLang = ''; }
            codeBlocks.push({ lang: safeLang, code: code });
            return '\x00CODE' + idx + '\x00';
        });

        // Step 2: Escape HTML
        let s = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Step 3: Inline formatting — headings, bold, italic, inline code
        // Headings: ### h4, ## h3, # h3 (check longer prefixes first)
        s = s.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        s = s.replace(/^# (.+)$/gm, '<h3>$1</h3>');
        // Bold: **text**
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic: *text* (avoid matching inside bold)
        s = s.replace(/(?<!\w)\*(?!\*)(.+?)(?<!\*)\*(?!\w)/g, '<em>$1</em>');
        // Inline code: `text`
        s = s.replace(/`(.+?)`/g, '<code>$1</code>');

        // Step 3b: Protect inline-code spans with placeholders before table parsing.
        // By this point, backtick spans have already been converted to <code>…</code>
        // (Step 3 above), so parseRow()'s inCode/backtick toggle would never fire.
        // Placeholders prevent pipes inside <code>…</code> from being mis-split as
        // column separators during the table-parsing step below.
        const inlineCodeSpans = [];
        s = s.replace(/<code>[\s\S]*?<\/code>/g, function (match) {
            var idx = inlineCodeSpans.length;
            inlineCodeSpans.push(match);
            return '\x00ICODE' + idx + '\x00';
        });

        // Step 4: Parse markdown tables
        // Ensure trailing newline so the last row is always captured by the regex
        if (!s.endsWith('\n')) s += '\n';
        // Match blocks of consecutive lines that look like markdown tables.
        // Supports both pipe-bounded rows ("| a | b |") and rows without outer pipes ("a | b").
        // [^|\n]* (zero-or-more) lets empty cells like "| a | | c |" be detected correctly.
        s = s.replace(/((?:[ \t]*(?:\|[^|\n]*(?:\|[^|\n]*)+|[^|\n]+(?:\|[^|\n]*)+)[ \t]*\n)+)/g, function (tableBlock) {
            var rows = tableBlock.trim().split('\n').filter(function (r) { return r.trim(); });
            if (rows.length < 2) return tableBlock;

            // Verify the second row is a separator (e.g. |---|:--|--:| or ---|:--|--:)
            var sep = rows[1].trim();

            // Guard: if the header or separator line starts with a list marker
            // (e.g. "- ", "* ", "+ ", "1. ", "2) "), treat this block as a list,
            // not as a table, so that list parsing can handle it correctly.
            if (/^[-*+]\s|^\d+[.)]\s/.test(rows[0].trim()) || /^[-*+]\s|^\d+[.)]\s/.test(sep)) {
                return tableBlock;
            }

            var isSep = /^\|?[\s\-:]+(\|[\s\-:]+)+\|?$/.test(sep);
            if (!isSep) return tableBlock;

            // Proper cell splitter: respects inline code spans and escaped pipes,
            // and handles empty cells (adjacent pipes with nothing between them).
            var parseRow = function (row) {
                var line = row.trim().replace(/^\|/, '').replace(/\|$/, '');
                var cells = [];
                var current = '';
                // Note: inline-code spans were replaced with \x00ICODEn\x00 placeholders
                // before this step, so no pipe inside <code>…</code> will appear here.
                for (var i = 0; i < line.length; i++) {
                    var ch = line[i];
                    if (ch === '|') {
                        // Count consecutive backslashes before this pipe.
                        // Only treat the pipe as escaped when the count is odd
                        // (even count means all backslashes cancel out, e.g. \\ is a literal \).
                        var bsCount = 0;
                        var j = i - 1;
                        while (j >= 0 && line[j] === '\\') { bsCount++; j--; }
                        var pipeEscaped = (bsCount % 2 === 1);
                        if (!pipeEscaped) {
                            cells.push(current.trim().replace(/\\\|/g, '|'));
                            current = '';
                            continue;
                        }
                    }
                    current += ch;
                }
                cells.push(current.trim().replace(/\\\|/g, '|'));
                return cells;
            };

            // Build table as a single HTML line so the line-processor doesn't break it
            var tHtml = '<div class="chat-md-table-wrap"><table class="chat-md-table"><thead><tr>';
            parseRow(rows[0]).forEach(function (h) { tHtml += '<th>' + h + '</th>'; });
            tHtml += '</tr></thead><tbody>';
            for (var i = 2; i < rows.length; i++) {
                if (!rows[i].trim()) continue;
                tHtml += '<tr>';
                parseRow(rows[i]).forEach(function (c) { tHtml += '<td>' + c + '</td>'; });
                tHtml += '</tr>';
            }
            tHtml += '</tbody></table></div>';
            return tHtml + '\n';
        });

        // Step 4b: Restore inline-code spans after table parsing
        s = s.replace(/\x00ICODE(\d+)\x00/g, function (match, idxStr) {
            return inlineCodeSpans[parseInt(idxStr)] || match;
        });

        // Step 5: Line-by-line processing for lists and paragraphs
        const lines = s.split('\n');
        let html = '';
        let inUl = false;
        let inOl = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const ulMatch = line.match(/^[ \t]*[-•]\s+(.*)/);
            const olMatch = line.match(/^[ \t]*(\d+)[.)]\s+(.*)/);
            // Block-level HTML elements — don't wrap with <br>
            const isBlockEl = /^<(div|table|h[1-6])/.test(line);
            // Code block placeholders — restore later, must not get a trailing <br>
            const isCodePlaceholder = /^\x00CODE\d+\x00$/.test(line.trim());

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
                } else if (isBlockEl || isCodePlaceholder) {
                    html += line; // block elements and code placeholders — no trailing <br>
                } else {
                    html += line + '<br>';
                }
            }
        }
        if (inUl) html += '</ul>';
        if (inOl) html += '</ol>';

        // Step 6: Restore fenced code blocks
        html = html.replace(/\x00CODE(\d+)\x00/g, function (match, idxStr) {
            var cb = codeBlocks[parseInt(idxStr)];
            if (!cb) { return match; } // defensive: entry missing, leave placeholder
            var escaped = cb.code
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            var cls = cb.lang ? ' class="language-' + cb.lang + '"' : '';
            return '<pre><code' + cls + '>' + escaped + '</code></pre>';
        });

        // Clean up trailing <br>
        html = html.replace(/(<br>\s*)+$/, '');

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

            const res = await csrfFetch('/api/ai/chat', {
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
            if (data.pendingDeletes && data.pendingDeletes.length > 0) {
                renderDeleteConfirmationCard(data.pendingDeletes);
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
                    const res = await csrfFetch('/api/ai/confirm-edit', {
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
                    await csrfFetch('/api/ai/cancel-edit', {
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

    function renderDeleteConfirmationCard(pendingDeletes) {
        const isBulk = pendingDeletes.length > 1;
        const card = document.createElement('div');
        card.className = 'chat-confirm-card';

        const titleText = isBulk
            ? t('chat.confirmDeleteTitleCount', { count: pendingDeletes.length })
            : t('chat.confirmDeleteTitle');
        let html = '<div class="chat-confirm-title">' + escapeHtml(titleText) + '</div>';

        for (const pd of pendingDeletes) {
            const entry = pd.currentEntry;
            html += '<div class="chat-confirm-entry-group">';
            html += '<div class="chat-confirm-entry">';
            html += '<strong>' + escapeHtml(entry.description) + '</strong><br>';
            html += escapeHtml(entry.type) + ' &middot; ' + escapeHtml(entry.month) + ' &middot; ' + escapeHtml(parseFloat(entry.amount).toFixed(2));
            if (entry.tags && entry.tags.length) {
                html += ' &middot; ' + escapeHtml(entry.tags.join(', '));
            }
            html += '</div>';
            html += '</div>';
        }

        html += '<div class="chat-confirm-warning">⚠️ ' + escapeHtml(t('chat.deleteWarning')) + '</div>';

        const confirmLabel = isBulk ? t('chat.confirmAllDeletes') : t('chat.confirmDelete');
        html += '<div class="chat-confirm-actions">';
        html += '<button class="chat-confirm-btn chat-confirm-btn--danger" data-action="confirm">' + escapeHtml(confirmLabel) + '</button>';
        html += '<button class="chat-cancel-btn" data-action="cancel">' + escapeHtml(t('chat.cancelDelete')) + '</button>';
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
                for (const pd of pendingDeletes) {
                    const res = await csrfFetch('/api/ai/confirm-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ entryId: pd.entryId })
                    });
                    if (res.status === 410) { failed++; expired = true; }
                    else if (!res.ok) { failed++; }
                    else { succeeded++; }
                }
                if (failed > 0 && succeeded === 0) {
                    const errorMsg = expired ? t('chat.deleteExpired') : t('chat.errorGeneric');
                    replaceCardWithMessage(card, errorMsg, 'error');
                } else if (failed > 0 && succeeded > 0) {
                    const msg = t('chat.partialDeletesConfirmed', { succeeded, failed });
                    replaceCardWithMessage(card, msg, 'error');
                    chatMessages.push({ role: 'assistant', content: msg });
                    if (typeof window.loadEntries === 'function') window.loadEntries();
                } else {
                    const msg = isBulk ? t('chat.allDeletesConfirmed') : t('chat.deleteConfirmed');
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
                for (const pd of pendingDeletes) {
                    await csrfFetch('/api/ai/cancel-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ entryId: pd.entryId })
                    });
                }
            } catch (e) { /* ignore */ }
            const msg = isBulk ? t('chat.allDeletesCancelled') : t('chat.deleteCancelled');
            replaceCardWithMessage(card, msg, 'info');
            chatMessages.push({ role: 'assistant', content: msg });
        });

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
