import { Client, GatewayIntentBits, PermissionsBitField, ChannelType, EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } from 'discord.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

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

// ============ KONFIGURATION ============
const PROTECTED_SERVER_ID = '1524503955693113505'; // Dieser Server wird NIE im Dropdown angezeigt
const KEY_COMMAND_CHANNEL_ID = 'get-rdkey'; // In diesen Kanal wird das Embed gesendet
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ============ KEY-SYSTEM ============
let userKeys = [
    { key: 'DEMO-KEY-1234', remainingResets: 2, created: Date.now(), createdBy: 'System' },
    { key: 'SCHULE-2026', remainingResets: 5, created: Date.now(), createdBy: 'System' }
];

function generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const length = Math.floor(Math.random() * 4) + 15; // 15-18 Zeichen
    let key = '';
    for (let i = 0; i < length; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

function validateKey(userKey) {
    const key = userKeys.find(k => k.key === userKey);
    if (!key) return { valid: false, reason: 'Ungültiger Key' };
    if (key.remainingResets <= 0) return { valid: false, reason: 'Key hat keine Resets mehr' };
    return { valid: true, key: key };
}

function useReset(userKey) {
    const key = userKeys.find(k => k.key === userKey);
    if (key && key.remainingResets > 0) {
        key.remainingResets--;
        return true;
    }
    return false;
}

// ============ BOT ============
let resetStats = { totalResets: 0, history: [] };
let currentProgress = { running: false, step: '', serverName: '', progressPercent: 0 };

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) { console.error('❌ BOT_TOKEN nicht gesetzt!'); process.exit(1); }

client.login(TOKEN);

client.once('ready', async () => {
    console.log(`✅ Bot online als ${client.user.tag}`);
    console.log(`📡 Auf ${client.guilds.cache.size} Servern`);
    console.log(`🔑 ${userKeys.length} Keys geladen`);
    console.log(`🛡️ Server ${PROTECTED_SERVER_ID} ist geschützt`);
    
    // Key-Embed im Admin-Server senden
    await sendKeyCommandEmbed();
});

// ============ KEY-EMBED SENDEN ============
async function sendKeyCommandEmbed() {
    const guild = client.guilds.cache.get(PROTECTED_SERVER_ID);
    if (!guild) return console.log('⚠️ Admin-Server nicht gefunden');
    
    // Kanal finden
    const channel = guild.channels.cache.find(c => c.name === KEY_COMMAND_CHANNEL_ID || c.id === KEY_COMMAND_CHANNEL_ID);
    if (!channel) return console.log('⚠️ Key-Command-Kanal nicht gefunden');
    
    // Alte Nachrichten löschen (optional)
    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMessages = messages.filter(m => m.author.id === client.user.id);
        for (const [_, msg] of botMessages) {
            await msg.delete().catch(() => {});
        }
    } catch (e) {}
    
    const embed = new EmbedBuilder()
        .setTitle('🔑 Key-Generator')
        .setDescription('Erstelle hier neue Zugangsschlüssel für das **Server Manager Dashboard**.\n\n' +
            '**So funktioniert\'s:**\n' +
            '1️⃣ Wähle die Anzahl der Resets aus\n' +
            '2️⃣ Klicke auf **"Key erstellen"**\n' +
            '3️⃣ Der Key wird in einem privaten Kanal angezeigt\n\n' +
            '━━━━━━━━━━━━━━━━━━━━━━━━━')
        .setColor(0x6c5ce7)
        .addFields(
            { name: '📊 Vorhandene Keys', value: `${userKeys.length} Keys gespeichert`, inline: true },
            { name: '🔄 Resets gesamt', value: `${resetStats.totalResets} durchgeführt`, inline: true },
            { name: '🛡️ Geschützter Server', value: `ID: ${PROTECTED_SERVER_ID}`, inline: false }
        )
        .setFooter({ text: 'Server Manager • Key-System', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();
    
    // Auswahl-Menü für Anzahl Resets
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('key_resets_select')
        .setPlaceholder('Anzahl der Resets auswählen')
        .addOptions([
            { label: '1 Reset', value: '1', emoji: '1️⃣' },
            { label: '2 Resets', value: '2', emoji: '2️⃣' },
            { label: '3 Resets', value: '3', emoji: '3️⃣' },
            { label: '5 Resets', value: '5', emoji: '5️⃣' },
            { label: '10 Resets', value: '10', emoji: '🔟' },
            { label: '25 Resets', value: '25', emoji: '💎' },
            { label: '50 Resets', value: '50', emoji: '👑' },
            { label: 'Unbegrenzt (999)', value: '999', emoji: '♾️' }
        ]);
    
    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    await channel.send({ embeds: [embed], components: [row] });
    console.log('✅ Key-Embed gesendet');
}

// ============ INTERACTION HANDLER ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
    
    // Dropdown: Anzahl Resets ausgewählt
    if (interaction.customId === 'key_resets_select') {
        const selectedResets = interaction.values[0];
        
        // Modal für Key-Name öffnen
        const modal = new ModalBuilder()
            .setCustomId(`key_modal_${selectedResets}`)
            .setTitle('Neuen Key erstellen');
        
        const nameInput = new TextInputBuilder()
            .setCustomId('key_name')
            .setLabel('Name für den Key')
            .setPlaceholder('z.B. Team-A, Schüler-1, Projekt-X')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(30);
        
        const row = new ActionRowBuilder().addComponents(nameInput);
        modal.addComponents(row);
        
        await interaction.showModal(modal);
    }
    
    // Modal: Key-Name eingegeben → Key generieren
    if (interaction.customId.startsWith('key_modal_')) {
        const resets = parseInt(interaction.customId.split('_')[2]);
        const keyName = interaction.fields.getTextInputValue('key_name');
        
        // Key generieren
        const newKeyValue = generateKey();
        const displayResets = resets === 999 ? 'Unbegrenzt' : resets;
        
        // Key speichern
        userKeys.push({
            key: newKeyValue,
            remainingResets: resets,
            created: Date.now(),
            createdBy: interaction.user.tag
        });
        
        // Privaten Kanal finden/erstellen für Key-Ausgabe
        const guild = interaction.guild;
        let keyChannel = guild.channels.cache.find(c => c.name === '🔑-key-log' && c.type === ChannelType.GuildText);
        
        if (!keyChannel) {
            keyChannel = await guild.channels.create({
                name: '🔑-key-log',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: client.user.id,
                        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
                    }
                ]
            });
            
            // Admin-Rollen hinzufügen
            guild.roles.cache
                .filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator))
                .forEach(r => {
                    keyChannel.permissionOverwrites.create(r, {
                        ViewChannel: true,
                        SendMessages: false
                    }).catch(() => {});
                });
        }
        
        // Key-Embed im privaten Kanal senden
        const keyEmbed = new EmbedBuilder()
            .setTitle('🔑 Neuer Key erstellt')
            .setDescription(`Ein neuer Zugangsschlüssel wurde generiert.`)
            .setColor(0x00d26a)
            .addFields(
                { name: '📛 Name', value: keyName, inline: true },
                { name: '🔄 Resets', value: `${displayResets}`, inline: true },
                { name: '🔑 Key', value: `\`\`\`${newKeyValue}\`\`\``, inline: false },
                { name: '👤 Erstellt von', value: interaction.user.tag, inline: true },
                { name: '📅 Datum', value: new Date().toLocaleString('de-DE'), inline: true }
            )
            .setFooter({ text: 'Server Manager • Key-System' })
            .setTimestamp();
        
        await keyChannel.send({ embeds: [keyEmbed] });
        
        // Antwort an den Ersteller (ephemeral)
        await interaction.reply({
            content: `✅ Key erfolgreich erstellt!\n\n🔑 **Key:** \`${newKeyValue}\`\n🔄 **Resets:** ${displayResets}\n📛 **Name:** ${keyName}\n\nDer Key wurde auch in ${keyChannel} hinterlegt.`,
            ephemeral: true
        });
        
        console.log(`🔑 Key erstellt: ${keyName} (${resets} Resets) von ${interaction.user.tag}`);
        
        // Key-Embed im Befehlskanal aktualisieren
        await sendKeyCommandEmbed();
    }
});

// ============ API ROUTEN ============

app.get('/api/status', (req, res) => {
    res.json({
        online: client.isReady(),
        username: client.user?.tag || 'Offline',
        serverCount: client.guilds.cache.size,
        ...currentProgress,
        stats: resetStats
    });
});

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

app.post('/api/servers', (req, res) => {
    const { userKey } = req.body;
    const keyCheck = validateKey(userKey);
    if (!keyCheck.valid) return res.status(403).json({ error: keyCheck.reason });
    
    if (!client.isReady()) return res.json([]);
    
    const servers = client.guilds.cache
        .filter(g => {
            // Geschützten Server ausschließen
            if (g.id === PROTECTED_SERVER_ID) return false;
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

app.post('/api/reset', async (req, res) => {
    const { userKey, serverId, channelCount, channelName, channelMessage, messageRepeat } = req.body;
    
    // Geschützten Server blockieren
    if (serverId === PROTECTED_SERVER_ID) {
        return res.status(403).json({ error: 'Dieser Server ist geschützt!' });
    }
    
    const keyCheck = validateKey(userKey);
    if (!keyCheck.valid) return res.status(403).json({ error: keyCheck.reason });
    
    if (currentProgress.running) return res.status(400).json({ error: 'Ein Reset läuft bereits' });
    
    const guild = client.guilds.cache.get(serverId);
    if (!guild) return res.status(404).json({ error: 'Server nicht gefunden' });
    
    if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return res.status(403).json({ error: 'Bot braucht Administrator-Rechte!' });
    }
    
    currentProgress = { running: true, step: 'Lösche alte Kanäle...', serverName: guild.name, progressPercent: 0 };
    
    try {
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
        
        currentProgress.step = 'Erstelle Log-Kanal...';
        currentProgress.progressPercent = 35;
        
        const logChannel = await guild.channels.create({
            name: '📋-server-log',
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.SendMessages] }]
        });
        
        const count = Math.min(parseInt(channelCount) || 5, 10);
        const name = channelName || 'kanal';
        const message = channelMessage || '✅ Kanal funktioniert einwandfrei!';
        const repeat = Math.min(parseInt(messageRepeat) || 1, 10);
        const createdChannels = [];
        
        for (let i = 1; i <= count; i++) {
            currentProgress.step = `Erstelle Kanal ${i}/${count}: ${name}-${i}`;
            currentProgress.progressPercent = 35 + Math.floor((i / count) * 50);
            const ch = await guild.channels.create({ name: `${name}-${i}`, type: ChannelType.GuildText }).catch(() => null);
            if (ch) createdChannels.push(ch);
            await new Promise(r => setTimeout(r, 500));
        }
        
        for (const channel of createdChannels) {
            for (let m = 1; m <= repeat; m++) {
                currentProgress.step = `Nachricht ${m}/${repeat} in ${channel.name}...`;
                currentProgress.progressPercent = 85 + Math.floor((m / repeat) * 10);
                await channel.send({ content: message }).catch(() => {});
                await new Promise(r => setTimeout(r, 500));
            }
        }
        
        useReset(userKey);
        
        currentProgress.step = 'Sende Bestätigung...';
        currentProgress.progressPercent = 98;
        
        await logChannel.send({
            content: `✅ **Server-Reset abgeschlossen!**\n\n📊 Gelöscht: ${deleted} | Neu: ${count} × "${name}-X"\n📨 Nachricht: "${message}" (${repeat}x pro Kanal)\n🔑 Verbleibende Resets: ${keyCheck.key.remainingResets - 1}\n🕐 ${new Date().toLocaleString('de-DE')}`
        });
        
        resetStats.totalResets++;
        resetStats.history.unshift({ server: guild.name, timestamp: Date.now(), channelsCreated: count });
        if (resetStats.history.length > 50) resetStats.history.pop();
        
        currentProgress = { running: false, step: '✅ Fertig!', serverName: guild.name, progressPercent: 100 };
        
        res.json({ success: true, message: `${count} Kanäle erstellt`, remainingResets: keyCheck.key.remainingResets - 1, stats: resetStats });
    } catch (err) {
        currentProgress = { running: false, step: '❌ Fehler!', serverName: guild.name, progressPercent: 0 };
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/delete-channels', async (req, res) => {
    const { userKey, serverId } = req.body;
    
    if (serverId === PROTECTED_SERVER_ID) {
        return res.status(403).json({ error: 'Dieser Server ist geschützt!' });
    }
    
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
    res.json({ success: true, deleted, remainingResets: keyCheck.key.remainingResets - 1 });
});

// ============ ADMIN ROUTEN ============
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) return res.json({ success: true });
    res.status(403).json({ error: 'Falsches Passwort' });
});

app.post('/api/admin/keys', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    res.json(userKeys.map(k => ({ key: k.key, remainingResets: k.remainingResets, created: k.created, createdBy: k.createdBy })));
});

app.post('/api/admin/create-key', (req, res) => {
    const { password, keyName, maxResets } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    if (!keyName || !maxResets) return res.status(400).json({ error: 'Key-Name und Resets erforderlich' });
    
    const newKey = { key: generateKey(), remainingResets: parseInt(maxResets), created: Date.now(), createdBy: 'Admin' };
    userKeys.push(newKey);
    res.json({ success: true, key: newKey });
});

app.post('/api/admin/delete-key', (req, res) => {
    const { password, key } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    userKeys = userKeys.filter(k => k.key !== key);
    res.json({ success: true });
});

app.post('/api/admin/refill-key', (req, res) => {
    const { password, key, amount } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    const foundKey = userKeys.find(k => k.key === key);
    if (!foundKey) return res.status(404).json({ error: 'Key nicht gefunden' });
    foundKey.remainingResets += parseInt(amount);
    res.json({ success: true, key: foundKey });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 API & Dashboard laufen auf Port ${PORT}`));