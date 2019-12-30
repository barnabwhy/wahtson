const { Client } = require('discord.js')
const chalk = require('chalk')
const open = require('open')

const config = require('./config.js')
const actions = require('./actions.js')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const client = new Client()
let guild

config.load().then(async () => {
    config.get('bot_token', async token => {
        await client.login(token)
        return true
    })
}).catch(err => {
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
    if (msg.guild.id !== guild.id) {
        return
    }

    const { commandString, commandConfig, args } = await parseMessage(msg)

    if (!commandConfig) {
        return
    }

    console.log(chalk.cyan(`@${msg.member.displayName} issued command: ${msg.cleanContent}`))

    const source = {
        message: msg,
        channel: msg.channel,
        member: msg.member,
    }

    for (let idx = 0; idx < commandConfig.actions.length; idx++) {
        const action = commandConfig.actions[idx]

        console.log(chalk.grey(` ${idx + 1}. ${action.type}`))

        const fn = actions[action.type]

        if (!fn) {
            console.error(chalk.red(`error: unknown action type '${action.type}'`))
            continue
        }

        await fn(source, await makeActionOpts(action))
            .catch(err => {
                console.error(chalk.red(`error: ${err}`))
            })
    }
})

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
        return { command: null, args: null }
    }

    const [ commandString, ...rest ] = substring.split(' ')
    const argString = rest.join(' ')

    return {
        commandString,

        commandConfig: (await config.get('commands')).find(cmd => {
            const [ commandName ] = cmd.usage.split(' ') // TODO: parse properly
            return commandName === commandString
        }) || (await config.get('unknown_command')),

        args: argString.split(' '), // TODO: parse properly
    }
}

async function makeActionOpts(map) {
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
        }
    }
}