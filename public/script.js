const API_BASE = window.location.origin + '/api';
let selectedServer = null;
let connectionRetries = 0;
let userKey = sessionStorage.getItem('userKey') || '';
let isAdmin = false;

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
if (userKey) {
    validateAndEnter(userKey);
} else {
    loginScreen.style.display = 'flex';
}

async function validateAndEnter(key) {
    try {
        const r = await fetch(API_BASE + '/validate-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userKey: key })
        });
        const d = await r.json();
        
        if (d.valid) {
            userKey = key;
            sessionStorage.setItem('userKey', key);
            loginScreen.style.display = 'none';
            addLog(`🔑 Key akzeptiert • ${d.remainingResets} Resets übrig`, 'success', 'system');
        } else {
            loginError.textContent = '❌ ' + (d.reason || 'Ungültiger Key');
            loginError.style.display = 'block';
            sessionStorage.removeItem('userKey');
            userKey = '';
            loginScreen.style.display = 'flex';
        }
    } catch (e) {
        loginError.textContent = '❌ Server nicht erreichbar';
        loginError.style.display = 'block';
    }
}

loginBtn.addEventListener('click', () => {
    const key = userKeyInput.value.trim();
    if (!key) {
        loginError.textContent = 'Bitte Key eingeben';
        loginError.style.display = 'block';
        return;
    }
    validateAndEnter(key);
});

userKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
});

// ============ LOG-SYSTEM ============
const logContainer = document.getElementById('logContainer');
const clearLogsBtn = document.getElementById('clearLogs');
let logEntries = [];

function addLog(message, type = 'info', category = 'system') {
    const timestamp = new Date().toLocaleTimeString('de-DE');
    if (logEntries.length > 0 && logEntries[0].message === message) return;
    logEntries.unshift({ timestamp, message, type, category });
    if (logEntries.length > 100) logEntries.pop();
    renderLogs();
}

function renderLogs() {
    logContainer.innerHTML = logEntries.map(entry => `
        <div class="log-entry log-${entry.type}">
            <span class="log-timestamp">${entry.timestamp}</span>
            <span class="log-category ${entry.category}">${entry.category}</span>
            ${entry.message}
        </div>
    `).join('');
}

function clearLogs() { logEntries = []; logContainer.innerHTML = '<div class="log-entry log-system">🟢 Logs geleert</div>'; }
clearLogsBtn.addEventListener('click', clearLogs);

let lastStatus = { online: null, running: null, step: null, serverCount: null, totalResets: null };

async function fetchServerLogs() {
    try {
        const r = await fetch(API_BASE + '/status');
        const d = await r.json();
        if (d.online !== lastStatus.online) addLog(d.online ? `✅ Bot online: ${d.username}` : '❌ Bot offline', d.online ? 'success' : 'error', 'bot');
        if (d.serverCount !== lastStatus.serverCount) addLog(`📡 ${d.serverCount} Server`, 'info', 'bot');
        if (d.running && d.step !== lastStatus.step) addLog(`⏳ ${d.step}`, 'info', 'api');
        if (!d.running && lastStatus.running === true) addLog('✅ Reset abgeschlossen!', 'success', 'api');
        lastStatus = { online: d.online, running: d.running, step: d.step, serverCount: d.serverCount, totalResets: d.stats?.totalResets };
    } catch (e) {}
}

// ============ STATUS ============
async function fetchStatus() {
    try {
        const r = await fetch(API_BASE + '/status');
        const d = await r.json();
        if (d.online) {
            statusDot.className = 'status-dot online';
            connectionStatus.textContent = '✅ ' + d.username;
            connectionStatus.style.color = '#00d26a';
            connectionRetries = 0;
        } else {
            statusDot.className = 'status-dot offline';
            connectionStatus.textContent = '⏳ Bot startet...';
            connectionStatus.style.color = '#fdcb6e';
        }
        serverCount.textContent = d.serverCount || 0;
        resetCount.textContent = d.stats?.totalResets || 0;
        if (d.running) {
            progressCard.style.display = 'block';
            progressFill.style.width = d.progressPercent + '%';
            progressText.textContent = d.step;
            progressLabel.textContent = 'Läuft...';
        } else if (d.step?.includes('Fertig')) progressLabel.textContent = 'Bereit ✅';
        if (d.stats?.history?.length > 0) updateHistory(d.stats.history);
        if (!d.running && resetBtn.disabled) { resetBtn.disabled = false; deleteOnlyBtn.disabled = false; fetchServers(); }
    } catch (e) {
        connectionRetries++;
        statusDot.className = 'status-dot offline';
        connectionStatus.textContent = '⏳ Server wacht auf...';
        connectionStatus.style.color = '#fdcb6e';
    }
}

async function fetchServers() {
    if (!userKey) {
        serverSelect.innerHTML = '<option value="">-- Bitte einloggen --</option>';
        return;
    }
    try {
        serverSelect.innerHTML = '<option value="">-- Lade... --</option>';
        const r = await fetch(API_BASE + '/servers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userKey: userKey })
        });
        
        if (r.status === 403) {
            serverSelect.innerHTML = '<option value="">-- Key ungültig --</option>';
            addLog('🔑 Key abgelaufen oder ungültig', 'error', 'system');
            return;
        }
        
        const s = await r.json();
        
        if (!Array.isArray(s) || s.length === 0) {
            serverSelect.innerHTML = '<option value="">-- Keine Admin-Server --</option>';
            return;
        }
        
        serverSelect.innerHTML = '<option value="">-- Server auswählen --</option>';
        s.forEach(s => {
            const o = document.createElement('option');
            o.value = s.id;
            o.textContent = s.name;
            serverSelect.appendChild(o);
        });
        
        addLog(`📡 ${s.length} Server geladen`, 'info', 'bot');
    } catch (e) {
        serverSelect.innerHTML = '<option value="">-- Fehler beim Laden --</option>';
        addLog('⚠️ Serverliste konnte nicht geladen werden', 'warning', 'system');
    }
}

function updateHistory(h) {
    historyList.innerHTML = h.slice(0, 10).map(h => `
        <div class="history-item"><span>🔄</span><div><strong>${h.server}</strong><div class="history-time">${new Date(h.timestamp).toLocaleString('de-DE')} • ${h.channelsCreated} Kanäle</div></div></div>
    `).join('');
}

async function doReset(del = false) {
    if (!userKey) { alert('Bitte zuerst einloggen!'); return; }
    if (!selectedServer) { alert('Bitte wähle einen Server!'); return; }
    
    const repeatMsg = parseInt(messageCount.value);
    const confirmMsg = del ? '⚠️ Wirklich ALLE Kanäle löschen?' : `⚠️ Server zurücksetzen?\n\n- ${channelCount.value} Kanäle "${channelName.value}-X"\n- Nachricht: "${channelMessage.value}"\n- ${repeatMsg}x pro Kanal`;
    if (!confirm(confirmMsg)) return;
    
    resetBtn.disabled = true;
    deleteOnlyBtn.disabled = true;
    progressCard.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Starte...';
    
    try {
        const e = del ? 'delete-channels' : 'reset';
        const b = del ? { userKey, serverId: selectedServer } : { userKey, serverId: selectedServer, channelCount: parseInt(channelCount.value), channelName: channelName.value, channelMessage: channelMessage.value, messageRepeat: parseInt(messageCount.value) };
        
        const r = await fetch(API_BASE + '/' + e, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b)
        });
        const d = await r.json();
        
        if (d.success) {
            addLog(`✅ Reset fertig • ${d.remainingResets} Resets übrig`, 'success', 'api');
        } else if (d.error) {
            alert('❌ ' + d.error);
            resetBtn.disabled = false;
            deleteOnlyBtn.disabled = false;
            progressCard.style.display = 'none';
        }
    } catch (e) {
        alert('❌ Netzwerkfehler');
        resetBtn.disabled = false;
        deleteOnlyBtn.disabled = false;
        progressCard.style.display = 'none';
    }
}

// ============ ADMIN PANEL ============
let adminPassword = '';

adminBtn.addEventListener('click', () => {
    const pw = prompt('🔐 Admin-Passwort:');
    if (!pw) return;
    adminPassword = pw;
    loadAdminPanel();
});

async function loadAdminPanel() {
    try {
        const r = await fetch(API_BASE + '/admin/keys', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword })
        });
        if (!r.ok) { alert('❌ Falsches Passwort!'); return; }
        
        const keys = await r.json();
        showAdminPanel(keys);
    } catch (e) { alert('❌ Fehler beim Laden'); }
}

function showAdminPanel(keys) {
    // Altes Panel entfernen
    const old = document.querySelector('.admin-panel');
    if (old) old.remove();
    
    const panel = document.createElement('div');
    panel.className = 'admin-panel';
    panel.innerHTML = `
        <div class="admin-card">
            <h2>👑 Admin-Menü</h2>
            
            <h3 style="color:var(--accent2);margin-top:16px;">➕ Neuer Key</h3>
            <input type="text" id="newKeyName" class="input" placeholder="Key-Name (z.B. SCHUELER-1)" style="margin-top:8px;">
            <input type="number" id="newKeyResets" class="input" placeholder="Max Resets" value="2" min="1" max="100" style="margin-top:4px;">
            <button id="createKeyBtn" class="btn btn-primary" style="margin-top:8px;">🔑 Key erstellen</button>
            
            <h3 style="color:var(--accent2);margin-top:16px;">📋 Alle Keys (${keys.length})</h3>
            <div id="keyList">
                ${keys.map(k => `
                    <div class="key-item">
                        <div class="key-info">
                            <strong>${k.key}</strong>
                            Resets: ${k.remainingResets} | Erstellt: ${new Date(k.created).toLocaleDateString('de-DE')}
                        </div>
                        <div class="key-actions">
                            <button class="btn-refill" onclick="refillKey('${k.key}')">+1</button>
                            <button class="btn-delete" onclick="deleteKey('${k.key}')">🗑️</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <button id="closeAdmin" class="btn btn-secondary" style="margin-top:16px;">Schließen</button>
        </div>
    `;
    
    document.body.appendChild(panel);
    
    document.getElementById('closeAdmin').addEventListener('click', () => panel.remove());
    document.getElementById('createKeyBtn').addEventListener('click', createKey);
}

async function createKey() {
    const name = document.getElementById('newKeyName').value.trim();
    const resets = document.getElementById('newKeyResets').value;
    if (!name) return alert('Key-Name eingeben!');
    
    try {
        const r = await fetch(API_BASE + '/admin/create-key', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, keyName: name, maxResets: resets })
        });
        const d = await r.json();
        if (d.success) { alert('✅ Key erstellt: ' + d.key.key); loadAdminPanel(); }
        else alert('❌ ' + d.error);
    } catch (e) { alert('❌ Fehler'); }
}

async function refillKey(key) {
    try {
        await fetch(API_BASE + '/admin/refill-key', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, key, amount: 1 })
        });
        loadAdminPanel();
    } catch (e) {}
}

async function deleteKey(key) {
    if (!confirm('Key "' + key + '" wirklich löschen?')) return;
    try {
        await fetch(API_BASE + '/admin/delete-key', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: adminPassword, key })
        });
        loadAdminPanel();
    } catch (e) {}
}
// Funktionen global machen für onclick
window.refillKey = refillKey;
window.deleteKey = deleteKey;

// ============ EVENT LISTENER ============
serverSelect.addEventListener('change', e => { selectedServer = e.target.value; });
channelCount.addEventListener('input', e => { channelCountDisplay.textContent = e.target.value; });
messageCount.addEventListener('input', e => { messageCountDisplay.textContent = e.target.value; });
resetBtn.addEventListener('click', () => doReset(false));
deleteOnlyBtn.addEventListener('click', () => doReset(true));
document.getElementById('refreshServers').addEventListener('click', fetchServers);

// ============ INIT ============
if (userKey) {
    addLog('🟢 Dashboard geladen', 'system', 'system');
    addLog('🔗 Warte auf Bot...', 'info', 'system');
    fetchStatus(); fetchServers(); fetchServerLogs();
    let fast = setInterval(() => { fetchStatus(); fetchServers(); fetchServerLogs(); }, 5000);
    setTimeout(() => { clearInterval(fast); setInterval(fetchStatus, 15000); setInterval(fetchServers, 30000); setInterval(fetchServerLogs, 15000); }, 120000);
}