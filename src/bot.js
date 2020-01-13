const { Client } = require('discord.js')
const chalk = require('chalk')
const open = require('open')
const sqlite = require('sqlite')
const sql = require('sql-template-strings')
const shortEmoji = require('emoji-to-short-name')

const config = require('./config.js')
const actionFunctions = require('./actions.js')
const { version } = require('../package.json')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const client = new Client()
let guild, db

process.title = `WAHtson ${version}`
console.log(`WAHtson ${version}`)

config.load()
    .then(() => sqlite.open('./database.sqlite'), { Promise })
    .then(async _db => {
        db = _db
        await db.migrate()
    })
    .then(async () => {
        config.get('bot_token', async token => {
            await client.login(token)
            return true
        })
    })
    .catch(err => {
        console.error(chalk.red(`error: ${err}`))
        process.exit(1)
    })

client.once('ready', async () => {
    console.log(chalk.green('connected'))

    const serverId = await config.get('server_id')

    guild = client.guilds.find(g => g.id === serverId)
    if (!guild) {
        console.log(chalk.red('bot is not present in configured server!'))
        console.log(chalk.red('please invite it using your browser.'))

        const { id } = await client.fetchApplication()
        await open(`https://discordapp.com/oauth2/authorize?client_id=${id}&scope=bot`)

        while (true) {
            await sleep(1000)

            guild = client.guilds.find(g => g.id === serverId)
            if (guild) {
                break
            }
        }
    }

    console.log(chalk.green('server found! listening for commands...'))
})

client.on('message', async msg => {
    if (!guild) return
    if (msg.guild && msg.guild.id !== guild.id) return
    if (msg.author.bot) return

    if (await config.has('commands')) {
        const { commandAttempted, commandString, commandConfig, args } = await parseMessage(msg)

        if (!commandAttempted) return

        const member = msg.member || (await guild.fetchMember(msg.author))

        if (!member) return // Not a member of the server

        console.log(chalk.cyan(`@${member.displayName} issued command: ${msg.cleanContent}`))

        const actions = commandConfig
            ? commandConfig.actions
            : (await config.get('on_unknown_command'))
        await executeActionChain(actions, {
            message: msg,
            channel: msg.channel,
            member: member,
        })
    }
})

client.on('guildMemberAdd', async member => {
    if (!guild) return
    if (member.guild.id !== guild.id) return

    console.log(chalk.cyan(`@${member.displayName} joined`))

    await executeActionChain(await config.get('on_new_member'), {
        message: null,
        channel: null,
        member: member,
    })
})

// Emit messageReactionAdd/Remove events even for uncached messages.
client.on('raw', async packet => {
    if (!['MESSAGE_REACTION_ADD', 'MESSAGE_REACTION_REMOVE'].includes(packet.t)) return;

    const channel = client.channels.get(packet.d.channel_id)

    // Cached message; event will fire anyway.
    if (channel.messages.has(packet.d.message_id)) return

    const message = await channel.fetchMessage(packet.d.message_id)
    const emoji = packet.d.emoji.id ? `${packet.d.emoji.name}:${packet.d.emoji.id}` : packet.d.emoji.name

    const reaction = message.reactions.get(emoji)
    if (reaction) reaction.users.set(packet.d.user_id, client.users.get(packet.d.user_id))

    if (packet.t === 'MESSAGE_REACTION_ADD') {
        client.emit('messageReactionAdd', reaction, client.users.get(packet.d.user_id))
    } else if (packet.t === 'MESSAGE_REACTION_REMOVE') {
        client.emit('messageReactionRemove', reaction, client.users.get(packet.d.user_id))
    }
})

client.on('messageReactionAdd', async (reaction, user) => {
    if (!guild) return
    if (reaction.message.guild.id !== guild.id) return

    const member = await guild.fetchMember(user)

    if (await config.has('pin')) {
        await handlePossiblePin(reaction)
    }

    if (await config.has('reactions')) {
        for (const rConfig of await config.get('reactions')) {
            if (rConfig.message && rConfig.message !== reaction.message.id) {
                continue
            }

            const opts = makeResolvable(rConfig)
            const wantedEmoji = opts.getEmoji('emoji')

            if (reaction.emoji.name === wantedEmoji) {
                console.log(chalk.cyan(`@${member.displayName} added ${wantedEmoji} reaction`))

                await executeActionChain(rConfig.add_actions, {
                    message: reaction.message,
                    channel: reaction.message.channel,
                    member,
                })
            }
        }
    }
})

client.on('messageReactionRemove', async (reaction, user) => {
    if (!guild) return
    if (reaction.message.guild.id !== guild.id) return

    const member = await guild.fetchMember(user)

    if (await config.has('reactions')) {
        for (const rConfig of await config.get('reactions')) {
            if (rConfig.message && rConfig.message !== reaction.message.id) {
                continue
            }

            const opts = makeResolvable(rConfig)
            const wantedEmoji = opts.getEmoji('emoji')

            if (reaction.emoji.name === wantedEmoji) {
                console.log(chalk.cyan(`@${member.displayName} removed ${wantedEmoji} reaction`))

                await executeActionChain(rConfig.remove_actions, {
                    message: reaction.message,
                    channel: reaction.message.channel,
                    member,
                })
            }
        }
    }
})

async function handlePossiblePin(reaction) {
    const pinConfig = await config.get('pin')
    const opts = makeResolvable(pinConfig)

    const { getChannel: getDisallowChannel } = makeResolvable(pinConfig.disallow_from)
    for (let i = 0; i < pinConfig.disallow_from.length; i++) {
        const channel = getDisallowChannel(0)

        if (reaction.message.channel.id === channel.id) return
    }

    console.log(reaction.emoji.name, opts.getEmoji('emoji'))

    if (reaction.count >= opts.getNumber('count') && reaction.emoji.name === opts.getEmoji('emoji')) {
        const isPinned = !!(await db.get(sql`SELECT * FROM pins WHERE msgid=${reaction.message.id}`))

        if (!isPinned) {
            console.log(chalk.cyan(`pinning message`))

            await db.run(sql`INSERT INTO pins VALUES (${reaction.message.id})`)

            await executeActionChain(pinConfig.actions, {
                message: reaction.message,
                channel: reaction.message.channel,
                member: reaction.message.member,
            })
        }
    }
}

async function executeActionChain(actions, source) {
    for (let idx = 0; idx < actions.length; idx++) {
        const action = actions[idx]

        console.log(chalk.grey(` ${idx + 1}. ${action.type}`))

        const fn = actionFunctions[action.type]

        if (!fn) {
            console.error(chalk.red(`error: unknown action type '${action.type}'`))
            continue
        }

        await fn(source, makeResolvable(action))
            .catch(err => {
                console.error(chalk.red(`error: ${err}`))
            })
    }
}

async function parseMessage(msg) {
    const prefix = await config.get('command_prefix')

    let substring
    if (msg.content.startsWith(prefix)) {
        substring = msg.content.substring(prefix.length)
    } else if (msg.channel.type === 'dm') {
        // In DMs, leaving the command prefix out is allowed.
        substring = msg.content
    } else {
        // Message is not a command.
        return { commandAttempted: false }
    }

    const [ commandString, ...rest ] = substring.split(' ')
    const argString = rest.join(' ')

    return {
        commandAttempted: true,

        commandString,
        commandConfig: (await config.get('commands')).find(cmd => {
            const [ commandName ] = cmd.usage.split(' ') // TODO: parse properly
            return commandName === commandString
        }),

        args: argString.split(' '), // TODO: parse properly
    }
}

function makeResolvable(map) {
    const resolveKey = key => {
        if (typeof map[key] === 'undefined') {
            throw `action option '${key}' is missing`
        }

        return map[key]
    }

    return {
        // Resolves to a string intended as message content.
        getText(key) {
            const value = resolveKey(key)

            // TODO: text parsing (variable substitution, #channel resolution, etc)

            return value
        },

        getNumber(key) {
            return +resolveKey(key)
        },

        // Resolves to a Role by name or id.
        getRole(key) {
            const roleNameOrId = resolveKey(key)
            const role = guild.roles.find(role => {
                return role.name === roleNameOrId || role.id === roleNameOrId
            })

            if (!role) {
                throw `unable to resolve role '${roleNameOrId}'`
            }

            return role
        },

        // Resolves to a TextChannel by #name or id (DM).
        getChannel(key) {
            const raw = resolveKey(key)

            let channel
            if (raw.startsWith('#')) {
                // By name
                const channelName = raw.substr(1)

                channel = guild.channels.find(c => c.name === channelName)
            } else {
                // By ID
                channel = guild.channels.find(c => c.id === raw)
            }

            if (!channel) {
                throw `unable to resolve channel '${raw}'`
            }

            return channel
        },

        // Resolves an emoji to its Emoji#name. Enclosing colons are optional.
        getEmoji(key) {
            const maybeWithColons = resolveKey(key)
            const withoutColons = maybeWithColons.startsWith(':')
                ? maybeWithColons.substr(1, maybeWithColons.length - 2)
                : maybeWithColons

            const emoji = guild.emojis.find(emoji => {
                return emoji.name === withoutColons
            })

            if (!emoji) {
                const decoded = shortEmoji.decode(`:${withoutColons}:`)

                if (decoded.startsWith(':')) {
                    throw `unable to resolve emoji: ${maybeWithColons}`
                }

                return decoded
            }

            return emoji.name
        },
    }
}