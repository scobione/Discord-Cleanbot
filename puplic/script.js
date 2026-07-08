// ============ KONFIGURATION ============
// URL wird automatisch erkannt
const API_BASE = window.location.origin + '/api';
// ======================================

let selectedServer = null;

const statusDot = document.getElementById('statusDot');
const connectionStatus = document.getElementById('connectionStatus');
const serverCount = document.getElementById('serverCount');
const resetCount = document.getElementById('resetCount');
const progressLabel = document.getElementById('progressLabel');
const serverSelect = document.getElementById('serverSelect');
const channelName = document.getElementById('channelName');
const channelCount = document.getElementById('channelCount');
const channelCountDisplay = document.getElementById('channelCountDisplay');
const resetBtn = document.getElementById('resetBtn');
const deleteOnlyBtn = document.getElementById('deleteOnlyBtn');
const progressCard = document.getElementById('progressCard');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const historyList = document.getElementById('historyList');
const apiUrl = document.getElementById('apiUrl');

apiUrl.textContent = API_BASE;

async function fetchStatus() {
    try {
        const res = await fetch(`${API_BASE}/status`);
        const data = await res.json();
        
        if (data.online) {
            statusDot.className = 'status-dot online';
            connectionStatus.textContent = `✅ ${data.username}`;
        } else {
            statusDot.className = 'status-dot offline';
            connectionStatus.textContent = '❌ Bot offline';
        }
        
        serverCount.textContent = data.serverCount || 0;
        resetCount.textContent = data.stats?.totalResets || 0;
        
        if (data.running) {
            progressCard.style.display = 'block';
            progressFill.style.width = data.progressPercent + '%';
            progressText.textContent = data.step;
            progressLabel.textContent = 'Läuft...';
        } else if (data.step?.includes('Fertig')) {
            progressLabel.textContent = 'Bereit ✅';
        }
        
        if (data.stats?.history?.length > 0) {
            updateHistory(data.stats.history);
        }
        
        if (!data.running && resetBtn.disabled) {
            resetBtn.disabled = false;
            deleteOnlyBtn.disabled = false;
            fetchServers();
        }
        
    } catch (err) {
        statusDot.className = 'status-dot offline';
        connectionStatus.textContent = '⚠️ Keine Verbindung';
    }
}

async function fetchServers() {
    try {
        serverSelect.innerHTML = '<option value="">-- Lade... --</option>';
        const res = await fetch(`${API_BASE}/servers`);
        const servers = await res.json();
        
        if (!Array.isArray(servers) || servers.length === 0) {
            serverSelect.innerHTML = '<option value="">-- Keine Admin-Server --</option>';
            return;
        }
        
        serverSelect.innerHTML = '<option value="">-- Server auswählen --</option>';
        servers.forEach(s => {
            const option = document.createElement('option');
            option.value = s.id;
            option.textContent = s.name;
            serverSelect.appendChild(option);
        });
    } catch (err) {
        serverSelect.innerHTML = '<option value="">-- Fehler --</option>';
    }
}

function updateHistory(history) {
    historyList.innerHTML = history.slice(0, 10).map(h => `
        <div class="history-item">
            <span>🔄</span>
            <div>
                <strong>${h.server}</strong>
                <div class="history-time">${new Date(h.timestamp).toLocaleString('de-DE')} • ${h.channelsCreated} Kanäle</div>
            </div>
        </div>
    `).join('');
}

async function doReset(deleteOnly = false) {
    if (!selectedServer) {
        alert('Bitte wähle einen Server aus!');
        return;
    }
    
    if (!confirm(deleteOnly 
        ? '⚠️ Wirklich ALLE Kanäle löschen?'
        : `⚠️ Server zurücksetzen?\n\nAlle Kanäle löschen & ${channelCount.value} neue "${channelName.value}-X" erstellen?`
    )) return;
    
    resetBtn.disabled = true;
    deleteOnlyBtn.disabled = true;
    progressCard.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Starte...';
    
    try {
        const endpoint = deleteOnly ? 'delete-channels' : 'reset';
        const body = deleteOnly 
            ? { serverId: selectedServer }
            : { serverId: selectedServer, channelCount: parseInt(channelCount.value), channelName: channelName.value };
        
        const res = await fetch(`${API_BASE}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        const data = await res.json();
        
        if (!data.success && data.error) {
            alert('❌ ' + data.error);
            resetBtn.disabled = false;
            deleteOnlyBtn.disabled = false;
            progressCard.style.display = 'none';
        }
    } catch (err) {
        alert('❌ Netzwerkfehler');
        resetBtn.disabled = false;
        deleteOnlyBtn.disabled = false;
        progressCard.style.display = 'none';
    }
}

serverSelect.addEventListener('change', e => { selectedServer = e.target.value; });
channelCount.addEventListener('input', e => { channelCountDisplay.textContent = e.target.value; });
resetBtn.addEventListener('click', () => doReset(false));
deleteOnlyBtn.addEventListener('click', () => doReset(true));
document.getElementById('refreshServers').addEventListener('click', fetchServers);

fetchStatus();
fetchServers();
setInterval(fetchStatus, 3000);