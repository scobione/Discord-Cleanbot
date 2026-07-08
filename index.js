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

// ============ KEY-SYSTEM ============
// Standard-Keys (werden beim Start geladen, falls keine gespeichert sind)
let userKeys = [
    { key: 'DEMO-KEY-1234', remainingResets: 2, created: Date.now(), createdBy: 'System' },
    { key: 'SCHULE-2026', remainingResets: 5, created: Date.now(), createdBy: 'System' }
];

// Admin-Passwort
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Key prüfen
function validateKey(userKey) {
    const key = userKeys.find(k => k.key === userKey);
    if (!key) return { valid: false, reason: 'Ungültiger Key' };
    if (key.remainingResets <= 0) return { valid: false, reason: 'Key hat keine Resets mehr' };
    return { valid: true, key: key };
}

// Reset verbrauchen
function useReset(userKey) {
    const key = userKeys.find(k => k.key === userKey);
    if (key && key.remainingResets > 0) {
        key.remainingResets--;
        return true;
    }
    return false;
}

// ============ BOT ============
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

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ BOT_TOKEN nicht gesetzt!');
    process.exit(1);
}

client.login(TOKEN);

client.once('ready', () => {
    console.log(`✅ Bot online als ${client.user.tag}`);
    console.log(`📡 Auf ${client.guilds.cache.size} Servern`);
    console.log(`🔑 ${userKeys.length} Keys geladen`);
});

// ============ API ROUTEN ============

// Status (ohne Key-Prüfung, nur Info)
app.get('/api/status', (req, res) => {
    res.json({
        online: client.isReady(),
        username: client.user?.tag || 'Offline',
        serverCount: client.guilds.cache.size,
        ...currentProgress,
        stats: resetStats
    });
});

// Key validieren
app.post('/api/validate-key', (req, res) => {
    const { userKey } = req.body;
    if (!userKey) return res.json({ valid: false, reason: 'Kein Key angegeben' });
    
    const result = validateKey(userKey);
    res.json({
        valid: result.valid,
        reason: result.reason,
        remainingResets: result.key?.remainingResets || 0
    });
});

// Serverliste (benötigt gültigen Key)
app.post('/api/servers', (req, res) => {
    const { userKey } = req.body;
    const keyCheck = validateKey(userKey);
    if (!keyCheck.valid) return res.status(403).json({ error: keyCheck.reason });
    
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

// Reset ausführen (benötigt gültigen Key + verbraucht einen Reset)
app.post('/api/reset', async (req, res) => {
    const { userKey, serverId, channelCount, channelName, channelMessage, messageRepeat } = req.body;
    
    const keyCheck = validateKey(userKey);
    if (!keyCheck.valid) return res.status(403).json({ error: keyCheck.reason });
    
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
        // 1. Kanäle löschen
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
        
        // 2. Log-Kanal
        currentProgress.step = 'Erstelle Log-Kanal...';
        currentProgress.progressPercent = 35;
        
        const logChannel = await guild.channels.create({
            name: '📋-server-log',
            type: ChannelType.GuildText,
            permissionOverwrites: [{
                id: guild.roles.everyone.id,
                deny: [PermissionsBitField.Flags.SendMessages]
            }]
        });
        
        // 3. Neue Kanäle
        const count = Math.min(parseInt(channelCount) || 5, 10);
        const name = channelName || 'kanal';
        const message = channelMessage || '✅ Kanal funktioniert einwandfrei!';
        const repeat = Math.min(parseInt(messageRepeat) || 1, 10);
        const createdChannels = [];
        
        for (let i = 1; i <= count; i++) {
            currentProgress.step = `Erstelle Kanal ${i}/${count}: ${name}-${i}`;
            currentProgress.progressPercent = 35 + Math.floor((i / count) * 50);
            
            const newChannel = await guild.channels.create({
                name: `${name}-${i}`,
                type: ChannelType.GuildText
            }).catch(() => null);
            
            if (newChannel) createdChannels.push(newChannel);
            await new Promise(r => setTimeout(r, 500));
        }
        
        // 4. Nachrichten senden
        for (const channel of createdChannels) {
            for (let m = 1; m <= repeat; m++) {
                currentProgress.step = `Nachricht ${m}/${repeat} in ${channel.name}...`;
                currentProgress.progressPercent = 85 + Math.floor((m / repeat) * 10);
                await channel.send({ content: message }).catch(() => {});
                await new Promise(r => setTimeout(r, 500));
            }
        }
        
        // Reset verbrauchen
        useReset(userKey);
        
        // 5. Bestätigung
        currentProgress.step = 'Sende Bestätigung...';
        currentProgress.progressPercent = 98;
        
        await logChannel.send({
            content: `✅ **Server-Reset abgeschlossen!**\n\n` +
                `📊 Gelöscht: ${deleted} | Neu: ${count} × "${name}-X"\n` +
                `📨 Nachricht: "${message}" (${repeat}x pro Kanal)\n` +
                `🔑 Verbleibende Resets: ${keyCheck.key.remainingResets - 1}\n` +
                `🕐 ${new Date().toLocaleString('de-DE')}`
        });
        
        resetStats.totalResets++;
        resetStats.history.unshift({
            server: guild.name,
            timestamp: Date.now(),
            channelsCreated: count
        });
        if (resetStats.history.length > 50) resetStats.history.pop();
        
        currentProgress = { running: false, step: '✅ Fertig!', serverName: guild.name, progressPercent: 100 };
        
        res.json({
            success: true,
            message: `${count} Kanäle erstellt`,
            remainingResets: keyCheck.key.remainingResets - 1,
            stats: resetStats
        });
        
    } catch (err) {
        currentProgress = { running: false, step: '❌ Fehler!', serverName: guild.name, progressPercent: 0 };
        res.status(500).json({ error: err.message });
    }
});

// Nur Kanäle löschen (benötigt gültigen Key + verbraucht Reset)
app.post('/api/delete-channels', async (req, res) => {
    const { userKey, serverId } = req.body;
    
    const keyCheck = validateKey(userKey);
    if (!keyCheck.valid) return res.status(403).json({ error: keyCheck.reason });
    
    const guild = client.guilds.cache.get(serverId);
    if (!guild) return res.status(404).json({ error: 'Server nicht gefunden' });
    
    currentProgress = { running: true, step: 'Lösche alle Kanäle...', serverName: guild.name, progressPercent: 0 };
    
    const channels = guild.channels.cache.filter(c => c.deletable);
    let deleted = 0;
    
    for (const [_, ch] of channels) {
        await ch.delete().catch(() => {});
        deleted++;
        currentProgress.progressPercent = Math.floor((deleted / channels.size) * 100);
        await new Promise(r => setTimeout(r, 300));
    }
    
    useReset(userKey);
    
    currentProgress = { running: false, step: '✅ Alle Kanäle gelöscht', serverName: guild.name, progressPercent: 100 };
    res.json({ success: true, deleted: deleted, remainingResets: keyCheck.key.remainingResets - 1 });
});

// ============ ADMIN-ROUTEN ============

// Admin-Login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        return res.json({ success: true, token: 'admin-session-' + Date.now() });
    }
    res.status(403).json({ error: 'Falsches Passwort' });
});

// Alle Keys anzeigen (Admin)
app.post('/api/admin/keys', (req, res) => {
    const { adminToken, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    
    res.json(userKeys.map(k => ({
        key: k.key,
        remainingResets: k.remainingResets,
        created: k.created,
        createdBy: k.createdBy
    })));
});

// Neuen Key erstellen (Admin)
app.post('/api/admin/create-key', (req, res) => {
    const { password, keyName, maxResets } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    if (!keyName || !maxResets) return res.status(400).json({ error: 'Key-Name und Resets erforderlich' });
    
    const newKey = {
        key: keyName.toUpperCase().replace(/\s/g, '-'),
        remainingResets: parseInt(maxResets),
        created: Date.now(),
        createdBy: 'Admin'
    };
    
    userKeys.push(newKey);
    res.json({ success: true, key: newKey });
});

// Key löschen (Admin)
app.post('/api/admin/delete-key', (req, res) => {
    const { password, key } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    
    userKeys = userKeys.filter(k => k.key !== key);
    res.json({ success: true });
});

// Key-Resets erhöhen (Admin)
app.post('/api/admin/refill-key', (req, res) => {
    const { password, key, amount } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    
    const foundKey = userKeys.find(k => k.key === key);
    if (!foundKey) return res.status(404).json({ error: 'Key nicht gefunden' });
    
    foundKey.remainingResets += parseInt(amount);
    res.json({ success: true, key: foundKey });
});

// Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 API & Dashboard laufen auf Port ${PORT}`);
});