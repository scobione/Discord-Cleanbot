const API_BASE = window.location.origin + '/api';
let selectedServer = null;
let connectionRetries = 0;

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

apiUrl.textContent = API_BASE;

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

function clearLogs() {
    logEntries = [];
    logContainer.innerHTML = '<div class="log-entry log-system">🟢 Logs geleert</div>';
}

clearLogsBtn.addEventListener('click', clearLogs);

let lastStatus = { online: null, running: null, step: null, serverCount: null, totalResets: null };

async function fetchServerLogs() {
    try {
        const r = await fetch(API_BASE + '/status');
        const d = await r.json();
        
        if (d.online !== lastStatus.online) {
            addLog(d.online ? `✅ Bot online: ${d.username}` : '❌ Bot offline', d.online ? 'success' : 'error', 'bot');
        }
        
        if (d.serverCount !== lastStatus.serverCount) {
            addLog(`📡 ${d.serverCount} Server mit Admin-Rechten`, 'info', 'bot');
        }
        
        if (d.running && d.step !== lastStatus.step) {
            addLog(`⏳ ${d.step} (${d.progressPercent}%)`, 'info', 'api');
        }
        
        if (d.step?.includes('Sende Nachrichten') || d.step?.includes('Nachricht')) {
            addLog(`📨 ${d.step}`, 'info', 'api');
        }
        
        if (!d.running && lastStatus.running === true) {
            addLog('✅ Reset erfolgreich abgeschlossen!', 'success', 'api');
        }
        
        if (d.stats?.totalResets !== lastStatus.totalResets && d.stats?.totalResets > 0) {
            addLog(`🔄 Reset #${d.stats.totalResets} durchgeführt`, 'success', 'bot');
        }
        
        lastStatus = { online: d.online, running: d.running, step: d.step, serverCount: d.serverCount, totalResets: d.stats?.totalResets };
        
    } catch (e) {
        // silent fail
    }
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
        } else if (d.step?.includes('Fertig')) {
            progressLabel.textContent = 'Bereit ✅';
        }
        
        if (d.stats?.history?.length > 0) {
            updateHistory(d.stats.history);
        }
        
        if (!d.running && resetBtn.disabled) {
            resetBtn.disabled = false;
            deleteOnlyBtn.disabled = false;
            fetchServers();
        }
        
    } catch (e) {
        connectionRetries++;
        statusDot.className = 'status-dot offline ugly-green';
        
        if (connectionRetries < 3) {
            connectionStatus.textContent = '⏳ Server wacht auf...';
            connectionStatus.style.color = '#fdcb6e';
        } else if (connectionRetries < 8) {
            connectionStatus.textContent = '⏳ Noch ' + (8 - connectionRetries) + ' Versuche...';
            connectionStatus.style.color = '#fdcb6e';
        } else {
            connectionStatus.textContent = '⚠️ Keine Verbindung (lädt neu...)';
            connectionStatus.style.color = '#e74c3c';
            if (connectionRetries > 15) {
                location.reload();
            }
        }
    }
}

async function fetchServers() {
    try {
        serverSelect.innerHTML = '<option value="">-- Lade... --</option>';
        const r = await fetch(API_BASE + '/servers');
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
    } catch (e) {
        serverSelect.innerHTML = '<option value="">-- Fehler --</option>';
    }
}

function updateHistory(h) {
    historyList.innerHTML = h.slice(0, 10).map(h => `
        <div class="history-item">
            <span>🔄</span>
            <div>
                <strong>${h.server}</strong>
                <div class="history-time">${new Date(h.timestamp).toLocaleString('de-DE')} • ${h.channelsCreated} Kanäle</div>
            </div>
        </div>
    `).join('');
}

async function doReset(del = false) {
    if (!selectedServer) { alert('Bitte wähle einen Server!'); return; }
    
    const repeatMsg = parseInt(messageCount.value);
    const confirmMsg = del 
        ? '⚠️ Wirklich ALLE Kanäle löschen?' 
        : `⚠️ Server zurücksetzen?\n\n` +
          `- ${channelCount.value} Kanäle "${channelName.value}-X"\n` +
          `- Nachricht: "${channelMessage.value}"\n` +
          `- ${repeatMsg}x pro Kanal senden`;
    
    if (!confirm(confirmMsg)) return;
    
    resetBtn.disabled = true;
    deleteOnlyBtn.disabled = true;
    progressCard.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Starte...';
    
    try {
        const e = del ? 'delete-channels' : 'reset';
        const b = del ? { serverId: selectedServer } : {
            serverId: selectedServer,
            channelCount: parseInt(channelCount.value),
            channelName: channelName.value,
            channelMessage: channelMessage.value,
            messageRepeat: parseInt(messageCount.value)
        };
        
        const r = await fetch(API_BASE + '/' + e, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(b)
        });
        
        const d = await r.json();
        
        if (!d.success && d.error) {
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

// ============ EVENT LISTENER ============
serverSelect.addEventListener('change', e => { selectedServer = e.target.value; });
channelCount.addEventListener('input', e => { channelCountDisplay.textContent = e.target.value; });
messageCount.addEventListener('input', e => { messageCountDisplay.textContent = e.target.value; });
resetBtn.addEventListener('click', () => doReset(false));
deleteOnlyBtn.addEventListener('click', () => doReset(true));
document.getElementById('refreshServers').addEventListener('click', fetchServers);

// ============ INIT ============
addLog('🟢 Dashboard geladen', 'system', 'system');
addLog('🔗 Warte auf Bot-Verbindung...', 'info', 'system');

fetchStatus();
fetchServers();
fetchServerLogs();

let fastPolling = setInterval(() => {
    fetchStatus();
    fetchServers();
    fetchServerLogs();
}, 5000);

setTimeout(() => {
    clearInterval(fastPolling);
    setInterval(fetchStatus, 15000);
    setInterval(fetchServers, 30000);
    setInterval(fetchServerLogs, 15000);
}, 120000);