const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ActivityType, EmbedBuilder } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const TRACK_EMOJI = process.env.TRACK_EMOJI;

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

// --- Data Management Functions ---

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

// --- Core Role Update Logic ---

async function updateTierRole(member) {
    const userId = member.id;
    const allData = loadData();
    const userData = allData[userId] || {};
    const uniqueReactions = Object.keys(userData).length;

    let highestTierToApply = null;
    let currentTierName = 'None';

    // 1. Determine the highest tier the user qualifies for
    for (const tier of TIER_CONFIG) {
        if (uniqueReactions >= tier.count) {
            highestTierToApply = tier;
            currentTierName = tier.name;
            break; 
        }
    }

    const tierRoleIds = TIER_CONFIG.map(t => t.roleId);
    let rolesChanged = false;

    // 2. Remove all old tier roles
    try {
        const rolesToRemove = member.roles.cache.filter(role => tierRoleIds.includes(role.id));
        if (rolesToRemove.size > 0) {
            await member.roles.remove(rolesToRemove, 'Removing old tier roles for update');
            rolesChanged = true;
        }
    } catch (error) {
        console.error(`Failed to remove old roles for user ${userId}:`, error.message);
    }

    // 3. Apply the new highest tier role
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
    
    // Return status for the /checktier command
    return { uniqueReactions, currentTierName, rolesChanged };
}


// --- Client Events ---

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    await registerCommands();

    client.user.setActivity("Skooma's Mod Emporium!", {type: ActivityType.Watching})
});

// Listener for the tracked reaction being added
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


// --- Slash Command Definitions (No Change) ---

const commands = [
    new SlashCommandBuilder()
        .setName('startreaction')
        .setDescription('Starts tracking a message for the tier system and reacts with the tracking emoji.')
        .addStringOption(option =>
            option.setName('messageid')
                .setDescription('The ID of the message to start tracking.')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
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
];

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(client.application.id, GUILD_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
}

// --- Slash Command Handler (Updated to use Embeds) ---

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // --- /startreaction Command ---
    if (interaction.commandName === 'startreaction') {
        const messageId = interaction.options.getString('messageid');

        await interaction.deferReply({ ephemeral: true });

        try {
            const channel = interaction.channel;
            const message = await channel.messages.fetch(messageId);
            await message.react(TRACK_EMOJI);

            const allData = loadData();
            if (!allData['tracked_messages']) {
                allData['tracked_messages'] = [];
            }
            if (!allData['tracked_messages'].includes(messageId)) {
                allData['tracked_messages'].push(messageId);
                saveData(allData);
            }

            const successEmbed = new EmbedBuilder()
                .setColor(0x00FF00) // Green
                .setTitle(`✅ Tracking Started`)
                .setDescription(`Reactions on message \`${messageId}\` in ${channel} are now being tracked for the tier system.`)
                .addFields(
                    { name: 'Tracking Emoji', value: TRACK_EMOJI, inline: true },
                    { name: 'Target Message ID', value: `\`${messageId}\``, inline: true }
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
                .setDescription(`Could not start tracking for message ID \`${messageId}\`.`)
                .addFields(
                    { name: 'Reason', value: 'Make sure the ID is correct and the message is in this channel, or the bot has necessary permissions (Read Message History, Add Reactions).' }
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
    }
});

// Log in to Discord
client.login(TOKEN);