const { Client } = require('discord.js')
const chalk = require('chalk')
const open = require('open')
const sqlite = require('sqlite')
const { Database } = require('sqlite3')
const sql = require('sql-template-strings')
const shortEmoji = require('emoji-to-short-name')

const config = require('./config.js')
const { safeToString, handlePlaceholders, sleep, userHasItem } = require('./util.js')
const actionFunctions = require('./actions.js')
const conditionFunctions = require('./conditions.js')
const { version } = require('../package.json')

const client = new Client()
let guild, db

process.title = `WAHtson ${version}`
console.log(`WAHtson ${version}`)

config
    .load()
    .then(() =>
        sqlite.open({
            filename: './database.sqlite',
            driver: Database,
        }),
    )
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

    guild = client.guilds.cache.find(g => g.id === serverId)
    if (!guild) {
        console.log(chalk.red('bot is not present in configured server!'))
        console.log(chalk.red('please invite it using your browser.'))

        const { id } = await client.fetchApplication()
        await open(
            `https://discordapp.com/oauth2/authorize?client_id=${id}&scope=bot&guild_id=${serverId}`,
        )

        while (true) {
            await sleep(1000)

            guild = client.guilds.cache.find(g => g.id === serverId)
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

        if (!commandAttempted) {
            const member = msg.member || (await guild.fetchMember(msg.author))
            await executeActionChain(await config.get('on_message'), {
                message: msg,
                channel: msg.channel,
                member: msg.member,
                command: null,
                args: [],
            })
        } else {
            const member = msg.member || (await guild.fetchMember(msg.author))

            if (!member) return // Not a member of the server

            console.log(chalk.cyan(`@${member.displayName} issued command: ${msg.cleanContent}`))

            const actions = commandConfig
                ? commandConfig.actions
                : await config.get('on_unknown_command')
            await executeActionChain(actions, {
                message: msg,
                channel: msg.channel,
                member: member,
                command: commandString,
                args: args.filter(el => el != ''),
            })
        }
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
        command: null,
        args: [],
    })
})

// Emit messageReactionAdd/Remove events even for uncached messages.
client.on('raw', async packet => {
    if (!['MESSAGE_REACTION_ADD', 'MESSAGE_REACTION_REMOVE'].includes(packet.t)) return

    const channel = client.channels.cache.get(packet.d.channel_id)

    // Cached message; event will fire anyway.
    if (channel.messages.cache.has(packet.d.message_id)) return

    const message = await channel.messages.fetch(packet.d.message_id)
    const emoji = packet.d.emoji.id
        ? `${packet.d.emoji.name}:${packet.d.emoji.id}`
        : packet.d.emoji.name

    const reaction = message.reactions.cache.get(emoji)
    if (reaction)
        reaction.users.cache.set(packet.d.user_id, client.users.cache.get(packet.d.user_id))

    if (packet.t === 'MESSAGE_REACTION_ADD') {
        client.emit('messageReactionAdd', reaction, client.users.cache.get(packet.d.user_id))
    } else if (packet.t === 'MESSAGE_REACTION_REMOVE') {
        client.emit('messageReactionRemove', reaction, client.users.cache.get(packet.d.user_id))
    }
})

client.on('messageReactionAdd', async (reaction, user) => {
    if (!guild) return
    if (!reaction || reaction.message.guild.id !== guild.id) return

    const member = await guild.members.fetch(user)

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
                    command: null,
                    args: [],
                })
            }
        }
    }
})

client.on('messageReactionRemove', async (reaction, user) => {
    if (!guild) return
    if (!reaction || reaction.message.guild.id !== guild.id) return

    const member = await guild.members.fetch(user)

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
                    command: null,
                    args: [],
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

    if (
        reaction.count >= opts.getNumber('count') &&
        reaction.emoji.name === opts.getEmoji('emoji')
    ) {
        const isPinned = !!(await db.get(
            sql`SELECT * FROM pins WHERE msgid=${reaction.message.id}`,
        ))

        if (!isPinned) {
            console.log(chalk.cyan(`pinning message`))

            await db.run(sql`INSERT INTO pins VALUES (${reaction.message.id})`)

            await executeActionChain(pinConfig.actions, {
                message: reaction.message,
                channel: reaction.message.channel,
                member: reaction.message.member,
                command: null,
                args: [],
            })
        }
    }
}

async function executeActionChain(actions, source) {
    let state = {
        previousActionSkipped: false,
        db: db,
        config: config,
        executeActionChain: executeActionChain,
    }

    for (let idx = 0; idx < actions.length; idx++) {
        let action = JSON.parse(JSON.stringify(actions[idx]))

        if (action.modifiers) {
            for (let i = 0; i < Object.keys(action.modifiers).length; i++) {
                let mod = action.modifiers[Object.keys(action.modifiers)[i]]

                if (await userHasItem(source.member.id, mod.item, db)) {
                    for (key in mod.options) {
                        action[key] = mod.options[key]
                    }
                }
            }
        }
        action = placeholdersInOpts(action, source)

        process.stdout.write(chalk.grey(` ${idx + 1}. ${action.type}`))

        if (action.when) {
            const conditions = Array.isArray(action.when) ? action.when : [action.when]
            let conditionsOk = true

            for (const condition of conditions) {
                const conditionFn = conditionFunctions[condition.type]

                if (!conditionFn) {
                    console.error(chalk.red(` error: unknown condition type '${condition.type}'`))
                    conditionsOk = false
                    break
                }

                let ok
                try {
                    ok = await conditionFn(source, makeResolvable(condition), state)
                } catch (err) {
                    console.error(chalk.red(` error: '${err}'`))
                    conditionsOk = false
                    break
                }

                if (condition.negate) {
                    ok = !ok
                }

                if (!ok) {
                    conditionsOk = false
                    break
                }
            }

            if (!conditionsOk) {
                console.log(chalk.magenta(' skipped'))
                state.previousActionSkipped = true
                continue
            }
        }

        const fn = actionFunctions[action.type]

        if (!fn) {
            console.error(chalk.red(' error: unknown action type'))
            continue
        }

        process.stdout.write('\n')

        await fn(source, makeResolvable(action), state).catch(err => {
            console.error(chalk.red(` error: ${err}`))
        })

        state.previousActionSkipped = false
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

    const [commandString, ...rest] = substring.split(' ')
    const argString = rest.join(' ')

    return {
        commandAttempted: true,

        commandString,
        commandConfig: (await config.get('commands')).find(cmd => {
            const [commandName] = cmd.usage.split(' ') // TODO: parse properly
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
        getKeys() {
            return Object.keys(map)
        },

        has(key) {
            return map.hasOwnProperty(key)
        },

        getString(key) {
            return safeToString(resolveKey(key))
        },

        // Resolves to a string intended as message content.
        getText(key) {
            const value = resolveKey(key)

            // TODO: text parsing (variable substitution, #channel resolution, etc)

            return value
        },

        getNumber(key) {
            if (isNaN(+resolveKey(key))) throw `'${key}' is not a number`
            return +resolveKey(key)
        },

        getBoolean(key, defaultVal = false) {
            try {
                return resolveKey(key)
            } catch (e) {
                return defaultVal
            }
        },

        // Resolves to a Role by name or id.
        getRole(key) {
            const roleNameOrId = resolveKey(key)
            const role = guild.roles.cache.find(role => {
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

                channel = guild.channels.cache.find(c => c.name === channelName)
            } else {
                // By ID
                channel = guild.channels.cache.find(c => c.id === raw)
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

            const emoji = guild.emojis.cache.find(emoji => {
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

const placeholdersInOpts = (opts, source) => {
    const newOpts = opts
    for (key in opts) {
        if (typeof opts[key] == 'string') {
            newOpts[key] = handlePlaceholders(opts[key], { opts: opts, source: source })
        }
        if (typeof opts[key] == 'number') {
            newOpts[key] = Number(
                handlePlaceholders(opts[key].toString(), { opts: opts, source: source }),
            )
        }
        if (typeof opts[key] == 'object') {
            newOpts[key] = JSON.parse(
                placeholdersInOpts(JSON.stringify(opts[key]), { opts: opts, source: source }),
            )
        }
    }
    return newOpts
}

process.on('unhandledRejection', error => {
    console.error(chalk.red(`error: ${error.stack || error}`))
})
