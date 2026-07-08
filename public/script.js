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