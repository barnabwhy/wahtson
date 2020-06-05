const { Client } = require('discord.js')
const open = require('open')
const sqlite = require('sqlite')
const { Database } = require('sqlite3')
const sql = require('sql-template-strings')
const shortEmoji = require('emoji-to-short-name')
const path = require('path')

const config = require('./config.js')
const {
    safeToString,
    placeholdersInOpts,
    multiOption,
    mathOption,
    sleep,
    userHasItem,
    removeSchedule,
} = require('./util.js')
const actionFunctions = require('./actions.js')
const conditionFunctions = require('./conditions.js')
const { version } = require('../package.json')

const EventEmitter = require('events')

module.exports = class Bot extends EventEmitter {
    static get logLevel() {
        return {
            INFO: 0,
            WARN: 1,
            ERROR: 2,
        }
    }

    static get version() {
        return version
    }

    constructor(botOptions = {}) {
        super()
        this.botOptions = Object.assign(
            {
                dbPath: ':memory',
                promptInvite: false,
            },
            botOptions,
        )

        this.client = new Client()
        this.config = config()
        this.guild = null

        this.client.on(
            'message',
            this.logRejections(async msg => {
                if (!this.guild) return
                if (msg.guild && msg.guild.id !== this.guild.id) return
                if (msg.author.bot) return

                if (await this.config.has('commands')) {
                    const {
                        commandAttempted,
                        commandString,
                        commandConfig,
                        args,
                    } = await this.parseMessage(msg)

                    if (!commandAttempted) {
                        const member = msg.member || (await this.guild.members.fetch(msg.author))
                        if (!(await this.config.has('on_message'))) return
                        await this.executeActionChain(await this.config.get('on_message'), {
                            event_call: 'on_message',
                            message: msg,
                            channel: msg.channel,
                            member,
                            command: null,
                            eventConfig: await this.config.get('on_message'),
                            args: [],
                        })
                    } else {
                        const member = msg.member || (await this.guild.members.fetch(msg.author))

                        if (!member) return // Not a member of the server

                        this.emit('log', {
                            level: Bot.logLevel.INFO,
                            text: `@${member.displayName} issued command: ${msg.cleanContent}`,
                        })

                        if (commandConfig) {
                            await this.executeActionChain(commandConfig.actions, {
                                event_call: 'command',
                                message: msg,
                                channel: msg.channel,
                                member: member,
                                command: commandString,
                                eventConfig: await commandConfig,
                                args: args.filter(el => el != ''),
                            })
                        } else if (await this.config.has('on_unknown_command')) {
                            await this.executeActionChain(
                                await this.config.get('on_unknown_command'),
                                {
                                    event_call: 'on_unknown_command',
                                    message: msg,
                                    channel: msg.channel,
                                    member: member,
                                    command: commandString,
                                    eventConfig: await this.config.get('on_unknown_command'),
                                    args: args.filter(el => el != ''),
                                },
                            )
                        }
                    }
                }
            }),
        )

        this.client.on(
            'guildMemberAdd',
            this.logRejections(async member => {
                if (!this.guild) return
                if (member.guild.id !== this.guild.id) return

                this.emit('log', {
                    level: Bot.logLevel.INFO,
                    text: `@${member.displayName} joined`,
                })

                await this.executeActionChain(await this.config.get('on_new_member'), {
                    event_call: 'on_new_member',
                    message: null,
                    channel: null,
                    member,
                    command: null,
                    eventConfig: await this.config.get('on_new_member'),
                    args: [],
                })
            }),
        )

        // Emit messageReactionAdd/Remove events even for uncached messages.
        this.client.on(
            'raw',
            this.logRejections(async packet => {
                if (!['MESSAGE_REACTION_ADD', 'MESSAGE_REACTION_REMOVE'].includes(packet.t)) return

                const channel = this.client.channels.cache.get(packet.d.channel_id)

                // Cached message; event will fire anyway.
                if (channel.messages.cache.has(packet.d.message_id)) return

                const message = await channel.messages.fetch(packet.d.message_id)
                const emoji = packet.d.emoji.id
                    ? `${packet.d.emoji.name}:${packet.d.emoji.id}`
                    : packet.d.emoji.name

                const reaction = message.reactions.cache.get(emoji)
                if (reaction)
                    reaction.users.cache.set(
                        packet.d.user_id,
                        this.client.users.cache.get(packet.d.user_id),
                    )

                if (packet.t === 'MESSAGE_REACTION_ADD') {
                    this.client.emit(
                        'messageReactionAdd',
                        reaction,
                        this.client.users.cache.get(packet.d.user_id),
                    )
                } else if (packet.t === 'MESSAGE_REACTION_REMOVE') {
                    this.client.emit(
                        'messageReactionRemove',
                        reaction,
                        this.client.users.cache.get(packet.d.user_id),
                    )
                }
            }),
        )

        this.client.on(
            'messageReactionAdd',
            this.logRejections(async (reaction, user) => {
                if (!this.guild) return
                if (!reaction || reaction.message.guild.id !== this.guild.id) return

                const member = await this.guild.members.fetch(user)

                if (await this.config.has('pin')) {
                    await this.handlePossiblePin(reaction)
                }

                if (await this.config.has('reactions')) {
                    for (const rConfig of await this.config.get('reactions')) {
                        if (rConfig.message && rConfig.message !== reaction.message.id) {
                            continue
                        }

                        const opts = this.makeResolvable(rConfig)
                        const wantedEmoji = opts.getEmoji('emoji')

                        if (reaction.emoji.name === wantedEmoji) {
                            this.emit('log', {
                                level: Bot.logLevel.INFO,
                                text: `@${member.displayName} added ${wantedEmoji} reaction`,
                            })

                            await this.executeActionChain(rConfig.add_actions, {
                                event_call: 'reaction_add',
                                message: reaction.message,
                                channel: reaction.message.channel,
                                member,
                                command: null,
                                eventConfig: await rConfig,
                                args: [],
                            })
                        }
                    }
                }
            }),
        )

        this.client.on(
            'messageReactionRemove',
            this.logRejections(async (reaction, user) => {
                if (!this.guild) return
                if (!reaction || reaction.message.guild.id !== this.guild.id) return

                const member = await this.guild.members.fetch(user)

                if (await this.config.has('reactions')) {
                    for (const rConfig of await this.config.get('reactions')) {
                        if (rConfig.message && rConfig.message !== reaction.message.id) {
                            continue
                        }

                        const opts = this.makeResolvable(rConfig)
                        const wantedEmoji = opts.getEmoji('emoji')

                        if (reaction.emoji.name === wantedEmoji) {
                            this.emit('log', {
                                level: Bot.logLevel.INFO,
                                text: `@${member.displayName} removed ${wantedEmoji} reaction`,
                            })

                            await this.executeActionChain(rConfig.remove_actions, {
                                event_call: 'reaction_remove',
                                message: reaction.message,
                                channel: reaction.message.channel,
                                member,
                                command: null,
                                eventConfig: await rConfig,
                                args: [],
                            })
                        }
                    }
                }
            }),
        )
    }

    async start() {
        this.db = await sqlite.open({
            filename: this.botOptions.dbPath,
            driver: Database,
        })
        await this.db.migrate({
            migrationsPath: path.join(__dirname, '..', 'migrations'),
        })

        const p = new Promise((resolve, reject) => {
            this.client.once('ready', async () => {
                const serverId = await this.config.get('server_id')

                this.guild = this.client.guilds.cache.find(g => g.id === serverId)
                if (!this.guild) {
                    if (this.botOptions.promptInvite) {
                        this.emit({
                            level: Bot.logLevel.WARN,
                            text: 'Bot is not present in configured server!',
                        })
                        this.emit({
                            level: Bot.logLevel.WARN,
                            text: 'Please invite it using your browser.',
                        })

                        const { id } = await this.client.fetchApplication()
                        await open(
                            `https://discordapp.com/oauth2/authorize?client_id=${id}&scope=bot&guild_id=${serverId}`,
                        )

                        while (true) {
                            await sleep(1000)

                            this.guild = this.client.guilds.cache.find(g => g.id === serverId)
                            if (this.guild) {
                                break
                            }
                        }
                    } else {
                        return reject('Bot not present in configured server/guild')
                    }
                }

                this.emit('log', {
                    level: Bot.logLevel.INFO,
                    text: 'Server found. Listening for commands...',
                })

                const schedules = await this.db.all('SELECT * FROM schedules')
                for (const schedule of schedules) {
                    let uncompressedSource = JSON.parse(schedule.source)
                    if (uncompressedSource.cancelIfPassed && schedule.runTime < Date.now()) {
                        removeSchedule(this.db, schedule)
                        return
                    }
                    setTimeout(async () => {
                        if (uncompressedSource.isGuild) {
                            uncompressedSource.channel = this.guild.channels.resolve(
                                uncompressedSource.channel,
                            )
                            uncompressedSource.member = this.guild.members.resolve(
                                uncompressedSource.member,
                            )
                            uncompressedSource.message = await uncompressedSource.channel.messages.fetch(
                                uncompressedSource.message,
                            )
                        } else {
                            uncompressedSource.member = await this.client.users.fetch(
                                uncompressedSource.member,
                            )
                            uncompressedSource.channel = await this.client.channels.fetch(
                                uncompressedSource.channel,
                            )
                            uncompressedSource.message = await uncompressedSource.channel.messages.fetch(
                                uncompressedSource.message,
                            )
                        }

                        this.executeActionChain(JSON.parse(schedule.actions), uncompressedSource)
                        removeSchedule(this.db, schedule)
                    }, schedule.runTime - Date.now())
                }

                resolve()
            })
        })

        const token = await this.config.get('bot_token')
        await this.client.login(token)

        return p
    }

    async parseMessage(msg) {
        const prefix = await this.config.get('command_prefix')

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
            commandConfig: (await this.config.get('commands')).find(cmd => {
                const [commandName] = cmd.usage.split(' ') // TODO: parse properly
                return commandName === commandString
            }),

            args: argString.split(' '), // TODO: parse properly
        }
    }

    executeActionChain = async (actions, source) => {
        let state = {
            previousActionsSkipped: [false],
            db: this.db,
            config: this.config,
            executeActionChain: this.executeActionChain,
            avatar: this.client.user.displayAvatarURL(),
        }

        //Parsing options for global placeholders (done here so that they are unique to each event call)
        let globalPlaceholders = {}
        if (await state.config.has('placeholders')) {
            globalPlaceholders = JSON.parse(JSON.stringify(await state.config.get('placeholders')))
            for (const [key, value] of Object.entries(globalPlaceholders)) {
                globalPlaceholders[key] = multiOption(value)
                globalPlaceholders[key] = mathOption(value)
            }
        }

        //Parsing options for the event (done here so that they are unique to each event call)
        let eventConfig = JSON.parse(JSON.stringify(source.eventConfig))
        for (const [key, value] of Object.entries(eventConfig)) {
            if (key === 'action') return
            eventConfig[key] = multiOption(value)
            eventConfig[key] = JSON.parse(
                placeholdersInOpts(
                    JSON.stringify(eventConfig[key]),
                    eventConfig,
                    source,
                    eventConfig,
                    globalPlaceholders,
                ),
            )
            eventConfig[key] = mathOption(eventConfig[key])
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

            //Parsing multi options and math operators for the action (done here so that they are unique to each event call)
            for (const [key, value] of Object.entries(action)) {
                action[key] = multiOption(value)
                action[key] = JSON.parse(
                    placeholdersInOpts(
                        JSON.stringify(action[key]),
                        action,
                        source,
                        eventConfig,
                        globalPlaceholders,
                    ),
                )
                action[key] = mathOption(action[key])
            }

            if (action.when) {
                const conditions = Array.isArray(action.when) ? action.when : [action.when]
                let conditionsOk = true

                for (const condition of conditions) {
                    const conditionFn = conditionFunctions[condition.type]

                    if (!conditionFn) {
                        this.emit('log', {
                            level: Bot.logLevel.ERROR,
                            text: `Unknown condition type '${condition.type}'`,
                        })
                        conditionsOk = false
                        break
                    }

                    let ok
                    try {
                        ok = await conditionFn(
                            source,
                            this.makeResolvable(condition),
                            state,
                            this.makeResolvable(action),
                            action,
                        )
                    } catch (err) {
                        this.emit('log', { level: Bot.logLevel.ERROR, text: err.toString() })
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
                    state.previousActionsSkipped.push(true)
                    this.emit('action', {
                        index: idx,
                        action,
                        skipped: true,
                        numActions: actions.length,
                        source: source.message.id,
                        event: source.event_call,
                    })
                    continue
                }
            }

            const fn = actionFunctions[action.type]

            if (!fn) {
                this.emit('log', {
                    level: Bot.logLevel.ERROR,
                    text: `Unknown action type "${action.type}"`,
                })
                continue
            }

            let actionResult = await fn(source, this.makeResolvable(action), state, idx).catch(
                err => {
                    this.emit('log', { level: Bot.logLevel.ERROR, text: err.toString() })
                },
            )
            if (actionResult === false) {
                this.emit('action', {
                    index: idx,
                    action,
                    skipped: false,
                    numActions: idx + 1,
                    source: source.message.id,
                    event: source.event_call,
                })
                return
            }

            state.previousActionsSkipped.push(false)

            this.emit('action', {
                index: idx,
                action,
                skipped: false,
                numActions: actions.length,
                source: source.message.id,
                event: source.event_call,
            })
        }
    }

    async handlePossiblePin(reaction) {
        const pinConfig = await this.config.get('pin')
        const opts = this.makeResolvable(pinConfig)

        const { getChannel: getDisallowChannel } = this.makeResolvable(pinConfig.disallow_from)
        for (let i = 0; i < pinConfig.disallow_from.length; i++) {
            const channel = getDisallowChannel(0)

            if (reaction.message.channel.id === channel.id) return
        }

        if (
            reaction.count >= opts.getNumber('count') &&
            reaction.emoji.name === opts.getEmoji('emoji')
        ) {
            const isPinned = !!(await this.db.get(
                sql`SELECT * FROM pins WHERE msgid=${reaction.message.id}`,
            ))

            if (!isPinned) {
                await this.db.run(sql`INSERT INTO pins VALUES (${reaction.message.id})`)

                await this.executeActionChain(pinConfig.actions, {
                    event_call: 'pin',
                    message: reaction.message,
                    channel: reaction.message.channel,
                    member: reaction.message.member,
                    command: null,
                    eventConfig: await pinConfig,
                    args: [],
                })
            }
        }
    }

    makeResolvable(map) {
        const resolveKey = key => {
            if (typeof map[key] === 'undefined') {
                throw `action option '${key}' is missing`
            }

            return map[key]
        }

        return {
            getKeys: () => Object.keys(map),

            has: key => {
                return map.hasOwnProperty(key)
            },

            getRaw: key => map[key],

            getString: key => {
                return safeToString(resolveKey(key))
            },

            // Resolves to a string intended as message content.
            getText: key => {
                const value = resolveKey(key)

                // TODO: text parsing (variable substitution, #channel resolution, etc)

                return value
            },

            getNumber: key => {
                if (isNaN(+resolveKey(key))) throw `'${key}' is not a number`
                return +resolveKey(key)
            },

            getBoolean: (key, defaultVal = false) => {
                try {
                    return resolveKey(key)
                } catch (e) {
                    return defaultVal
                }
            },

            // Resolves to a Role by name or id.
            getRole: key => {
                const roleNameOrId = resolveKey(key)
                const role = this.guild.roles.cache.find(role => {
                    return role.name === roleNameOrId || role.id === roleNameOrId
                })

                if (!role) {
                    throw `unable to resolve role '${roleNameOrId}'`
                }

                return role
            },

            // Resolves to a TextChannel by #name or id (DM).
            getChannel: key => {
                const raw = resolveKey(key)

                let channel
                if (raw.startsWith('#')) {
                    // By name
                    const channelName = raw.substr(1)

                    channel = this.guild.channels.cache.find(c => c.name === channelName)
                } else {
                    // By ID
                    channel = this.guild.channels.cache.find(c => c.id === raw)
                }

                if (!channel) {
                    throw `unable to resolve channel '${raw}'`
                }

                return channel
            },

            // Resolves to a GuildMember by name#discrim or id (DM).
            getMember: key => {
                const raw = resolveKey(key)

                let member
                const re = /^(.)+\#([0-9]){4}$/g
                if (raw.match(re)) {
                    // By name
                    const memberParts = raw.split('#')

                    member = this.guild.members.cache.find(
                        m =>
                            m.user.username === memberParts[0] &&
                            m.user.discriminator == memberParts[1],
                    )
                } else {
                    // By ID
                    if (raw.startsWith('<@'))
                        member = this.guild.members.cache.find(
                            m => m.id === raw.replace('!', '').substring(2, 20),
                        )
                    else member = this.guild.members.cache.find(m => m.id === raw)
                }

                if (!member) {
                    throw `unable to resolve member '${raw}'`
                }

                return member
            },

            // Resolves an emoji to its Emoji#name. Enclosing colons are optional.
            getEmoji: key => {
                const maybeWithColons = resolveKey(key)
                const withoutColons = maybeWithColons.startsWith(':')
                    ? maybeWithColons.substr(1, maybeWithColons.length - 2)
                    : maybeWithColons

                const emoji = this.guild.emojis.cache.find(emoji => {
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

    logRejections(promiseFn) {
        return (...args) =>
            promiseFn(...args).catch(err => {
                this.emit('log', {
                    level: Bot.logLevel.ERROR,
                    text: err.stack.toString(),
                })
            })
    }
}
