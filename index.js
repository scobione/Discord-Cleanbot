import { Client, GatewayIntentBits, PermissionsBitField, ChannelType, EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } from 'discord.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { MongoClient } from 'mongodb';

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
const PROTECTED_SERVER_ID = '1524503955693113505';
const KEY_COMMAND_CHANNEL_ID = 'get-rdkey';
const LOG_CATEGORY_NAME = 'Resettet Server';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MONGO_URI = process.env.MONGO_URI || '';

// ============ MONGODB ============
let db = null;

async function connectDB() {
    if (!MONGO_URI) {
        console.log('⚠️ Keine MONGO_URI – Keys werden nur im RAM gespeichert');
        return;
    }
    try {
        const mongoClient = new MongoClient(MONGO_URI);
        await mongoClient.connect();
        db = mongoClient.db('server-manager');
        console.log('✅ MongoDB verbunden');

        const keysCollection = db.collection('keys');
        const savedKeys = await keysCollection.find().toArray();
        if (savedKeys.length > 0) {
            userKeys = savedKeys.map(k => ({
                key: k.key,
                remainingResets: k.remainingResets,
                created: k.created,
                createdBy: k.createdBy
            }));
            console.log(`📂 ${userKeys.length} Keys aus DB geladen`);
        }
    } catch (e) {
        console.error('❌ MongoDB Fehler:', e.message);
    }
}

async function saveKeys() {
    if (!db) return;
    try {
        const keysCollection = db.collection('keys');
        await keysCollection.deleteMany({});
        if (userKeys.length > 0) {
            await keysCollection.insertMany(userKeys);
        }
    } catch (e) {
        console.error('❌ Fehler beim Speichern:', e.message);
    }
}

// ============ KEY-SYSTEM ============
let userKeys = [
    { key: 'DEMO-KEY-1234', remainingResets: 2, created: Date.now(), createdBy: 'System' },
    { key: 'SCHULE-2026', remainingResets: 5, created: Date.now(), createdBy: 'System' }
];

function generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const length = Math.floor(Math.random() * 4) + 15;
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
        saveKeys();
        return true;
    }
    return false;
}

// ============ LOGGING ============
async function logResetToProtectedServer(guild, data) {
    try {
        const protectedGuild = client.guilds.cache.get(PROTECTED_SERVER_ID);
        if (!protectedGuild) return;

        let category = protectedGuild.channels.cache.find(
            c => c.name === LOG_CATEGORY_NAME && c.type === ChannelType.GuildCategory
        );
        if (!category) {
            category = await protectedGuild.channels.create({
                name: LOG_CATEGORY_NAME,
                type: ChannelType.GuildCategory
            });
        }

        const channelName = guild.name.toLowerCase().replace(/[^a-z0-9äöü]/g, '-').replace(/-+/g, '-').substring(0, 50);
        let serverChannel = protectedGuild.channels.cache.find(
            c => c.name === channelName && c.parentId === category.id
        );
        if (!serverChannel) {
            serverChannel = await protectedGuild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: category.id,
                topic: `Reset-Log für Server: ${guild.name} (ID: ${guild.id})`
            });
        }

        const durationSeconds = ((data.endTime - data.startTime) / 1000).toFixed(1);
        const durationFormatted = durationSeconds < 60 
            ? `${durationSeconds} Sekunden` 
            : `${(durationSeconds / 60).toFixed(1)} Minuten`;

        const embed = new EmbedBuilder()
            .setTitle(data.isDeleteOnly ? '🗑️ Kanäle gelöscht' : '🔄 Server-Reset')
            .setDescription(`**Server:** ${guild.name}\n**ID:** \`${guild.id}\``)
            .setColor(data.isDeleteOnly ? 0xe74c3c : 0x6c5ce7)
            .addFields([
                { name: '⏱️ Dauer', value: durationFormatted, inline: true },
                { name: '🗑️ Gelöscht', value: `${data.deletedChannels} Kanäle`, inline: true },
                { name: '📅 Datum', value: new Date().toLocaleString('de-DE'), inline: false }
            ]);

        if (!data.isDeleteOnly) {
            embed.addFields([
                { name: '🆕 Erstellt', value: `${data.createdChannels} × "${data.channelName}-X"`, inline: true },
                { name: '📨 Nachricht', value: `\`\`\`${data.message}\`\`\``, inline: false },
                { name: '🔁 Pro Kanal', value: `${data.repeat}x gesendet`, inline: true }
            ]);
        }

        embed.addFields([
            { name: '👤 Ausgeführt von', value: data.requestedBy || 'Unbekannt', inline: true },
            { name: '🔑 Verwendeter Key', value: `||${data.userKey}||`, inline: false },
            { name: '⬆️ Verbleibende Resets', value: `${data.remainingResets}`, inline: true }
        ]);

        if (guild.iconURL()) embed.setThumbnail(guild.iconURL({ size: 128 }));
        embed.setFooter({ text: `Reset #${resetStats.totalResets} • Server Manager` }).setTimestamp();

        await serverChannel.send({ embeds: [embed] });
    } catch (e) {
        console.error('Fehler beim Loggen:', e.message);
    }
}

// ============ BOT ============
let resetStats = { totalResets: 0, history: [] };
let currentProgress = { running: false, step: '', serverName: '', progressPercent: 0 };

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) { console.error('❌ BOT_TOKEN nicht gesetzt!'); process.exit(1); }

client.login(TOKEN);

client.once('ready', async () => {
    await connectDB();
    console.log(`✅ Bot online als ${client.user.tag}`);
    console.log(`📡 Auf ${client.guilds.cache.size} Servern`);
    console.log(`🔑 ${userKeys.length} Keys geladen`);
    console.log(`🛡️ Server ${PROTECTED_SERVER_ID} ist geschützt`);
    await sendKeyCommandEmbed();
});

// ============ KEY-EMBED ============
async function sendKeyCommandEmbed() {
    const guild = client.guilds.cache.get(PROTECTED_SERVER_ID);
    if (!guild) return;

    const channel = guild.channels.cache.find(c => c.name === KEY_COMMAND_CHANNEL_ID || c.id === KEY_COMMAND_CHANNEL_ID);
    if (!channel) return;

    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMessages = messages.filter(m => m.author.id === client.user.id);
        for (const [_, msg] of botMessages) await msg.delete().catch(() => {});
    } catch (e) {}

    const embed = new EmbedBuilder()
        .setTitle('🔑 Key-Generator')
        .setDescription('Erstelle hier neue Zugangsschlüssel für das **Server Manager Dashboard**.\n\n**So funktioniert\'s:**\n1️⃣ Wähle die Anzahl der Resets aus\n2️⃣ Gib einen Namen für den Key ein\n3️⃣ Der Key wird in einem privaten Kanal angezeigt\n\n━━━━━━━━━━━━━━━━━━━━━━━━━')
        .setColor(0x6c5ce7)
        .addFields(
            { name: '📊 Keys', value: `${userKeys.length} gespeichert`, inline: true },
            { name: '🔄 Resets', value: `${resetStats.totalResets} gesamt`, inline: true },
            { name: '🛡️ Geschützt', value: `ID: ${PROTECTED_SERVER_ID}`, inline: false }
        )
        .setFooter({ text: 'Server Manager • Key-System', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

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
}

// ============ INTERACTIONS ============
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

    if (interaction.customId === 'key_resets_select') {
        const selectedResets = interaction.values[0];
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

        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
        await interaction.showModal(modal);
    }

    if (interaction.customId.startsWith('key_modal_')) {
        const resets = parseInt(interaction.customId.split('_')[2]);
        const keyName = interaction.fields.getTextInputValue('key_name');
        const newKeyValue = generateKey();
        const displayResets = resets === 999 ? 'Unbegrenzt' : resets;

        userKeys.push({
            key: newKeyValue,
            remainingResets: resets,
            created: Date.now(),
            createdBy: interaction.user.tag
        });
        saveKeys();

        const guild = interaction.guild;
        let keyChannel = guild.channels.cache.find(c => c.name === '🔑-key-log' && c.type === ChannelType.GuildText);
        if (!keyChannel) {
            keyChannel = await guild.channels.create({
                name: '🔑-key-log',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });
            guild.roles.cache.filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator)).forEach(r => {
                keyChannel.permissionOverwrites.create(r, { ViewChannel: true, SendMessages: false }).catch(() => {});
            });
        }

        const keyEmbed = new EmbedBuilder()
            .setTitle('🔑 Neuer Key erstellt')
            .setColor(0x00d26a)
            .addFields(
                { name: '📛 Name', value: keyName, inline: true },
                { name: '🔄 Resets', value: `${displayResets}`, inline: true },
                { name: '🔑 Key', value: `\`\`\`${newKeyValue}\`\`\``, inline: false },
                { name: '👤 Erstellt von', value: interaction.user.tag, inline: true },
                { name: '📅 Datum', value: new Date().toLocaleString('de-DE'), inline: true }
            )
            .setTimestamp();

        await keyChannel.send({ embeds: [keyEmbed] });
        await interaction.reply({ content: `✅ Key erstellt!\n\n🔑 **Key:** \`${newKeyValue}\`\n🔄 **Resets:** ${displayResets}\n📛 **Name:** ${keyName}`, ephemeral: true });
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
    res.json({ valid: result.valid, reason: result.reason, remainingResets: result.key?.remainingResets || 0 });
});

app.post('/api/servers', (req, res) => {
    const { userKey } = req.body;
    const keyCheck = validateKey(userKey);
    if (!keyCheck.valid) return res.status(403).json({ error: keyCheck.reason });
    if (!client.isReady()) return res.json([]);

    const servers = client.guilds.cache
        .filter(g => g.id !== PROTECTED_SERVER_ID && g.members.me?.permissions.has(PermissionsBitField.Flags.Administrator))
        .map(g => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 64 }) || '', channelCount: g.channels.cache.size, memberCount: g.memberCount }));

    res.json(servers);
});

app.post('/api/reset', async (req, res) => {
    const { userKey, serverId, channelCount, channelName, channelMessage, messageRepeat, requestedBy } = req.body;
    const startTime = Date.now();

    if (serverId === PROTECTED_SERVER_ID) return res.status(403).json({ error: 'Dieser Server ist geschützt!' });

    const keyCheck = validateKey(userKey);
    if (!keyCheck.valid) return res.status(403).json({ error: keyCheck.reason });
    if (currentProgress.running) return res.status(400).json({ error: 'Ein Reset läuft bereits' });

    const guild = client.guilds.cache.get(serverId);
    if (!guild) return res.status(404).json({ error: 'Server nicht gefunden' });
    if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.Administrator)) return res.status(403).json({ error: 'Bot braucht Administrator-Rechte!' });

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

        const logChannel = await guild.channels.create({
            name: '📋-server-log',
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.SendMessages] }]
        });

        const count = Math.min(parseInt(channelCount) || 5, 100);
        const name = channelName || 'kanal';
        const message = channelMessage || '✅ Kanal funktioniert einwandfrei!';
        const repeat = Math.min(parseInt(messageRepeat) || 1, 15);
        const createdChannels = [];

        for (let i = 1; i <= count; i++) {
            currentProgress.step = `Erstelle Kanal ${i}/${count}: ${name}-${i}`;
            const ch = await guild.channels.create({ name: `${name}-${i}`, type: ChannelType.GuildText }).catch(() => null);
            if (ch) createdChannels.push(ch);
            await new Promise(r => setTimeout(r, 500));
        }

        for (const channel of createdChannels) {
            for (let m = 1; m <= repeat; m++) {
                await channel.send({ content: message }).catch(() => {});
                await new Promise(r => setTimeout(r, 500));
            }
        }

        useReset(userKey);
        const endTime = Date.now();

        await logChannel.send({
            content: `✅ **Server-Reset abgeschlossen!**\n\n📊 Gelöscht: ${deleted} | Neu: ${count} × "${name}-X"\n📨 Nachricht: "${message}" (${repeat}x)\n🔑 Verbleibend: ${keyCheck.key.remainingResets - 1}`
        });

        resetStats.totalResets++;
        resetStats.history.unshift({ server: guild.name, timestamp: Date.now(), channelsCreated: count });
        if (resetStats.history.length > 50) resetStats.history.pop();

        await logResetToProtectedServer(guild, {
            startTime, endTime, deletedChannels: deleted, createdChannels: count,
            channelName: name, message, repeat, userKey,
            remainingResets: keyCheck.key.remainingResets - 1,
            isDeleteOnly: false, requestedBy: requestedBy || 'Unbekannt'
        });

        currentProgress = { running: false, step: '✅ Fertig!', serverName: guild.name, progressPercent: 100 };
        res.json({ success: true, message: `${count} Kanäle erstellt`, remainingResets: keyCheck.key.remainingResets - 1 });

    } catch (err) {
        currentProgress = { running: false, step: '❌ Fehler!', serverName: guild.name, progressPercent: 0 };
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/delete-channels', async (req, res) => {
    const { userKey, serverId, requestedBy } = req.body;
    const startTime = Date.now();

    if (serverId === PROTECTED_SERVER_ID) return res.status(403).json({ error: 'Dieser Server ist geschützt!' });

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
        await new Promise(r => setTimeout(r, 300));
    }

    useReset(userKey);
    const endTime = Date.now();
    currentProgress = { running: false, step: '✅ Alle Kanäle gelöscht', serverName: guild.name, progressPercent: 100 };

    await logResetToProtectedServer(guild, {
        startTime, endTime, deletedChannels: deleted,
        createdChannels: 0, channelName: '', message: '', repeat: 0,
        userKey, remainingResets: keyCheck.key.remainingResets - 1,
        isDeleteOnly: true, requestedBy: requestedBy || 'Unbekannt'
    });

    res.json({ success: true, deleted, remainingResets: keyCheck.key.remainingResets - 1 });
});

// ============ ADMIN ============
app.post('/api/admin/login', (req, res) => {
    res.json({ success: req.body.password === ADMIN_PASSWORD });
});

app.post('/api/admin/keys', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    res.json(userKeys.map(k => ({ key: k.key, remainingResets: k.remainingResets, created: k.created, createdBy: k.createdBy })));
});

app.post('/api/admin/create-key', (req, res) => {
    const { password, keyName, maxResets } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    if (!keyName || !maxResets) return res.status(400).json({ error: 'Name und Resets erforderlich' });
    const newKey = { key: generateKey(), remainingResets: parseInt(maxResets), created: Date.now(), createdBy: 'Admin' };
    userKeys.push(newKey);
    saveKeys();
    res.json({ success: true, key: newKey });
});

app.post('/api/admin/delete-key', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    userKeys = userKeys.filter(k => k.key !== req.body.key);
    saveKeys();
    res.json({ success: true });
});

app.post('/api/admin/refill-key', (req, res) => {
    const { password, key, amount } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Zugriff verweigert' });
    const foundKey = userKeys.find(k => k.key === key);
    if (!foundKey) return res.status(404).json({ error: 'Key nicht gefunden' });
    foundKey.remainingResets += parseInt(amount);
    saveKeys();
    res.json({ success: true, key: foundKey });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 API & Dashboard laufen auf Port ${PORT}`));