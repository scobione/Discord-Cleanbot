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
        if (d.online) { statusDot.class