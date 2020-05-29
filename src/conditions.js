const chalk = require('chalk')
const { strToEmoji, getBalance, checkCooldown, timeObjToMs } = require('./util.js')

module.exports = {
    // Skips the action if the source user does not have the given role (option: 'role').
    async HAS_ROLE(source, opts) {
        return source.member.roles.cache.some(role => role.id === opts.getRole('role').id)
    },

    // Skips the action if the source user is not a nitro booster of the server.
    //
    // You can also specify a number of months (option?: 'month')
    // to allow ex-boosters of n months ago to pass this condition too.
    async IS_NITRO_BOOSTER(source, opts) {
        const ONE_MONTH = 2629800000
        let timeRequired = (opts.has('months') ? opts.getNumber('months') : 1) * ONE_MONTH

        return Date.now() - source.member.premiumSince < timeRequired
    },

    async PREVIOUS_ACTION_SKIPPED(source, opts, state) {
        if (opts.has('ago')) {
            return state.previousActionsSkipped[
                state.previousActionsSkipped.length - opts.getNumber('ago')
            ]
        } else {
            return state.previousActionsSkipped[state.previousActionsSkipped.length - 1]
        }
    },

    async REQUIRE_COINS(source, opts, state) {
        var balance = await getBalance(source.member.id, state)

        if (opts.getBoolean('deduct') && balance >= opts.getNumber('amount')) {
            state.db.run(
                'UPDATE users SET balance = ? WHERE id = ?',
                balance - opts.getNumber('amount'),
                source.member.id,
            )
        }

        return balance >= opts.getNumber('amount')
    },
    async HAS_ITEM(source, opts, state) {
        const purchase = await state.db.get(
            'SELECT * FROM purchases WHERE userid = ? AND item = ?',
            source.member.id,
            opts.getText('item'),
        )
        return purchase != undefined
    },

    async TIME_SINCE(source, opts, state) {
        let timeRequired = timeObjToMs(opts.getText('time'))

        const lastUsed = await checkCooldown(
            source.member.id,
            opts.cooldown_group || source.command,
            state,
            await opts.getBoolean('count_use', true),
            timeRequired,
        )

        return Date.now() - lastUsed > timeRequired
    },

    async HAS_ARGS(source, opts, state) {
        return source.args.length >= (await opts.getNumber('length'))
    },
    async ARG_EQUALS(source, opts, state) {
        const argument = source.args[opts.getNumber('index')]
        const target = opts.getText('value')
        if (opts.getBoolean('nocase')) {
            return target != undefined && argument.toLowerCase() == target.toLowerCase()
        } else {
            return target != undefined && argument == target
        }
    },
    async OPTION_EQUALS(source, opts, state) {
        const option = opts.getRaw(opts.getText('key'))
        const target = opts.getText('key')
        if (opts.getBoolean('nocase')) {
            return target != undefined && option.toLowerCase() == target.toLowerCase()
        } else {
            return target != undefined && option == target
        }
    },
    async ARG_TYPE(source, opts, state) {
        var target = source.args[opts.getNumber('index')]

        const guild = source.member.guild

        if (opts.getText('value') == 'String') {
            return true
        }
        if (opts.getText('value') == 'Number') {
            return !isNaN(Number(target))
        }
        if (opts.getText('value') == 'Channel') {
            let channel
            if (target.startsWith('<#')) {
                const channelId = target.substr(2).slice(0, -1)
                channel = guild.channels.cache.find(c => c.id === channelId)
            }
            return channel != undefined
        }
        if (opts.getText('value') == 'Member') {
            let member
            if (target.startsWith('<@!')) {
                const memberId = target.substr(3).slice(0, -1)
                member = guild.members.cache.find(m => m.id === memberId)
            }
            return member != undefined
        }
        if (opts.getText('value') == 'Role') {
            let role
            if (target.startsWith('<@&')) {
                const roleId = target.substr(3).slice(0, -1)
                role = guild.roles.cache.find(r => r.id === roleId)
            }
            return role != undefined
        }
        if (opts.getText('value') == 'Emoji') {
            strToEmoji(target)
            return emoji != undefined
        }
        // Type is not handled
        throw `type ${opts.getText('value')} is not supported`
    },
    async WAIT_FOR_REACTION(source, opts, state) {
        const emoji = strToEmoji(opts.getText('emoji'))
        if (opts.getBoolean('prompt')) {
            source.message.react(emoji)
        }
        const filter = (reaction, user) =>
            reaction.emoji.name == emoji && user.id === source.member.id
        return new Promise(resolve => {
            let timeLimit
            try {
                timeLimit = timeObjToMs(opts.getText('time'))
            } catch (e) {
                timeLimit = 15000
            }
            if (
                source.message.reactions.cache.find(
                    reaction =>
                        reaction.emoji.name == emoji &&
                        reaction.users.cache.some(user => user.id === source.member.id),
                )
            ) {
                resolve(true)
            }

            if (timeLimit == 0) {
                resolve(
                    source.message.reactions.cache.find(
                        reaction =>
                            reaction.emoji.name == emoji &&
                            reaction.users.cache.some(user => user.id === source.member.id),
                    ),
                )
            }
            const collector = source.message.createReactionCollector(filter, { time: timeLimit })
            collector.on('collect', r => {
                resolve(true)
            })
            collector.on('end', collected => {
                if (collected.size == 0) resolve(false)
            })
        })
    },
    async RANDOM_CHANCE(source, opts, state) {
        return Math.random() * 100 < opts.getNumber('percent')
    },
    async WAIT(source, opts, state) {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve(true)
            }, timeObjToMs(opts.getText('time')))
        })
    },
}
