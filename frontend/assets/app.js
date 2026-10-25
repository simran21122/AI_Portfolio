/**
 * SimranOS — AI Portfolio Frontend
 * Handles: chat streaming via SSE, window controls, dock, desktop icons,
 * markdown rendering, copy, stop-generation, retry, suggestions.
 */

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const overlay = $('#chat-overlay');
const chatBody = $('#chat-body');
const chatInput = $('#chat-input');
const chatForm = $('#chat-form');
const sendBtn = $('#send-button');
const stopBtn = $('#stop-button');
const toast = $('#toast');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let toastTimer = null;
let abortController = null;   // Current fetch AbortController
let isStreaming = false;
let chatHistory = [];       // [{role:'user'|'assistant', content:'...'}]
const MAX_HISTORY = 16;       // max messages to keep in context

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------
function showToast(message, duration = 2600) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ---------------------------------------------------------------------------
// Chat overlay open / close
// ---------------------------------------------------------------------------
function openChat(autosendQuestion = '') {
  overlay.classList.add('open');
  $('.chat-window')?.classList.remove('chat-minimized', 'chat-maximized');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => chatInput.focus(), 120);
  if (autosendQuestion) {
    chatInput.value = autosendQuestion;
    sendQuestion(autosendQuestion);
  }
}

function closeChat() {
  if (isStreaming) stopGeneration();
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

// ---------------------------------------------------------------------------
// Window / dock controls
// ---------------------------------------------------------------------------
$$('#ask-shortcut, #nav-ask, #hero-ask, #dock-ask').forEach(el =>
  el.addEventListener('click', () => openChat()));

// Projects desktop shortcut scrolls to #work section
$('#projects-shortcut')?.addEventListener('click', () => {
  $('.window')?.classList.remove('closed', 'minimized');
  setTimeout(() => $('#work')?.scrollIntoView({ behavior: 'smooth' }), 20);
});

$('#chat-close').addEventListener('click', closeChat);

overlay.addEventListener('click', e => { if (e.target === overlay) closeChat(); });

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeChat(); });

// Clear chat button
$('#clear-chat-btn')?.addEventListener('click', () => {
  // Remove all messages except the first welcome message
  const allMsgs = $$('.bot-message, .user-message', chatBody);
  allMsgs.slice(1).forEach(el => el.remove());
  // Remove suggestions if they were already dismissed
  const existingSuggestions = $('#suggestions');
  if (!existingSuggestions) {
    const sugg = document.createElement('div');
    sugg.className = 'suggestions';
    sugg.id = 'suggestions';
    sugg.role = 'group';
    sugg.setAttribute('aria-label', 'Conversation starters');
    const chips = [
      { q: 'Who is Simran and what does she do?', label: '👩\u200d💻 Who is Simran?' },
      { q: 'Walk me through all of Simran\'s projects with GitHub and live demo links.', label: '🚀 All projects' },
      { q: 'What is Simran\'s technical skill set?', label: '🧰 Tech stack' },
      { q: 'Tell me about the VectorDB Studio RAG pipeline.', label: '🧠 VectorDB & RAG' },
    ];
    chips.forEach(({ q, label }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.question = q;
      btn.textContent = label;
      btn.addEventListener('click', () => sendQuestion(btn.dataset.question));
      sugg.appendChild(btn);
    });
    chatBody.appendChild(sugg);
    refreshIcons();
  }
  chatHistory = [];
  showToast('Conversation cleared.');
});

$('#dock-home').addEventListener('click', () => {
  $('.window').classList.remove('closed', 'minimized');
  setTimeout(() => $('#home').scrollIntoView({ behavior: 'smooth' }), 20);
});
$('#dock-resume').addEventListener('click', () => window.open('/resume', '_blank', 'noopener,noreferrer'));
$('#close-window').addEventListener('click', () => {
  $('.window').classList.toggle('closed');
  showToast($('.window').classList.contains('closed')
    ? 'Portfolio window closed — use the dock to reopen.'
    : 'Welcome back!');
});
$('#minimize-window').addEventListener('click', () => {
  $('.window').classList.toggle('minimized');
  showToast('Use the dock home button or reload to restore the window.');
});
$('#maximize-window').addEventListener('click', () => $('.window').classList.toggle('maximized'));
$('#dock-home').addEventListener('dblclick', () => $('.window').classList.remove('closed', 'minimized'));


// Chat window controls: minimize to a compact floating header or expand to a large workspace.
$('#chat-minimize')?.addEventListener('click', () => {
  $('.chat-window')?.classList.toggle('chat-minimized');
  $('.chat-window')?.classList.remove('chat-maximized');
  const minimized = $('.chat-window')?.classList.contains('chat-minimized');
  $('#chat-minimize')?.setAttribute('aria-label', minimized ? 'Restore chat' : 'Minimize chat');
  showToast(minimized ? 'Chat minimized — tap the header to restore.' : 'Chat restored.');
});
$('#chat-maximize')?.addEventListener('click', () => {
  $('.chat-window')?.classList.toggle('chat-maximized');
  $('.chat-window')?.classList.remove('chat-minimized');
  const maximized = $('.chat-window')?.classList.contains('chat-maximized');
  $('#chat-maximize')?.setAttribute('aria-label', maximized ? 'Restore chat size' : 'Maximize chat');
});
$('.chat-header')?.addEventListener('click', e => {
  if ($('.chat-window')?.classList.contains('chat-minimized') && !e.target.closest('button')) {
    $('.chat-window')?.classList.remove('chat-minimized');
    setTimeout(() => chatInput.focus(), 100);
  }
});

// Smooth page-style navigation with active state while retaining the existing section layout.
$$('[data-page-link]').forEach(link => link.addEventListener('click', () => {
  $$('[data-page-link]').forEach(item => item.classList.toggle('active', item === link));
}));
const pageSections = ['home', 'work', 'about', 'contact'].map(id => document.getElementById(id)).filter(Boolean);
if ('IntersectionObserver' in window) {
  const pageObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    $$('[data-page-link]').forEach(link => link.classList.toggle('active', link.dataset.pageLink === visible.target.id));
  }, { root: $('#portfolio-window'), threshold: [0.18, 0.4, 0.65] });
  pageSections.forEach(section => pageObserver.observe(section));
}

// Progressive enhancement: Lucide icons replace decorative text glyphs where available.
function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
}
refreshIcons();

// No-demo links
$$('.no-demo').forEach(link =>
  link.addEventListener('click', e => {
    e.preventDefault();
    showToast(`${link.dataset.project}: a live demo link isn't listed yet.`);
  })
);

// ---------------------------------------------------------------------------
// Markdown / text rendering
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inlineIcon(name) {
  const paths = {
    github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>',
    linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle>',
    globe: '<circle cx="12" cy="12" r="10"></circle><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path>',
  };
  return `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function createLinkChip(rawUrl, context = '') {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return escapeHtml(rawUrl);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return escapeHtml(rawUrl);

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const icon = host === 'github.com' || host.endsWith('.github.com')
    ? 'github'
    : host === 'linkedin.com' || host.endsWith('.linkedin.com')
      ? 'linkedin'
      : 'globe';
  const path = url.pathname === '/' ? '' : url.pathname;
  const fullLabel = `${host}${path}`;
  const label = fullLabel.length > 42 ? `${fullLabel.slice(0, 39)}…` : fullLabel;
  const action = context || (icon === 'github' ? 'Open GitHub link' : icon === 'linkedin' ? 'Open LinkedIn profile' : 'Open external link');
  const href = escapeHtml(url.href);

  return `<a class="reply-link-chip" href="${href}" target="_blank" rel="noopener noreferrer" title="${href}" aria-label="${escapeHtml(`${action}: ${url.href}`)}">${inlineIcon(icon)}<span>${escapeHtml(label)}</span></a>`;
}

function createEmailChip(email) {
  const safeEmail = escapeHtml(email);
  return `<span class="reply-email-group"><a class="reply-email-chip" href="mailto:${safeEmail}" aria-label="Email ${safeEmail}">${inlineIcon('mail')}<span>${safeEmail}</span></a><button class="email-copy-btn" type="button" data-copy-email="${safeEmail}" title="Copy email address" aria-label="Copy email address"><span class="copy-icon">${inlineIcon('copy')}</span><span class="copy-feedback" aria-live="polite"></span></button></span>`;
}

function inlineFormat(text, streaming = false) {
  const tokens = [];
  const stash = html => {
    const marker = `\uE000${tokens.length}\uE001`;
    tokens.push({ marker, html });
    return marker;
  };
  let s = text
    .replace(/[\uE000\uE001]/g, char => `&#${char.codePointAt(0)};`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(https?:\/\/[^>\s]+)>/gi, '$1');
  const labelMarkers = [];

  s = s.replace(/\*\*(GitHub repository|GitHub repo|Live demo):\*\*/gi, (_, label) => {
    const isRepository = /github/i.test(label);
    const marker = stash(`<span class="reply-label">${inlineIcon(isRepository ? 'github' : 'globe')}<strong>${escapeHtml(label)}:</strong></span>`);
    labelMarkers.push({ marker, context: isRepository ? 'Open GitHub repository' : 'Open live demo' });
    return marker;
  });
  const contextBefore = (source, offset) => labelMarkers.reduce((context, label) => {
    return source.lastIndexOf(label.marker, offset) >= 0 ? label.context : context;
  }, '');

  s = s.replace(/`([^`]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, _label, url, offset, source) =>
    stash(createLinkChip(url, contextBefore(source, offset))));
  s = s.replace(/https?:\/\/[^\s<>"']+/g, (match, offset, source) => {
    const punctuation = match.match(/[.,;:!?]+$/)?.[0] || '';
    const url = punctuation ? match.slice(0, -punctuation.length) : match;
    if (streaming && offset + match.length === source.length) return stash(escapeHtml(match));
    return stash(createLinkChip(url, contextBefore(source, offset))) + punctuation;
  });
  s = s.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, email => stash(createEmailChip(email)));
  s = escapeHtml(s);
  s = s.replace(/\r?\n/g, '<br>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');

  return tokens.reduce((result, token) => result.split(token.marker).join(token.html), s);
}

/**
 * Convert raw markdown-ish text to safe HTML.
 * Handles: headings, code fences, unordered/ordered lists, bold, italic, inline code, URLs.
 */
function renderMarkdown(text, streaming = false) {
  const rawLines = text.split(/\r?\n/);
  const blocks = [];

  const isHeading = line => /^#{1,3}\s+/.test(line);
  const isUnorderedItem = line => /^[-*•]\s+/.test(line);
  const isOrderedItem = line => /^\d+[.)]\s+/.test(line);
  const isHorizontalRule = line => /^[-*_]{3,}$/.test(line);
  const isTableSeparator = line => {
    if (!line.includes('|')) return false;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|');
    return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
  };
  const hasTableHeader = index => rawLines[index]?.includes('|') && isTableSeparator(rawLines[index + 1] || '');
  const parseTableRow = line => {
    const trimmed = line.trim().replace(/^\||\|$/g, '');
    return trimmed.split('|').map(cell => cell.replace(/\\\|/g, '|').trim());
  };

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i].trim();
    if (!line) { i++; continue; }

    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < rawLines.length && !rawLines[i].trimStart().startsWith('```')) codeLines.push(rawLines[i++]);
      if (i < rawLines.length) i++;
      blocks.push({ type: 'code', language, text: codeLines.join('\n') });
      continue;
    }

    if (hasTableHeader(i)) {
      const headers = parseTableRow(line);
      const rows = [];
      i += 2;
      while (i < rawLines.length && rawLines[i].trim() && rawLines[i].includes('|')) {
        rows.push(parseTableRow(rawLines[i]));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (isHorizontalRule(line) || isTableSeparator(line)) { i++; continue; }

    const listType = isUnorderedItem(line) ? 'ul' : isOrderedItem(line) ? 'ol' : '';
    if (listType) {
      const items = [];
      while (i < rawLines.length) {
        const itemLine = rawLines[i].trim();
        const item = listType === 'ul'
          ? itemLine.match(/^[-*•]\s+(.+)$/)
          : itemLine.match(/^\d+[.)]\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        i++;
      }
      blocks.push({ type: listType, items });
      continue;
    }

    const paragraphLines = [rawLines[i++].trim()];
    while (i < rawLines.length) {
      const next = rawLines[i].trim();
      if (!next || next.startsWith('```') || hasTableHeader(i) || isHeading(next) ||
        isUnorderedItem(next) || isOrderedItem(next) || isHorizontalRule(next) || isTableSeparator(next)) break;
      paragraphLines.push(next);
      i++;
    }
    blocks.push({ type: 'paragraph', lines: paragraphLines });
  }

  const isProjectTitle = block => block?.type === 'paragraph' &&
    block.lines.length === 1 && /^\*\*.+\*\*$/.test(block.lines[0].trim());
  const isProjectDetail = block => block?.type === 'ul' || block?.type === 'ol' ||
    (block?.type === 'paragraph' && block.lines.some(line => /^\*\*(?:GitHub repository|GitHub repo|Live demo):\*\*/i.test(line.trim())));
  const renderBlock = block => {
    if (block.type === 'heading') {
      const level = block.level === 1 ? 3 : block.level === 2 ? 4 : 5;
      return `<h${level} class="reply-section-title">${inlineFormat(block.text, streaming)}</h${level}>`;
    }
    if (block.type === 'paragraph') {
      const titleClass = isProjectTitle(block) ? ' class="reply-project-title"' : '';
      return `<p${titleClass}>${inlineFormat(block.lines.join('\n'), streaming)}</p>`;
    }
    if (block.type === 'ul' || block.type === 'ol') {
      return `<${block.type}>${block.items.map(item => `<li>${inlineFormat(item, streaming)}</li>`).join('')}</${block.type}>`;
    }
    if (block.type === 'code') {
      const langAttr = block.language ? ` class="language-${escapeHtml(block.language)}"` : '';
      return `<pre><code${langAttr}>${escapeHtml(block.text)}</code></pre>`;
    }
    if (block.type === 'table') {
      const rowsHtml = block.rows.map((row, rowIndex) => {
        const title = row[0]?.trim() || `Item ${rowIndex + 1}`;
        const details = block.headers.slice(1).map((header, index) => {
          const value = row[index + 1]?.trim();
          return value
            ? `<li><strong>${inlineFormat(header, streaming)}:</strong> ${inlineFormat(value, streaming)}</li>`
            : '';
        }).join('');
        return `<section class="reply-table-item"><h5 class="reply-table-title">${inlineFormat(title, streaming)}</h5>${details ? `<ul class="reply-table-details">${details}</ul>` : ''}</section>`;
      }).join('');
      return `<div class="reply-table-list">${rowsHtml}</div>`;
    }
    return '';
  };

  let html = '';
  for (i = 0; i < blocks.length; i++) {
    if (isProjectTitle(blocks[i]) && isProjectDetail(blocks[i + 1])) {
      let group = renderBlock(blocks[i]);
      i++;
      while (i < blocks.length && isProjectDetail(blocks[i])) group += renderBlock(blocks[i++]);
      i--;
      html += `<div class="reply-project-group">${group}</div>`;
    } else {
      html += renderBlock(blocks[i]);
    }
  }
  return html || '<p>I could not form an answer for that. Please try rephrasing.</p>';
}

// ---------------------------------------------------------------------------
// Message DOM helpers
// ---------------------------------------------------------------------------
function scrollToBottom(force = false) {
  // Only auto-scroll if user is near the bottom (within 120px)
  const nearBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 120;
  if (force || nearBottom) chatBody.scrollTop = chatBody.scrollHeight;
}

function appendUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'user-message';
  el.innerHTML = `
    <div class="message-content">
      <span class="message-label">YOU</span>
      <div class="message-text"><p>${escapeHtml(text)}</p></div>
    </div>`;
  chatBody.appendChild(el);
  scrollToBottom(true);
  return el;
}

function appendBotMessage() {
  const el = document.createElement('div');
  el.className = 'bot-message';
  el.innerHTML = `
    <div class="message-avatar" aria-hidden="true">✦</div>
    <div class="message-content">
      <span class="message-label">SIMRAN'S AI TWIN</span>
      <div class="message-text"></div>
      <div class="message-actions" style="display:none;">
        <button class="msg-action-btn copy-btn" title="Copy response" aria-label="Copy response">
          <span>⎘</span> Copy
        </button>
      </div>
    </div>`;
  chatBody.appendChild(el);
  scrollToBottom(true);

  const textEl = el.querySelector('.message-text');
  const actionsEl = el.querySelector('.message-actions');
  const copyBtn = el.querySelector('.copy-btn');

  // Wire up copy button
  copyBtn.addEventListener('click', () => {
    const raw = textEl.dataset.rawText || textEl.innerText;
    navigator.clipboard.writeText(raw).then(() => {
      copyBtn.innerHTML = '<span>✓</span> Copied';
      setTimeout(() => { copyBtn.innerHTML = '<span>⎘</span> Copy'; }, 2000);
    }).catch(() => showToast('Could not copy to clipboard.'));
  });

  return { el, textEl, actionsEl };
}

function showTypingIndicator() {
  const { el, textEl } = appendBotMessage();
  textEl.innerHTML = '<div class="typing-dots"><i></i><i></i><i></i></div>';
  el.classList.add('typing-message');
  return el;
}

function removeTypingIndicator(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function showErrorMessage(text, onRetry) {
  const el = document.createElement('div');
  el.className = 'bot-message error-message';
  el.innerHTML = `
    <div class="message-avatar error-avatar" aria-hidden="true">!</div>
    <div class="message-content">
      <span class="message-label">ERROR</span>
      <div class="message-text"><p>${escapeHtml(text)}</p></div>
      ${onRetry ? '<div class="message-actions"><button class="msg-action-btn retry-btn"><span>↺</span> Retry</button></div>' : ''}
    </div>`;
  chatBody.appendChild(el);
  scrollToBottom(true);
  if (onRetry) el.querySelector('.retry-btn').addEventListener('click', onRetry);
}

// ---------------------------------------------------------------------------
// Input / button state management
// ---------------------------------------------------------------------------
function setStreamingState(streaming) {
  isStreaming = streaming;
  sendBtn.disabled = streaming;
  sendBtn.style.display = streaming ? 'none' : 'grid';
  stopBtn.style.display = streaming ? 'grid' : 'none';
  chatInput.disabled = streaming;
}

function stopGeneration() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  setStreamingState(false);
  chatInput.disabled = false;
  chatInput.focus();
}

stopBtn.addEventListener('click', stopGeneration);

chatBody.addEventListener('click', async event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('.email-copy-btn');
  if (!button || !chatBody.contains(button)) return;

  try {
    await navigator.clipboard.writeText(button.dataset.copyEmail);
    const feedback = button.querySelector('.copy-feedback');
    feedback.textContent = 'Copied';
    button.setAttribute('aria-label', 'Email address copied');
    button.title = 'Copied';
    setTimeout(() => {
      if (!button.isConnected) return;
      feedback.textContent = '';
      button.setAttribute('aria-label', 'Copy email address');
      button.title = 'Copy email address';
    }, 1600);
  } catch {
    showToast('Could not copy email address.');
  }
});

// ---------------------------------------------------------------------------
// Core streaming chat function
// ---------------------------------------------------------------------------
async function sendQuestion(questionText) {
  const question = (questionText || chatInput.value).trim();
  if (!question || isStreaming) return;

  // Remove suggestions panel if present
  $('#suggestions')?.remove();

  appendUserMessage(question);
  chatInput.value = '';
  chatInput.style.height = 'auto';

  setStreamingState(true);

  const typingEl = showTypingIndicator();
  typingEl.classList.add('is-generating');
  let botMsgRefs = null;
  let accumulatedText = '';
  let lastQuestion = question;

  abortController = new AbortController();

  // Build request payload including history
  const payload = {
    question,
    history: chatHistory.slice(-MAX_HISTORY),
  };

  try {
    const response = await fetch('/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });

    if (!response.ok) {
      let detail = `Request failed (${response.status})`;
      try { const j = await response.json(); detail = j.detail || detail; } catch (_) { }
      throw new Error(detail);
    }

    // Headers arrived, but keep the dots visible until the first token shows up
    let typingRemoved = false;
    const clearTyping = () => {
      if (!typingRemoved) {
        typingRemoved = true;
        removeTypingIndicator(typingEl);
        botMsgRefs = appendBotMessage();
        botMsgRefs.el.classList.add('is-generating');
      }
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // SSE parsing loop
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages (terminated by \n\n)
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // Keep incomplete last part in buffer

      for (const part of parts) {
        const lines = part.split('\n');
        let eventType = 'message';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          else if (line.startsWith('data: ')) eventData = line.slice(6);
        }

        if (eventType === 'token' && eventData) {
          clearTyping(); 
          // Unescape \n that was encoded for SSE compliance
          const token = eventData.replace(/\\n/g, '\n');
          accumulatedText += token;
          // Update the message with rendered markdown
          botMsgRefs.textEl.innerHTML = renderMarkdown(accumulatedText, true);
          botMsgRefs.textEl.dataset.rawText = accumulatedText;
          scrollToBottom();
        } else if (eventType === 'done') {
          // Stream complete
          break;
        } else if (eventType === 'error' && eventData) {
          clearTyping();
          const errText = eventData.replace(/\\n/g, '\n');
          if (botMsgRefs) {
            botMsgRefs.textEl.innerHTML = `<p class="error-text">${escapeHtml(errText)}</p>`;
          }
        }
      }
    }
    if (!typingRemoved) { clearTyping(); }

    // Final render pass & reveal actions
    if (botMsgRefs && accumulatedText) {
      botMsgRefs.textEl.innerHTML = renderMarkdown(accumulatedText);
      botMsgRefs.textEl.dataset.rawText = accumulatedText;
      botMsgRefs.actionsEl.style.display = 'flex';
      scrollToBottom();
    } else if (botMsgRefs && !accumulatedText) {
      botMsgRefs.textEl.innerHTML = '<p>Generation was stopped.</p>';
    }

    // Persist to local history
    chatHistory.push({ role: 'user', content: question });
    if (accumulatedText) {
      chatHistory.push({ role: 'assistant', content: accumulatedText });
    }
    // Trim history
    while (chatHistory.length > MAX_HISTORY) chatHistory.shift();

  } catch (err) {
    removeTypingIndicator(typingEl);
    if (botMsgRefs) botMsgRefs.el.remove();

    if (err.name === 'AbortError') {
      // User stopped — add a small note if there was partial content
      if (accumulatedText && botMsgRefs) {
        botMsgRefs.textEl.innerHTML = renderMarkdown(accumulatedText) + '<p class="stopped-note">— Generation stopped.</p>';
        botMsgRefs.actionsEl.style.display = 'flex';
      }
    } else {
      const retryFn = () => sendQuestion(lastQuestion);
      showErrorMessage(
        `Couldn't reach the portfolio AI. ${err.message || 'Please try again.'}`,
        retryFn,
      );
    }
  } finally {
    typingEl.classList.remove('is-generating');
    botMsgRefs?.el.classList.remove('is-generating');
    setStreamingState(false);
    abortController = null;
    chatInput.focus();
  }
}

// ---------------------------------------------------------------------------
// Form / keyboard
// ---------------------------------------------------------------------------
chatForm.addEventListener('submit', e => { e.preventDefault(); sendQuestion(); });

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!isStreaming) chatForm.requestSubmit();
  }
});

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
});

// Suggestion chips
$$('.suggestions button').forEach(btn =>
  btn.addEventListener('click', () => {
    openChat();
    sendQuestion(btn.dataset.question);
  })
);

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------
function updateClock() {
  const el = $('#clock');
  if (el) el.textContent = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date());
}
updateClock();
setInterval(updateClock, 30_000);

// ---------------------------------------------------------------------------
// Health check → menu bar status
// ---------------------------------------------------------------------------
fetch('/health')
  .then(r => r.json())
  .then(data => {
    const statusEl = $('#system-status');
    if (!statusEl) return;
    if (!data.ai_configured) statusEl.textContent = 'API key needed';
    else if (!data.resume_found) statusEl.textContent = 'Resume missing';
    else statusEl.textContent = 'AI portfolio online';
  })
  .catch(() => {
    const statusEl = $('#system-status');
    if (statusEl) statusEl.textContent = 'Backend unavailable';
  });
