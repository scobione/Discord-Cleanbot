const API_BASE = window.location.origin + '/api';
let selectedServer = null;
let connectionRetries = 0;
let userKey = sessionStorage.getItem('userKey') || '';

const statusDot = document.getElementById('statusDot');
const connectionStatus = document.getElementById('connectionStatus');
const serverCount = document.getElementById('serverCount');
const resetCount = document.getElementById('resetCount');
const progressLabel = document.getElementById('progressLabel');
const serverSelect = document.getElementById('serverSelect');
const channelName = document.getElementById('channelName');
const channelCount = document.getElementById('channelCount');
const channelCountDisplay = document.getElementById('channelCountDisplay');
const channelMessage = document.getElementById('channelMessage');
const messageCount = document.getElementById('messageCount');
const messageCountDisplay = document.getElementById('messageCountDisplay');
const resetBtn = document.getElementById('resetBtn');
const deleteOnlyBtn = document.getElementById('deleteOnlyBtn');
const progressCard = document.getElementById('progressCard');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const historyList = document.getElementById('historyList');
const apiUrl = document.getElementById('apiUrl');
const loginScreen = document.getElementById('loginScreen');
const userKeyInput = document.getElementById('userKeyInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const adminBtn = document.getElementById('adminBtn');
const terminalBtn = document.getElementById('terminalBtn');

apiUrl.textContent = API_BASE;

// ============ LOGIN ============
if (userKey) { validateAndEnter(userKey); } else { loginScreen.style.display = 'flex'; }

async function validateAndEnter(key) {
    try {
        const r = await fetch(API_BASE + '/validate-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userKey: key }) });
        const d = await r.json();
        if (d.valid) {
            userKey = key;
            sessionStorage.setItem('userKey', key);
            loginScreen.style.display = 'none';
            addLog('🔑 Key akzeptiert • ' + d.remainingResets + ' Resets übrig', 'success', 'system');
            fetchStatus(); fetchServers(); fetchServerLogs(); startPolling();
        } else {
            loginError.textContent = '❌ ' + (d.reason || 'Ungültiger Key');
            loginError.style.display = 'block';
            sessionStorage.removeItem('userKey'); userKey = ''; loginScreen.style.display = 'flex';
        }
    } catch (e) { loginError.textContent = '❌ Server nicht erreichbar'; loginError.style.display = 'block'; }
}

loginBtn.addEventListener('click', () => { const key = userKeyInput.value.trim(); if (!key) { loginError.textContent = 'Bitte Key eingeben'; loginError.style.display = 'block'; return; } validateAndEnter(key); });
userKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });

// ============ LOG ============
const logContainer = document.getElementById('logContainer');
const clearLogsBtn = document.getElementById('clearLogs');
let logEntries = [];

function addLog(message, type, category) {
    type = type || 'info'; category = category || 'system';
    const timestamp = new Date().toLocaleTimeString('de-DE');
    if (logEntries.length > 0 && logEntries[0].message === message) return;
    logEntries.unshift({ timestamp, message, type, category });
    if (logEntries.length > 100) logEntries.pop();
    renderLogs();
}

function renderLogs() {
    logContainer.innerHTML = logEntries.map(e => '<div class="log-entry log-' + e.type + '"><span class="log-timestamp">' + e.timestamp + '</span><span class="log-category ' + e.category + '">' + e.category + '</span>' + e.message + '</div>').join('');
}

function clearLogs() { logEntries = []; logContainer.innerHTML = '<div class="log-entry log-system">🟢 Logs geleert</div>'; }
clearLogsBtn.addEventListener('click', clearLogs);

let lastStatus = { online: null, running: null, step: null, serverCount: null, totalResets: null };

async function fetchServerLogs() {
    try {
        const r = await fetch(API_BASE + '/status'); const d = await r.json();
        if (d.online !== lastStatus.online) addLog(d.online ? '✅ Bot online: ' + d.username : '❌ Bot offline', d.online ? 'success' : 'error', 'bot');
        if (d.serverCount !== lastStatus.serverCount) addLog('📡 ' + d.serverCount + ' Server', 'info', 'bot');
        if (d.running && d.step !== lastStatus.step) addLog('⏳ ' + d.step, 'info', 'api');
        if (!d.running && lastStatus.running === true) addLog('✅ Reset abgeschlossen!', 'success', 'api');
        lastStatus = { online: d.online, running: d.running, step: d.step, serverCount: d.serverCount, totalResets: d.stats?.totalResets };
    } catch (e) {}
}

// ============ STATUS ============
async function fetchStatus() {
    try {
        const r = await fetch(API_BASE + '/status'); const d = await r.json();
        if (d.online) { statusDot.className = 'status-dot online'; connectionStatus.textContent = '✅ ' + d.username; connectionRetries = 0; }
        else { statusDot.className = 'status-dot offline'; connectionStatus.textContent = '⏳ Bot startet...'; }
        serverCount.textContent = d.serverCount || 0; resetCount.textContent = d.stats?.totalResets || 0;
        if (d.running) { progressCard.style.display = 'block'; progressFill.style.width = d.progressPercent + '%'; progressText.textContent = d.step; progressLabel.textContent = 'Läuft...'; }
        else if (d.step?.includes('Fertig')) { progressLabel.textContent = 'Bereit ✅'; }
        if (d.stats?.history?.length > 0) updateHistory(d.stats.history);
        if (!d.running && resetBtn.disabled) { resetBtn.disabled = false; deleteOnlyBtn.disabled = false; fetchServers(); }
    } catch (e) { connectionRetries++; statusDot.className = 'status-dot offline'; connectionStatus.textContent = '⏳ Warte auf Server...'; }
}

async function fetchServers() {
    if (!userKey) return;
    try {
        serverSelect.innerHTML = '<option value="">-- Lade... --</option>';
        const r = await fetch(API_BASE + '/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userKey: userKey }) });
        if (r.status === 403) { serverSelect.innerHTML = '<option value="">-- Key ungültig --</option>'; return; }
        const servers = await r.json();
        if (!Array.isArray(servers) || servers.length === 0) { serverSelect.innerHTML = '<option value="">-- Keine Server --</option>'; return; }
        serverSelect.innerHTML = '<option value="">-- Server auswählen --</option>';
        servers.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; serverSelect.appendChild(o); });
    } catch (e) { serverSelect.innerHTML = '<option value="">-- Fehler --</option>'; }
}

function updateHistory(h) {
    historyList.innerHTML = h.slice(0, 10).map(h => '<div class="history-item"><span>🔄</span><div><strong>' + h.server + '</strong><div class="history-time">' + new Date(h.timestamp).toLocaleString('de-DE') + ' • ' + h.channelsCreated + ' Kanäle</div></div></div>').join('');
}

async function doReset(del) {
    if (!userKey) { alert('Bitte einloggen!'); return; }
    if (!selectedServer) { alert('Server auswählen!'); return; }
    del = del || false;
    const repeatMsg = parseInt(messageCount.value);
    const msg = del ? '⚠️ ALLE Kanäle löschen?' : '⚠️ Reset?\n\n' + channelCount.value + ' Kanäle "' + channelName.value + '-X"\nNachricht: "' + channelMessage.value + '"\n' + repeatMsg + 'x pro Kanal';
    if (!confirm(msg)) return;
    resetBtn.disabled = true; deleteOnlyBtn.disabled = true; progressCard.style.display = 'block'; progressFill.style.width = '0%'; progressText.textContent = 'Starte...';
    try {
        const endpoint = del ? 'delete-channels' : 'reset';
        const body = del ? { userKey, serverId: selectedServer, requestedBy: 'Dashboard-User' } : { userKey, serverId: selectedServer, channelCount: parseInt(channelCount.value), channelName: channelName.value, channelMessage: channelMessage.value, messageRepeat: parseInt(messageCount.value), requestedBy: 'Dashboard-User' };
        const r = await fetch(API_BASE + '/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json();
        if (d.success) { addLog('✅ Reset fertig • ' + (d.remainingResets || '?') + ' Resets übrig', 'success', 'api'); }
        else { alert('❌ ' + (d.error || 'Fehler')); resetBtn.disabled = false; deleteOnlyBtn.disabled = false; progressCard.style.display = 'none'; }
    } catch (e) { alert('❌ Netzwerkfehler'); resetBtn.disabled = false; deleteOnlyBtn.disabled = false; progressCard.style.display = 'none'; }
}

// ============ ADMIN ============
let adminPassword = '';
adminBtn.addEventListener('click', () => { const pw = prompt('🔐 Admin-Passwort:'); if (!pw) return; adminPassword = pw; loadAdminPanel(); });

async function loadAdminPanel() {
    try {
        const r = await fetch(API_BASE + '/admin/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) });
        if (!r.ok) { alert('❌ Falsches Passwort!'); return; }
        showAdminPanel(await r.json());
    } catch (e) { alert('❌ Fehler'); }
}

function showAdminPanel(keys) {
    const old = document.querySelector('.admin-panel'); if (old) old.remove();
    const panel = document.createElement('div'); panel.className = 'admin-panel';
    panel.innerHTML = '<div class="admin-card"><h2>👑 Admin-Menü</h2><h3 style="color:#a29bfe;margin-top:16px;">➕ Neuer Key</h3><input type="text" id="newKeyName" class="input" placeholder="Key-Name" style="margin-top:8px;"><input type="number" id="newKeyResets" class="input" placeholder="Max Resets" value="2" min="1" max="100" style="margin-top:4px;"><button id="createKeyBtn" class="btn btn-primary" style="margin-top:8px;">🔑 Key erstellen</button><h3 style="color:#a29bfe;margin-top:16px;">📋 Keys (' + keys.length + ')</h3><div id="keyList">' + keys.map(k => '<div class="key-item"><div class="key-info"><strong>' + k.key + '</strong>Resets: ' + k.remainingResets + ' | ' + new Date(k.created).toLocaleDateString('de-DE') + '</div><div class="key-actions"><button class="btn-refill" data-key="' + k.key + '">+1</button><button class="btn-delete" data-key="' + k.key + '">🗑️</button></div></div>').join('') + '</div><button id="closeAdmin" class="btn btn-secondary" style="margin-top:16px;">Schließen</button></div>';
    document.body.appendChild(panel);
    document.getElementById('closeAdmin').addEventListener('click', () => panel.remove());
    document.getElementById('createKeyBtn').addEventListener('click', async () => {
        const name = document.getElementById('newKeyName').value.trim();
        const resets = document.getElementById('newKeyResets').value;
        if (!name) return alert('Name eingeben!');
        await fetch(API_BASE + '/admin/create-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword, keyName: name, maxResets: resets }) });
        loadAdminPanel();
    });
    document.querySelectorAll('.btn-refill').forEach(btn => { btn.addEventListener('click', async () => { await fetch(API_BASE + '/admin/refill-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword, key: btn.dataset.key, amount: 1 }) }); loadAdminPanel(); }); });
    document.querySelectorAll('.btn-delete').forEach(btn => { btn.addEventListener('click', async () => { if (!confirm('Key löschen?')) return; await fetch(API_BASE + '/admin/delete-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword, key: btn.dataset.key }) }); loadAdminPanel(); }); });
}

// ============ TERMINAL ============
let terminalActive = false;
let terminalStep = '';
let terminalSelectedServer = null;
let terminalChannelName = 'dreh';
let terminalChannelCount = 3;
let terminalChannelMessage = '✅ Kanal bereit!';
let terminalMessageRepeat = 1;
let terminalAction = 'reset';

const hackerLines = [
    { text: 'Initializing system...', color: 'dim', delay: 200 },
    { text: 'Loading kernel modules...', color: 'dim', delay: 300 },
    { text: '[ OK ] kernel32.sys', color: 'green', delay: 150 },
    { text: '[ OK ] ntfs.sys', color: 'green', delay: 150 },
    { text: '[ OK ] tcpip.sys', color: 'green', delay: 150 },
    { text: 'Scanning network interfaces...', color: 'dim', delay: 400 },
    { text: '[ INFO ] eth0: 192.168.1.100', color: 'cyan', delay: 200 },
    { text: '[ INFO ] wlan0: 10.0.0.42', color: 'cyan', delay: 200 },
    { text: 'Establishing secure connection...', color: 'dim', delay: 500 },
    { text: '[ TLS ] Handshake complete', color: 'green', delay: 200 },
    { text: '[ TLS ] Cipher: AES-256-GCM', color: 'green', delay: 200 },
    { text: 'Cracking server...', color: 'yellow', delay: 400 },
    { text: '[ SCAN ] Port 80: OPEN', color: 'green', delay: 250 },
    { text: '[ SCAN ] Port 443: OPEN', color: 'green', delay: 250 },
    { text: '[ SCAN ] Port 22: FILTERED', color: 'yellow', delay: 250 },
    { text: '[ SCAN ] Port 3306: CLOSED', color: 'red', delay: 250 },
    { text: 'Finding endpoint...', color: 'cyan', delay: 600 },
    { text: '[ FOUND ] /api/gateway', color: 'green', delay: 300 },
    { text: '[ FOUND ] /api/v2/reset', color: 'green', delay: 300 },
    { text: 'Bypassing firewall...', color: 'yellow', delay: 500 },
    { text: '[ OK ] Firewall bypassed', color: 'green', delay: 200 },
    { text: 'Loading server list...', color: 'dim', delay: 400 },
];

const asciiArt = [
    '    ██████╗ ██████╗ ████████╗ ██████╗  ██████╗ ██╗     ',
    '    ██╔══██╗██╔══██╗╚══██╔══╝██╔═══██╗██╔═══██╗██║     ',
    '    ██████╔╝██║  ██║   ██║   ██║   ██║██║   ██║██║     ',
    '    ██╔══██╗██║  ██║   ██║   ██║   ██║██║   ██║██║     ',
    '    ██║  ██║██████╔╝   ██║   ╚██████╔╝╚██████╔╝███████╗',
    '    ╚═╝  ╚═╝╚═════╝    ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝',
    '',
    '    ══════════════════════════════════════════════════════',
    '    RDTOOL v2.5.8263.4 | Server Cleaner',
    '    ══════════════════════════════════════════════════════'
];

function createTerminal() {
    const existing = document.querySelector('.terminal-overlay');
    if (existing) { existing.remove(); terminalActive = false; terminalStep = ''; return; }

    terminalActive = true;
    terminalStep = 'init';

    const overlay = document.createElement('div');
    overlay.className = 'terminal-overlay';
    overlay.innerHTML = '<div class="terminal-header"><div class="terminal-dot red"></div><div class="terminal-dot yellow"></div><div class="terminal-dot green" id="terminalClose"></div><span class="terminal-title">RD-TOOL.exe – Terminal</span></div><div class="terminal-body" id="terminalBody"><p class="terminal-line dim">RDTOOL Terminal v2.5.8263.4</p><p class="terminal-line dim">Type \'start RD.exe\' to begin, \'help\' for commands, \'exit\' to close.</p><p class="terminal-line dim">──────────────────────────────────────────────</p><div id="terminalOutput"></div><div class="terminal-input-line"><span class="terminal-prompt">&gt;</span><input type="text" class="terminal-input" id="terminalInput" placeholder="Awaiting command..." autofocus></div></div>';

    document.body.appendChild(overlay);
    document.getElementById('terminalClose').addEventListener('click', () => { overlay.remove(); terminalActive = false; terminalStep = ''; });
    document.getElementById('terminalBody').addEventListener('click', () => document.getElementById('terminalInput').focus());

    const input = document.getElementById('terminalInput');
    input.focus();
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const cmd = input.value.trim().toLowerCase();
            input.value = '';
            await handleTerminalCommand(cmd);
            document.getElementById('terminalBody').scrollTop = document.getElementById('terminalBody').scrollHeight;
        }
    });
}

async function handleTerminalCommand(cmd) {
    const output = document.getElementById('terminalOutput');
    const promptLine = document.createElement('p');
    promptLine.className = 'terminal-line green';
    promptLine.textContent = '> ' + cmd;
    output.appendChild(promptLine);

    if (cmd === 'exit' || cmd === 'quit') {
        addTerminalLine(output, 'Closing connection... Goodbye.', 'dim');
        setTimeout(() => { const ov = document.querySelector('.terminal-overlay'); if (ov) ov.remove(); terminalActive = false; terminalStep = ''; }, 800);
        return;
    }
    if (cmd === 'help') {
        addTerminalLine(output, 'Available commands:', 'cyan');
        addTerminalLine(output, '  start RD.exe  - Launch server cleaner', 'white');
        addTerminalLine(output, '  clear/cls     - Clear terminal', 'white');
        addTerminalLine(output, '  exit/quit     - Close terminal', 'white');
        addTerminalLine(output, '  help          - Show this help', 'white');
        return;
    }
    if (cmd === 'clear' || cmd === 'cls') { output.innerHTML = ''; return; }

    if (cmd === 'start rd.exe') {
        terminalStep = 'hacking';
        await showHackingSequence(output);
        await showAsciiArt(output);
        terminalStep = 'select_server';
        await showServerSelection(output);
        return;
    }

    if (terminalStep === 'select_server') {
        const servers = await fetchServersList();
        const num = parseInt(cmd);
        if (num >= 1 && num <= servers.length) {
            terminalSelectedServer = servers[num - 1];
            addTerminalLine(output, '[ OK ] Selected: ' + terminalSelectedServer.name, 'green');
            terminalStep = 'action_select';
            await askAction(output);
        } else {
            addTerminalLine(output, '[ ERROR ] Invalid selection.', 'red');
            await showServerSelection(output);
        }
        return;
    }

    if (terminalStep === 'action_select') {
        if (cmd === '1') { terminalAction = 'reset'; addTerminalLine(output, 'Action: Full Reset', 'green'); }
        else if (cmd === '2') { terminalAction = 'delete'; addTerminalLine(output, 'Action: Delete Only', 'green'); }
        else { addTerminalLine(output, '[ ERROR ] Choose 1 or 2.', 'red'); await askAction(output); return; }
        terminalStep = 'channel_config';
        await askChannelConfig(output);
        return;
    }

    if (terminalStep === 'channel_config') {
        if (cmd === 'y') { terminalStep = 'confirm'; await askConfirm(output); }
        else if (cmd === 'n') { terminalStep = 'custom_config_name'; addTerminalLine(output, 'Enter channel name (e.g. dreh):', 'cyan'); }
        else { addTerminalLine(output, '[ ERROR ] Please answer y/n', 'red'); await askChannelConfig(output); }
        return;
    }
    if (terminalStep === 'custom_config_name') { terminalChannelName = cmd || 'dreh'; terminalStep = 'custom_config_count'; addTerminalLine(output, 'Name: ' + terminalChannelName, 'green'); addTerminalLine(output, 'Channels (1-3):', 'cyan'); return; }
    if (terminalStep === 'custom_config_count') { terminalChannelCount = Math.min(Math.max(parseInt(cmd) || 100, 1), 100); terminalStep = 'custom_config_msg'; addTerminalLine(output, 'Count: ' + terminalChannelCount, 'green'); addTerminalLine(output, 'Message:', 'cyan'); return; }
    if (terminalStep === 'custom_config_msg') { terminalChannelMessage = cmd || '✅ Kanal bereit!'; terminalStep = 'custom_config_repeat'; addTerminalLine(output, 'Message: "' + terminalChannelMessage + '"', 'green'); addTerminalLine(output, 'Times (1-10):', 'cyan'); return; }
    if (terminalStep === 'custom_config_repeat') { terminalMessageRepeat = Math.min(Math.max(parseInt(cmd) || 1, 1), 15); addTerminalLine(output, 'Repeat: ' + terminalMessageRepeat + 'x', 'green'); terminalStep = 'confirm'; await askConfirm(output); return; }

    if (terminalStep === 'confirm') {
        if (cmd === 'y' || cmd === 'yes') { await executeTerminalReset(output); }
        else { addTerminalLine(output, '[ ABORT ] Cancelled.', 'yellow'); addTerminalLine(output, '> Awaiting command...', 'dim'); terminalStep = ''; }
        return;
    }

    addTerminalLine(output, 'Unknown command. Type help.', 'yellow');
}

function addTerminalLine(output, text, color) {
    const line = document.createElement('p');
    line.className = 'terminal-line ' + (color || 'green');
    line.textContent = text;
    output.appendChild(line);
}

async function showHackingSequence(output) {
    for (const line of hackerLines) {
        addTerminalLine(output, line.text, line.color);
        document.getElementById('terminalBody').scrollTop = document.getElementById('terminalBody').scrollHeight;
        await new Promise(r => setTimeout(r, line.delay));
    }
}

async function showAsciiArt(output) {
    for (const line of asciiArt) {
        const pre = document.createElement('pre');
        pre.className = 'terminal-ascii';
        pre.textContent = line;
        output.appendChild(pre);
        await new Promise(r => setTimeout(r, 60));
    }
    await new Promise(r => setTimeout(r, 500));
}

async function showServerSelection(output) {
    addTerminalLine(output, '', 'green');
    addTerminalLine(output, '>> Welchen Server möchtest du bereinigen?', 'cyan');
    addTerminalLine(output, 'Fetching...', 'dim');
    const servers = await fetchServersList();
    if (servers.length === 0) { addTerminalLine(output, '[ ERROR ] No servers.', 'red'); addTerminalLine(output, '> Awaiting command...', 'dim'); terminalStep = ''; return; }
    servers.forEach((s, i) => addTerminalLine(output, '  [' + (i + 1) + '] ' + s.name, 'white'));
    addTerminalLine(output, 'Enter number:', 'cyan');
}

async function fetchServersList() {
    if (!userKey) return [];
    try {
        const r = await fetch(API_BASE + '/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userKey }) });
        return await r.json();
    } catch (e) { return []; }
}

async function askAction(output) {
    addTerminalLine(output, '', 'green');
    addTerminalLine(output, '>> Reset oder nur löschen?', 'cyan');
    addTerminalLine(output, '  [1] Full Reset', 'white');
    addTerminalLine(output, '  [2] Delete only', 'white');
}

async function askChannelConfig(output) {
    addTerminalLine(output, '', 'green');
    addTerminalLine(output, '>> Custom config? (not reccomended)(default: dreh 1-100)', 'cyan');
    addTerminalLine(output, '  [Y] Use default  [N] Custom', 'white');
}

async function askConfirm(output) {
    const act = terminalAction === 'reset' ? 'Full Reset' : 'Delete Only';
    addTerminalLine(output, '', 'green');
    addTerminalLine(output, '>> CONFIRM: ' + act + ' on ' + (terminalSelectedServer?.name || '?') + '?', 'yellow');
    addTerminalLine(output, '  Channels: ' + terminalChannelCount + ' x "' + terminalChannelName + '-X"', 'white');
    addTerminalLine(output, '  Message: "' + terminalChannelMessage + '" (' + terminalMessageRepeat + 'x)', 'white');
    addTerminalLine(output, '  [Y] Yes  [N] No', 'white');
}

async function executeTerminalReset(output) {
    addTerminalLine(output, '', 'green');
    addTerminalLine(output, '╔══════════════════════════════════════════╗', 'cyan');
    addTerminalLine(output, '║     INITIALIZING SERVER PURGE v2.5       ║', 'cyan');
    addTerminalLine(output, '╚══════════════════════════════════════════╝', 'cyan');
    addTerminalLine(output, '', 'green');

    const fakeLogs = [
        { text: '[BOOT] Starting RDTOOL engine...', color: 'dim', delay: 180 },
        { text: '[OK] Config loaded', color: 'green', delay: 150 },
        { text: `[TARGET] ${terminalSelectedServer?.name}`, color: 'cyan', delay: 200 },
        { text: '[AUTH] Key accepted • ADMIN', color: 'green', delay: 200 },
        { text: '[FIREWALL] Bypassed', color: 'green', delay: 300 },
        { text: '', color: 'green', delay: 100 },
        { text: '══════ BEGINNING PURGE ══════', color: 'magenta', delay: 300 },
        { text: '', color: 'green', delay: 100 },
    ];

    for (const log of fakeLogs) {
        addTerminalLine(output, log.text, log.color);
        document.getElementById('terminalBody').scrollTop = document.getElementById('terminalBody').scrollHeight;
        await new Promise(r => setTimeout(r, log.delay));
    }

    addTerminalLine(output, '[EXEC] Sending command...', 'yellow');

    const endpoint = terminalAction === 'reset' ? 'reset' : 'delete-channels';
    const body = terminalAction === 'reset'
        ? { userKey, serverId: terminalSelectedServer.id, channelCount: terminalChannelCount, channelName: terminalChannelName, channelMessage: terminalChannelMessage, messageRepeat: terminalMessageRepeat, requestedBy: 'Terminal-User' }
        : { userKey, serverId: terminalSelectedServer.id, requestedBy: 'Terminal-User' };

    // ASYNCHRON starten
    let resetResult = null;
    fetch(API_BASE + '/' + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json()).then(d => { resetResult = d; }).catch(() => {});

    addTerminalLine(output, '[EXEC] Command accepted • Monitoring...', 'green');
    addTerminalLine(output, '', 'green');

    let prevStep = '';
    let wasRunning = false;
    let pollCount = 0;

    const pollInterval = setInterval(async () => {
        try {
            const sr = await fetch(API_BASE + '/status');
            const st = await sr.json();

            if (st.running) {
                wasRunning = true;
                if (st.step !== prevStep) {
                    prevStep = st.step;
                    pollCount++;
                    const pct = st.progressPercent || 0;
                    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
                    addTerminalLine(output, '[PROGRESS] ' + bar + ' ' + pct + '%', 'cyan');
                    addTerminalLine(output, '  ' + st.step, 'dim');
                    document.getElementById('terminalBody').scrollTop = document.getElementById('terminalBody').scrollHeight;
                }
            }

            if (!st.running && wasRunning) {
                clearInterval(pollInterval);
                const remaining = (resetResult?.remainingResets !== undefined) ? resetResult.remainingResets : '?';
                addTerminalLine(output, '', 'green');
                addTerminalLine(output, '╔══════════════════════════════════════════╗', 'green');
                addTerminalLine(output, '║     ✓ OPERATION COMPLETED               ║', 'green');
                addTerminalLine(output, '╚══════════════════════════════════════════╝', 'green');
                addTerminalLine(output, '', 'green');
                addTerminalLine(output, '[SERVER] ' + terminalSelectedServer.name + ' cleaned', 'cyan');
                addTerminalLine(output, '[TOKEN] ' + remaining + ' reset(s) remaining', 'yellow');
                addTerminalLine(output, '[TIME] ' + new Date().toLocaleString('de-DE'), 'white');
                addTerminalLine(output, '', 'green');
                addTerminalLine(output, '──────────────────────────────────────────────', 'dim');
                addTerminalLine(output, '> Awaiting command...', 'dim');
                terminalStep = '';
            }

            if (pollCount > 120) {
                clearInterval(pollInterval);
                addTerminalLine(output, '[TIMEOUT] Too long', 'red');
                addTerminalLine(output, '> Awaiting command...', 'dim');
                terminalStep = '';
            }
        } catch (e) {}
    }, 1000);

    setTimeout(() => clearInterval(pollInterval), 120000);
}

terminalBtn.addEventListener('click', createTerminal);

// ============ EVENTS ============
serverSelect.addEventListener('change', e => { selectedServer = e.target.value; });
channelCount.addEventListener('input', e => { channelCountDisplay.textContent = e.target.value; });
messageCount.addEventListener('input', e => { messageCountDisplay.textContent = e.target.value; });
resetBtn.addEventListener('click', () => doReset(false));
deleteOnlyBtn.addEventListener('click', () => doReset(true));
document.getElementById('refreshServers').addEventListener('click', fetchServers);

// ============ POLLING ============
function startPolling() {
    fetchStatus(); fetchServers(); fetchServerLogs();
    let fast = setInterval(() => { fetchStatus(); fetchServers(); fetchServerLogs(); }, 5000);
    setTimeout(() => { clearInterval(fast); setInterval(fetchStatus, 15000); setInterval(fetchServers, 30000); setInterval(fetchServerLogs, 15000); }, 120000);
}

addLog('🟢 Dashboard bereit', 'system', 'system');