const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ActivityType, EmbedBuilder } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const express = require('express');
const { start } = require('repl');

// Import the OS module to get server/system info
const os = require('os');
const { version: discordjsVersion } = require('discord.js'); // Import discord.js version

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const TRACK_EMOJI = process.env.TRACK_EMOJI;

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, () => console.log(`Keep-alive server running on port ${PORT}`));

let TIER_CONFIG = [];

try {
    const configData = fs.readFileSync('tier_config.json', 'utf8');
    TIER_CONFIG = JSON.parse(configData);
    
    TIER_CONFIG.sort((a, b) => b.count - a.count);

    console.log('Tier configuration loaded successfully:');
    console.log(TIER_CONFIG.map(t => `${t.name} (${t.count} reactions)`).join(', '));

} catch (error) {
    console.error('FATAL ERROR: Failed to load TIER_CONFIG from tier_config.json.');
    console.error('Please ensure the file exists, is valid JSON, and contains the correct role IDs/counts.');
    console.error(error.message);
    process.exit(1); 
}

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: ['MESSAGE', 'CHANNEL', 'REACTION'], 
});


function loadData() {
    try {
        const data = fs.readFileSync('reactions.json');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            fs.writeFileSync('reactions.json', '{}');
            return {};
        }
        console.error('Error reading reactions.json:', error.message);
        return {};
    }
}

function saveData(data) {
    fs.writeFileSync('reactions.json', JSON.stringify(data, null, 4));
}


async function updateTierRole(member) {
    const userId = member.id;
    const allData = loadData();
    const userData = allData[userId] || {};
    const uniqueReactions = Object.keys(userData).length;

    let highestTierToApply = null;
    let currentTierName = 'None';

    for (const tier of TIER_CONFIG) {
        if (uniqueReactions >= tier.count) {
            highestTierToApply = tier;
            currentTierName = tier.name;
            break; 
        }
    }

    const tierRoleIds = TIER_CONFIG.map(t => t.roleId);
    let rolesChanged = false;

    try {
        const rolesToRemove = member.roles.cache.filter(role => tierRoleIds.includes(role.id));
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove, 'Removing old tier roles for update');
            rolesChanged = true;
        }
    } catch (error) {
        console.error(`Failed to remove old roles for user ${userId}:`, error.message);
    }

    if (highestTierToApply) {
        if (!member.roles.cache.has(highestTierToApply.roleId)) {
            try {
                await member.roles.add(highestTierToApply.roleId, `Achieved ${highestTierToApply.name} with ${uniqueReactions} unique reactions`);
                console.log(`Applied role ${highestTierToApply.name} to user ${userId}`);
                rolesChanged = true;
            } catch (error) {
                console.error(`Failed to apply role ${highestTierToApply.roleId} to user ${userId}:`, error.message);
            }
        }
    }
    
    // Return status for the /checktier command or /resetuser
    return { uniqueReactions, currentTierName, rolesChanged };
}

/**
 * Converts milliseconds to a human-readable string (D days, H hours, M minutes, S seconds).
 * @param {number} ms Milliseconds.
 * @returns {string} Formatted uptime string.
 */
function formatUptime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const days = Math.floor(totalSeconds / 86400);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`); // Ensure at least seconds are shown

    return parts.join(' ');
}


// --- Client Events (No changes needed here) ---

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    await registerCommands();

    client.user.setActivity("Skooma's Mod Emporium!", {type: ActivityType.Watching})
});

// Listener for the tracked reaction being added (No changes needed here)
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot || reaction.emoji.name !== TRACK_EMOJI) return;

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Something went wrong when fetching the reaction message:', error);
            return;
        }
    }

    const messageId = reaction.message.id;
    const guildId = reaction.message.guildId;

    if (guildId !== GUILD_ID) return; 

    const allData = loadData();
    const trackedMessages = allData['tracked_messages'] || [];

    if (!trackedMessages.includes(messageId)) return;

    if (!allData[user.id]) {
        allData[user.id] = {};
    }
    
    if (!allData[user.id][messageId]) {
        allData[user.id][messageId] = true;
        saveData(allData);

        const guild = client.guilds.cache.get(GUILD_ID);
        if (guild) {
            const member = await guild.members.fetch(user.id).catch(() => null);
            if (member) {
                await updateTierRole(member);
            }
        }
    }
});

// Listener for the tracked reaction being removed (No changes needed here)
client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot || reaction.emoji.name !== TRACK_EMOJI) return;

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Something went wrong when fetching the reaction message:', error);
            return;
        }
    }

    const messageId = reaction.message.id;
    const guildId = reaction.message.guildId;
    if (guildId !== GUILD_ID) return;

    const allData = loadData();
    const trackedMessages = allData['tracked_messages'] || [];

    if (!trackedMessages.includes(messageId)) return;

    if (allData[user.id] && allData[user.id][messageId]) {
        delete allData[user.id][messageId];
        
        if (Object.keys(allData[user.id]).length === 0) {
            delete allData[user.id];
        }

        saveData(allData);

        const guild = client.guilds.cache.get(GUILD_ID);
        if (guild) {
            const member = await guild.members.fetch(user.id).catch(() => null);
            if (member) {
                await updateTierRole(member);
            }
        }
    }
});


// --- Slash Command Definitions (UPDATED for /ping and /startreaction permission) ---

const commands = [
    // UPDATED PERMISSION
    new SlashCommandBuilder()
        .setName('startreaction')
        .setDescription('Starts tracking a message or a forum post for the tier system.')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message or Forum Post/Thread ID to start tracking.')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // LOCKED TO ADMINISTRATOR
        .toJSON(),
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Shows your current tier progress.')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('checktier') 
        .setDescription('Manually checks and updates a user\'s current tier role.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check (defaults to you).')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles) 
        .toJSON(),
    new SlashCommandBuilder()
        .setName('resetuser')
        .setDescription('Resets or reduces the unique reaction count for a user.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose reactions will be modified.')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The number of unique reactions to remove (optional; defaults to all).')
                .setRequired(false)
                .setMinValue(1))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .toJSON(),
    // NEW /ping COMMAND
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Shows the bot\'s latency, uptime, resource usage, and versions.')
        .toJSON(),
];

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');

        // Assuming client.application.id is available, otherwise this will fail.
        // It's usually safe after client.on('ready').
        const appId = client.application.id;

        await rest.put(
            Routes.applicationGuildCommands(appId, GUILD_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error("Error refreshing application commands:", error);
    }
}

// --- Slash Command Handler (UPDATED for /ping) ---

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // --- /ping Command (NEW) ---
    if (interaction.commandName === 'ping') {
        const memoryData = process.memoryUsage();
        
        // Convert bytes to MB and format with 2 decimal places
        const formatMemory = (bytes) => (bytes / 1024 / 1024).toFixed(2);

        const pingEmbed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('📶 Bot Status & Diagnostics')
            .addFields(
                { name: '🌐 Latency (Websocket)', value: `\`${interaction.client.ws.ping}ms\``, inline: true },
                { name: '⏳ Uptime', value: `\`${formatUptime(interaction.client.uptime)}\``, inline: true },
                { name: '\u200B', value: '\u200B', inline: true }, // Spacer
                { name: '💾 Memory (Heap Used)', value: `\`${formatMemory(memoryData.heapUsed)} MB\``, inline: true },
                { name: '🧠 Memory (RSS)', value: `\`${formatMemory(memoryData.rss)} MB\``, inline: true },
                { name: '💻 Server Uptime', value: `\`${formatUptime(os.uptime() * 1000)}\``, inline: true },
                { name: '🟢 Node.js Version', value: `\`${process.version}\``, inline: true },
                { name: '🤖 discord.js Version', value: `\`v${discordjsVersion.split('.')[0]}\``, inline: true },
                { name: '\u200B', value: '\u200B', inline: true } // Spacer
            )
            .setTimestamp();

        await interaction.reply({ 
            embeds: [pingEmbed], 
            ephemeral: false // Usually visible to everyone
        });
    }

    // --- /startreaction Command ---
    else if (interaction.commandName === 'startreaction') {
        const providedId = interaction.options.getString('messageid');

        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;
            const channel = interaction.channel; 
            let targetMessageId = providedId; 
            let message; 
            let targetChannel = channel; 

            // 1. Check if the provided ID is a Thread Channel ID (e.g., from a Forum Post)
            const resolvedChannel = await guild.channels.fetch(providedId).catch(() => null);

            if (resolvedChannel && resolvedChannel.isThread()) {
                const starterMessage = await resolvedChannel.messages.fetch(resolvedChannel.id).catch(() => null);

                if (!starterMessage) {
                    throw new Error(`Could not find the initial post message for ID ${providedId}`);
                }

                message = starterMessage;
                targetMessageId = starterMessage.id; 
                targetChannel = resolvedChannel;
            } else {
                // 2. Otherwise, treat it as a regular message ID in the current channel.
                message = await channel.messages.fetch(providedId);
            }

            if (!message) {
                throw new Error(`Message or Thread with ID ${providedId} not found.`);
            }

            await message.react(TRACK_EMOJI);

            const allData = loadData(); 
            if (!allData['tracked_messages']) {
                allData['tracked_messages'] = [];
            }
            if (!allData['tracked_messages'].includes(targetMessageId)) {
                allData['tracked_messages'].push(targetMessageId);
                saveData(allData);
            }

            const successEmbed = new EmbedBuilder()
            .setColor(0x00FF00) 
            .setTitle(`✅ Tracking Started`)
            .setDescription(`Reactions on the **initial post/message** (ID: \`${targetMessageId}\`) in ${targetChannel} are now being tracked for the tier system.`)
                .addFields(
                    { name: 'Tracking Emoji', value: TRACK_EMOJI, inline: true },
                    { name: 'Target Message ID', value: `\`${targetMessageId}\``, inline: true }
                )
                .setTimestamp();

                await interaction.editReply({
                    embeds: [successEmbed],
                    ephemeral: true
                });

        } catch (error) {
            console.error('Error in /startreaction:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000) // Red
                .setTitle(`❌ Tracking Failed`)
                .setDescription(`Could not start tracking for ID \`${providedId}\`.`)
                .addFields(
                    { name: 'Reason', value: 'Make sure the ID is correct, the message is fetchable, and the bot has necessary permissions (Read Message History, Add Reactions).' }
                )
                .setTimestamp();

            await interaction.editReply({ 
                embeds: [errorEmbed],
                ephemeral: true 
            });
        }
    // --- /stats Command ---
    } else if (interaction.commandName === 'stats') {
        const userId = interaction.user.id;
        const allData = loadData();
        const userData = allData[userId] || {};
        const uniqueReactions = Object.keys(userData).length;

        let description = `You currently have **${uniqueReactions}** unique reactions across tracked messages.\n\n`;
        let tierFields = [];
        let nextTierInfo = 'You have achieved the highest tier! 🎉';

        for (const tier of TIER_CONFIG) {
            const achieved = uniqueReactions >= tier.count;
            description += `- **${tier.name}** (${tier.count} reactions): ${achieved ? '✅' : '❌'}\n`;
            
            if (!achieved && nextTierInfo.startsWith('You have achieved')) {
                const reactionsNeeded = tier.count - uniqueReactions;
                nextTierInfo = `Next Tier: **${tier.name}** requires **${reactionsNeeded}** more unique reactions.`;
            }
        }
        
        // Add the next tier info as a field
        tierFields.push({ name: 'Next Goal', value: nextTierInfo, inline: false });

        const statsEmbed = new EmbedBuilder()
            .setColor(0x0099FF) // Blue
            .setTitle(`${interaction.user.tag}'s Tier Progress`)
            .setDescription(description)
            .addFields(tierFields)
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `Tracking reactions with ${TRACK_EMOJI}` })
            .setTimestamp();

        await interaction.reply({ 
            embeds: [statsEmbed], 
            ephemeral: true 
        });
    // --- /checktier Command ---
    } else if (interaction.commandName === 'checktier') {
        await interaction.deferReply({ ephemeral: true });
        
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const guild = interaction.guild;
        
        if (!guild) {
            return await interaction.editReply({ 
                embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription('This command must be run inside a server.')],
                ephemeral: true
            });
        }

        const member = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!member) {
            return await interaction.editReply({ 
                embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription(`Could not find member ${targetUser.tag} in this server.`)],
                ephemeral: true
            });
        }
        
        const { uniqueReactions, currentTierName, rolesChanged } = await updateTierRole(member);
        
        const checkEmbed = new EmbedBuilder()
            .setColor(rolesChanged ? 0x00FF00 : 0xFFFF00) // Green if changed, Yellow if not
            .setTitle(`✅ Tier Check for ${targetUser.tag}`)
            .setDescription(rolesChanged 
                ? 'Roles were successfully updated based on their current reaction count.' 
                : 'The user\'s current role is correct, or no change was needed.')
            .addFields(
                { name: 'Unique Reactions', value: `${uniqueReactions}`, inline: true },
                { name: 'Current Tier Achieved', value: currentTierName, inline: true },
                { name: 'Role Status', value: rolesChanged ? 'UPDATED' : 'CORRECT', inline: true }
            )
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setTimestamp()
            .setFooter({ text: `Checked by ${interaction.user.tag}` });

        await interaction.editReply({ embeds: [checkEmbed], ephemeral: true });
    // --- /resetuser Command (NEW) ---
    } else if (interaction.commandName === 'resetuser') {
        await interaction.deferReply({ ephemeral: true });
        
        const targetUser = interaction.options.getUser('user');
        const amountToRemove = interaction.options.getInteger('amount');
        const guild = interaction.guild;

        if (!guild) {
             return await interaction.editReply({ 
                embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription('This command must be run inside a server.')],
                ephemeral: true
            });
        }

        const member = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!member) {
            return await interaction.editReply({ 
                embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription(`Could not find member ${targetUser.tag} in this server.`)],
                ephemeral: true
            });
        }

        const allData = loadData();
        const userData = allData[targetUser.id];
        const originalCount = userData ? Object.keys(userData).length : 0;
        let finalCount = originalCount;
        let actionDescription = "";

        if (originalCount === 0) {
            actionDescription = `User ${targetUser.tag} currently has 0 unique reactions. No action needed.`;
        } else if (!amountToRemove || amountToRemove >= originalCount) {
            // Full reset
            delete allData[targetUser.id];
            finalCount = 0;
            actionDescription = `Successfully **removed all** ${originalCount} unique reactions.`;
        } else {
            // Partial removal
            const messageIds = Object.keys(userData);
            // Get a random selection of IDs to delete
            const idsToDelete = messageIds.sort(() => 0.5 - Math.random()).slice(0, amountToRemove);
            
            for (const id of idsToDelete) {
                delete userData[id];
            }
            
            // Save the modified data
            allData[targetUser.id] = userData;
            finalCount = Object.keys(userData).length;
            actionDescription = `Successfully **removed ${amountToRemove}** unique reactions.`;
        }
        
        saveData(allData);

        // Force a role update based on the new count
        const { currentTierName } = await updateTierRole(member);

        const resetEmbed = new EmbedBuilder()
            .setColor(0x3498DB) // Blue
            .setTitle(`♻️ Reaction Count Modified`)
            .setDescription(actionDescription)
            .addFields(
                { name: 'Target User', value: targetUser.tag, inline: true },
                { name: 'Original Count', value: `${originalCount}`, inline: true },
                { name: 'New Count', value: `${finalCount}`, inline: true },
                { name: 'Current Tier', value: currentTierName, inline: false }
            )
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

        await interaction.editReply({ embeds: [resetEmbed], ephemeral: true });
    }
});

// Log in to Discord
client.login(TOKEN);