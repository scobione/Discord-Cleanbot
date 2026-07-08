import { Client, GatewayIntentBits, PermissionsBitField, ChannelType } from 'discord.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let resetStats = {
    totalResets: 0,
    history: []
};

let currentProgress = {
    running: false,
    step: '',
    serverName: '',
    progressPercent: 0
};


// ============================================
// KEY-SYSTEM & ADMIN-PANEL
// ============================================

// Speicher für Keys (in Produktion durch Datenbank ersetzen!)
const keyStore = new Map(); // key -> { resetsLeft, createdAt }

// Master-Passwort für Admin-Panel (änderbar)
const ADMIN_PASSWORD = 'admin123'; // <-- HIER DEIN PASSWORT EINTRAGEN!

// ------------------------------------------------------------
// 1. KEY GENERIEREN (für Admin-Panel)
// ------------------------------------------------------------
function generateKey(resets = 2) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 8; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    keyStore.set(key, { resetsLeft: resets, createdAt: Date.now() });
    return key;
}

// ------------------------------------------------------------
// 2. KEY PRÜFEN & VERBRAUCHEN
// ------------------------------------------------------------
function useKey(key) {
    if (!keyStore.has(key)) return { valid: false, reason: 'Key existiert nicht' };
    
    const entry = keyStore.get(key);
    if (entry.resetsLeft <= 0) {
        keyStore.delete(key); // Aufbrauchen → löschen
        return { valid: false, reason: 'Key aufgebraucht' };
    }
    
    entry.resetsLeft--;
    if (entry.resetsLeft === 0) {
        keyStore.delete(key); // Nach letztem Reset löschen
    }
    return { valid: true, remaining: entry.resetsLeft };
}

// ------------------------------------------------------------
// 3. ADMIN-PANEL (HTML für Webinterface)
// ------------------------------------------------------------
function getAdminPanel() {
    let keyList = '';
    keyStore.forEach((entry, key) => {
        keyList += `
            <tr>
                <td><code>${key}</code></td>
                <td>${entry.resetsLeft}</td>
                <td>${new Date(entry.createdAt).toLocaleString()}</td>
                <td><button onclick="deleteKey('${key}')">❌ Löschen</button></td>
            </tr>
        `;
    });

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Cleanbot Admin-Panel</title>
        <style>
            body { font-family: Arial; margin: 40px; background: #2c2f33; color: #fff; }
            .container { max-width: 800px; margin: auto; background: #23272a; padding: 30px; border-radius: 10px; }
            input, button { padding: 10px; margin: 5px; border-radius: 5px; border: none; }
            input { background: #40444b; color: #fff; width: 200px; }
            button { background: #5865f2; color: #fff; cursor: pointer; }
            button:hover { background: #4752c4; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #40444b; }
            th { background: #2c2f33; }
            .delete-btn { background: #ed4245; }
            .delete-btn:hover { background: #c03537; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🔑 Cleanbot Admin-Panel</h1>
            
            <div style="margin: 20px 0;">
                <input type="number" id="resetCount" value="2" min="1" max="999">
                <button onclick="createKey()">➕ Neuen Key generieren</button>
            </div>
            
            <h3>Vorhandene Keys:</h3>
            <table>
                <thead>
                    <tr><th>Key</th><th>Resets übrig</th><th>Erstellt am</th><th>Aktion</th></tr>
                </thead>
                <tbody>
                    ${keyList || '<tr><td colspan="4">Keine Keys vorhanden</td></tr>'}
                </tbody>
            </table>
            
            <div style="margin-top: 30px; color: #888; font-size: 0.9em;">
                <p>💡 Ein Key mit 0 Resets wird automatisch gelöscht.</p>
            </div>
        </div>

        <script>
            function createKey() {
                const count = document.getElementById('resetCount').value;
                fetch('/admin/create-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ resets: parseInt(count) })
                })
                .then(r => r.json())
                .then(data => {
                    alert('✅ Neuer Key: ' + data.key);
                    location.reload();
                });
            }

            function deleteKey(key) {
                if (!confirm('Key ' + key + ' wirklich löschen?')) return;
                fetch('/admin/delete-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: key })
                })
                .then(() => location.reload());
            }
        </script>
    </body>
    </html>
    `;
}

// ============ BOT START ============
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ BOT_TOKEN nicht gesetzt!');
    process.exit(1);
}

client.login(TOKEN);

client.once('ready', () => {
    console.log(`✅ Bot online als ${client.user.tag}`);
    console.log(`📡 Auf ${client.guilds.cache.size} Servern`);
});

// ============ API ROUTEN ============

// Status
app.get('/api/status', (req, res) => {
    res.json({
        online: client.isReady(),
        username: client.user?.tag || 'Offline',
        serverCount: client.guilds.cache.size,
        ...currentProgress,
        stats: resetStats
    });
});

// Serverliste (nur mit Admin-Rechten)
app.get('/api/servers', (req, res) => {
    if (!client.isReady()) return res.json([]);
    
    const servers = client.guilds.cache
        .filter(g => {
            const botMember = g.members.me;
            return botMember?.permissions.has(PermissionsBitField.Flags.Administrator);
        })
        .map(g => ({
            id: g.id,
            name: g.name,
            icon: g.iconURL({ size: 64 }) || '',
            channelCount: g.channels.cache.size,
            memberCount: g.memberCount
        }));
    
    res.json(servers);
});

// Reset ausführen
app.post('/api/reset', async (req, res) => {
    const { serverId, channelCount, channelName, channelMessage, messageRepeat } = req.body;
    
    if (currentProgress.running) {
        return res.status(400).json({ error: 'Ein Reset läuft bereits' });
    }
    
    const guild = client.guilds.cache.get(serverId);
    if (!guild) return res.status(404).json({ error: 'Server nicht gefunden' });
    
    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return res.status(403).json({ error: 'Bot braucht Administrator-Rechte!' });
    }
    
    currentProgress = {
        running: true,
        step: 'Lösche alte Kanäle...',
        serverName: guild.name,
        progressPercent: 0
    };
    
    try {
        // 1. Alle löschbaren Kanäle entfernen
        const deletableChannels = guild.channels.cache.filter(c => c.deletable);
        const totalChannels = deletableChannels.size;
        let deleted = 0;
        
        for (const [_, channel] of deletableChannels) {
            await channel.delete().catch(() => {});
            deleted++;
            currentProgress.progressPercent = Math.floor((deleted / totalChannels) * 30);
            currentProgress.step = `Lösche Kanal ${deleted}/${totalChannels}...`;
            await new Promise(r => setTimeout(r, 300));
        }
        
        // 2. Log-Kanal erstellen
        currentProgress.step = 'Erstelle Log-Kanal...';
        currentProgress.progressPercent = 35;
        
        const logChannel = await guild.channels.create({
            name: '📋-server-log',
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionsBitField.Flags.SendMessages]
                }
            ]
        });
        
        // 3. Neue Kanäle erstellen
        const count = Math.min(parseInt(channelCount) || 5, 100);
        const name = channelName || 'kanal';
        const message = channelMessage || '✅ Kanal funktioniert einwandfrei!';
        const repeat = Math.min(parseInt(messageRepeat) || 1, 100);
        const createdChannels = [];
        
        for (let i = 1; i <= count; i++) {
            currentProgress.step = `Erstelle Kanal ${i}/${count}: ${name}-${i}`;
            currentProgress.progressPercent = 35 + Math.floor((i / count) * 50);
            
            const newChannel = await guild.channels.create({
                name: `${name}-${i}`,
                type: ChannelType.GuildText
            }).catch(err => {
                console.error(`Fehler bei ${name}-${i}:`, err.message);
                return null;
            });
            
            if (newChannel) {
                createdChannels.push(newChannel);
            }
            
            await new Promise(r => setTimeout(r, 500));
        }
        
        // 4. Nachrichten senden (mehrfach pro Kanal)
        for (const channel of createdChannels) {
            for (let m = 1; m <= repeat; m++) {
                currentProgress.step = `Nachricht ${m}/${repeat} in ${channel.name}...`;
                currentProgress.progressPercent = 85 + Math.floor((m / repeat) * 10);
                
                await channel.send({ content: message }).catch(err => {
                    console.error(`Fehler in ${channel.name}:`, err.message);
                });
                
                await new Promise(r => setTimeout(r, 500));
            }
        }
        
        // 5. Erfolgsmeldung
        currentProgress.step = 'Sende Bestätigung...';
        currentProgress.progressPercent = 98;
        
        await logChannel.send({
            content: `✅ **Server-Reset abgeschlossen!**\n\n` +
                `📊 **Statistik:**\n` +
                `- Gelöschte Kanäle: ${deleted}\n` +
                `- Neue Kanäle: ${count} × "${name}-X"\n` +
                `- Nachricht: "${message}"\n` +
                `- Pro Kanal: ${repeat}x gesendet\n` +
                `- Log-Kanal: ${logChannel.name}\n\n` +
                `🕐 ${new Date().toLocaleString('de-DE')}\n` +
                `🤖 Ausgeführt von: ${client.user.tag}`
        });
        
        resetStats.totalResets++;
        resetStats.history.unshift({
            server: guild.name,
            timestamp: Date.now(),
            channelsCreated: count
        });
        if (resetStats.history.length > 50) resetStats.history.pop();
        
        currentProgress = {
            running: false,
            step: '✅ Fertig!',
            serverName: guild.name,
            progressPercent: 100
        };
        
        res.json({
            success: true,
            message: `${count} Kanäle erstellt, je ${repeat}x Nachricht`,
            stats: resetStats
        });
        
    } catch (err) {
        currentProgress.running = false;
        currentProgress.step = '❌ Fehler!';
        res.status(500).json({ error: err.message });
    }
});

// Nur Kanäle löschen
app.post('/api/delete-channels', async (req, res) => {
    const { serverId } = req.body;
    const guild = client.guilds.cache.get(serverId);
    if (!guild) return res.status(404).json({ error: 'Server nicht gefunden' });
    
    currentProgress = {
        running: true,
        step: 'Lösche alle Kanäle...',
        serverName: guild.name,
        progressPercent: 0
    };
    
    const channels = guild.channels.cache.filter(c => c.deletable);
    let deleted = 0;
    
    for (const [_, ch] of channels) {
        await ch.delete().catch(() => {});
        deleted++;
        currentProgress.progressPercent = Math.floor((deleted / channels.size) * 100);
        currentProgress.step = `Kanal ${deleted}/${channels.size} gelöscht...`;
        await new Promise(r => setTimeout(r, 300));
    }
    
    currentProgress = {
        running: false,
        step: '✅ Alle Kanäle gelöscht',
        serverName: guild.name,
        progressPercent: 100
    };
    
    res.json({ success: true, deleted: deleted });
});

// ============================================
// 12. WEBSERVER FÜR KEY-VERWALTUNG
// ============================================
const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Admin-Panel mit Passwortabfrage
app.get('/admin', (req, res) => {
    const pw = req.query.password;
    if (!pw || pw !== ADMIN_PASSWORD) {
        return res.send(`
            <form method="GET">
                <h2>🔒 Admin-Login</h2>
                <input type="password" name="password" placeholder="Passwort eingeben" />
                <button type="submit">Login</button>
            </form>
        `);
    }
    res.send(getAdminPanel());
});

// API: Key erstellen
app.post('/admin/create-key', (req, res) => {
    const { resets } = req.body;
    if (!resets || resets < 1) return res.status(400).json({ error: 'Ungültige Anzahl' });
    const key = generateKey(resets);
    res.json({ key, resets });
});

// API: Key löschen
app.post('/admin/delete-key', (req, res) => {
    const { key } = req.body;
    keyStore.delete(key);
    res.json({ success: true });
});

// Öffentliche Seite – nur mit gültigem Key
app.get('/reset', (req, res) => {
    const key = req.query.key;
    if (!key) return res.send('❌ Bitte Key angeben: /reset?key=DEIN_KEY');
    
    const result = useKey(key);
    if (!result.valid) return res.send('❌ ' + result.reason);
    
    // HIER DEINE RESET-FUNKTION AUFRUFEN
    // resetServer(guild); // <-- Du musst hier deinen Server übergeben
    res.send(`✅ Reset durchgeführt! Noch ${result.remaining} Resets übrig.`);
});

app.listen(PORT, () => {
    console.log(`🌐 Admin-Panel: http://localhost:${PORT}/admin`);
    console.log(`🔑 Beispiel-Key: ${generateKey(2)} (für 2 Resets)`);
});


// Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 API & Dashboard laufen auf Port ${PORT}`);
});