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

// Statische Dateien aus public-Ordner (absoluter Pfad)
app.use(express.static(path.join(__dirname, 'public')));

// Log-Historie für Dashboard
let serverLogs = [];

function serverLog(message, type = 'info', category = 'system') {
    const entry = {
        timestamp: new Date().toISOString(),
        message,
        type,
        category
    };
    serverLogs.unshift(entry);
    if (serverLogs.length > 100) serverLogs.pop();
    console.log(`[${category.toUpperCase()}] ${message}`);
}
// Startseite
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
    const { serverId, channelCount, channelName } = req.body;
    
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
        const count = Math.min(parseInt(channelCount) || 5, 50);
        const name = channelName || 'kanal';
        const message = req.body.channelMessage || '✅ Kanal bereit!';
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
        
        // 3b. Nachricht in jeden Kanal senden
        currentProgress.step = `Sende Nachrichten...`;
        currentProgress.progressPercent = 85;
        
        for (const channel of createdChannels) {
            await channel.send({ content: message }).catch(err => {
                console.error(`Fehler beim Senden in ${channel.name}:`, err.message);
            });
            await new Promise(r => setTimeout(r, 300));
        }
        
        // 4. Erfolgsmeldung
        currentProgress.step = 'Sende Bestätigung...';
        currentProgress.progressPercent = 98;
        
        await logChannel.send({
            content: `✅ **Server-Reset abgeschlossen!**\n\n` +
                `📊 **Statistik:**\n` +
                `- Gelöschte Kanäle: ${deleted}\n` +
                `- Neue Kanäle: ${count} × "${name}-X"\n` +
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
            message: `${count} Kanäle erstellt, ${deleted} gelöscht`,
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

// Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 API & Dashboard laufen auf Port ${PORT}`);
});