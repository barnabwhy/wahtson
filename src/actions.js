const {
    uniqueArray,
    replacePlaceholders,
    attachmentType,
    escapeMarkdown,
    getBalance,
    timeObjToMs,
    storeSchedule,
    removeSchedule,
} = require('./util.js')

module.exports = {
    async SEND_TO_CHANNEL(source, opts) {
        await opts.getChannel('to').send({
            content: opts.has('text') ? opts.getText('text') : '',
            embed: opts.has('embed') ? opts.getRaw('embed') : undefined,
            files: opts.has('files') ? opts.getRaw('files') : undefined,
        })
    },
    async SEND_TO_USER(source, opts) {
        await opts.getMember('to').send({
            content: opts.has('text') ? opts.getText('text') : '',
            embed: opts.has('embed') ? opts.getRaw('embed') : undefined,
            files: opts.has('files') ? opts.getRaw('files') : undefined,
        })
    },
    // Sends a message (option: 'text') to the source channel.
    async REPLY(source, opts) {
        await source.channel.send({
            content: opts.has('text') ? opts.getText('text') : '',
            embed: opts.has('embed') ? opts.getRaw('embed') : undefined,
            files: opts.has('files') ? opts.getRaw('files') : undefined,
        })
    },

    // Sends a DM (option: 'text') to the source user.
    async REPLY_DM(source, opts) {
        await source.member.send({
            content: opts.has('text') ? opts.getText('text') : '',
            embed: opts.has('embed') ? opts.getRaw('embed') : undefined,
            files: opts.has('files') ? opts.getRaw('files') : undefined,
        })
    },

    // Grants a role (option: 'role') to the source member.
    //
    // If the member already has the role, nothing happens.
    // If the named role does not exist, an error is thrown.
    async GRANT_ROLE(source, opts) {
        await source.member.roles.add(opts.getRole('role'))
    },

    // Revokes a role (option: 'role') from the source member.
    //
    // If the member doesn't have the role, nothing happens.
    // If the named role does not exist, an error is thrown.
    async REVOKE_ROLE(source, opts) {
        await source.member.roles.remove(opts.getRole('role'))
    },

    // Deletes the source message (ie. the message with the command in it).
    async DELETE_SOURCE_MESSAGE(source) {
        await source.message.delete()
    },

    // Copies the source message to a target channel (option: 'to').
    async COPY_SOURCE_MESSAGE(source, opts) {
        const channel = opts.getChannel('to')

        const attachments = [...source.message.attachments.values()]
        const primaryAttachment = attachments.shift()

        let attachmentEmbed = {},
            files = []

        if (primaryAttachment) {
            switch (attachmentType(primaryAttachment)) {
                case 'image':
                    attachmentEmbed = {
                        image: { url: primaryAttachment.proxyURL },
                    }
                    break
                case 'video':
                    files = [{ attachment: primaryAttachment.proxyURL }]
                    break
                default:
                    // Unknown; we'll handle it with all the other attachments
                    attachments.unshift(primaryAttachment)
            }
        }

        const fields = []

        // Add reamining attachments to an extra field
        if (attachments.length) {
            fields.push({
                name: 'Attachments',
                value: attachments
                    .map(
                        a =>
                            `[${a.proxyURL.substring(a.proxyURL.lastIndexOf('/') + 1)}](${
                                a.proxyURL
                            })`,
                    )
                    .join('\n'),
            })
        }

        channel.send({
            files,
            embed: {
                author: {
                    name: source.message.member.displayName,
                    icon_url: await source.message.author.displayAvatarURL(),
                },

                description: `${escapeMarkdown(source.message.content)}\n\n[Jump to Message](${
                    source.message.url
                })`,
                timestamp: source.message.createdTimestamp,
                fields,

                ...attachmentEmbed,
            },
        })
    },

    async GET_BALANCE(source, opts, state) {
        const balance = await getBalance(
            opts.has('user') && opts.getRaw('user') != ''
                ? opts.getMember('user').id
                : source.member.id,
            state,
        )
        const placeholders = {
            $balance: balance,
            $user:
                opts.has('user') && opts.getRaw('user') != ''
                    ? opts.getMember('user')
                    : source.member,
        }
        source.channel.send(replacePlaceholders(opts.getText('text'), placeholders))
    },

    async PURCHASE_ITEM(source, opts, state) {
        const purchase = await state.db.get(
            'SELECT * FROM purchases WHERE userid = ? AND item = ?',
            source.member.id,
            opts.getText('item'),
        )
        const balance = await getBalance(source.member.id, state)

        const placeholders = {
            $balance: balance,
            $outstanding: opts.getNumber('price') - balance,
        }

        if (purchase == undefined || opts.getBoolean('repeatable')) {
            if (balance >= opts.getNumber('price')) {
                state.db.run(
                    'UPDATE users SET balance = ? WHERE id = ?',
                    balance - opts.getNumber('price'),
                    source.member.id,
                )
                if (purchase == undefined) {
                    await state.db.run(
                        'INSERT INTO purchases (userid, item) VALUES (?, ?)',
                        source.member.id,
                        opts.getText('item'),
                    )
                }
                source.channel.send(replacePlaceholders(opts.getText('text_success'), placeholders))

                if (await state.config.has('purchases')) {
                    if (!source.member) return // Not a member of the server

                    const purchaseConfig = (await state.config.get('purchases')).find(pch => {
                        const [itemName] = pch.item.split(' ') // TODO: parse properly
                        return itemName === opts.getText('item')
                    })

                    if (purchaseConfig) {
                        await state.executeActionChain(purchaseConfig.actions, {
                            event_call: 'purchase',
                            message: source.message,
                            channel: source.message.channel,
                            member: source.message.member,
                            command: null,
                            eventConfig: opts,
                            args: [],
                        })
                    }
                }
            } else {
                source.channel.send(replacePlaceholders(opts.getText('text_poor'), placeholders))
            }
        } else {
            source.channel.send(replacePlaceholders(opts.getText('text_duplicate'), placeholders))
        }
    },

    async GIVE_COINS(source, opts, state) {
        const balance = await getBalance(source.member.id, state)
        const placeholders = { $balance: balance }
        state.db.run(
            'UPDATE users SET balance = ? WHERE id = ?',
            balance + opts.getNumber('amount'),
            source.member.id,
        )

        if (opts.has('text')) {
            source.channel.send(replacePlaceholders(opts.getText('text'), placeholders))
        }
    },

    async SEND_HELP(source, opts, state) {
        let commands = (await state.config.get('commands'))
            .filter(cmd => {
                return cmd.hidden != true
            })
            .map(c => {
                return {
                    usage: c.usage,
                    description: c.description,
                    category: c.category ? c.category : 'Uncategorized',
                }
            })
        let categories = uniqueArray(
            commands
                .map(c => {
                    return c.category
                })
                .filter(c => {
                    return c != undefined
                }),
        )

        let catPage = categories.find(cat => {
            return cat.toLowerCase().startsWith(opts.getText('page').toLowerCase())
        })

        if (typeof catPage == 'undefined') {
            source.channel.send({
                embed: {
                    title: 'Categories',
                    footer: {
                        text: 'Help | Categories',
                    },
                    author: {
                        name: 'Help',
                        icon_url: state.avatar,
                    },
                    fields: [
                        categories.map(cat => {
                            let catCmds = commands.filter(cmd => {
                                return cmd.category == cat
                            })
                            if (catCmds.length > 3) {
                                catCmds[3] = {
                                    usage: `**${catCmds.length - 3} more command${
                                        catCmds.length > 3 ? 's' : ''
                                    }**`,
                                }
                                catCmds = catCmds.slice(0, 4)
                            }
                            return {
                                name: cat,
                                value: catCmds.map(cmd => {
                                    return cmd.usage
                                }),
                            }
                        }),
                    ],
                },
            })
        } else {
            source.channel.send({
                embed: {
                    title: catPage,
                    footer: {
                        text: `Help | ${catPage}`,
                    },
                    author: {
                        name: 'Help',
                        icon_url: state.avatar,
                    },
                    fields: [
                        commands
                            .filter(cmd => {
                                return cmd.category == catPage
                            })
                            .map(cmd => {
                                return {
                                    name: cmd.usage,
                                    value: cmd.description ? cmd.description : 'No Description',
                                }
                            }),
                    ],
                },
            })
        }
    },
    async DO_NOTHING() {
        /* DOES NOTHING, NOT A BUG. INTENDED FOR ACTION LOGIC PURPOSES. */
    },

    async TRANSFER_COINS(source, opts, state) {
        const balanceFrom = await getBalance(opts.getMember('from').id, state)
        const balanceTo = await getBalance(opts.getMember('to').id, state)

        let decuction = opts.getNumber('amount')
        if (opts.has('tax')) {
            decuction += opts.getNumber('tax')
        }

        if (balanceFrom < decuction) {
            if (opts.has('text_poor')) {
                source.channel.send(opts.getText('text_poor'))
            }
        } else if (opts.getMember('to') === opts.getMember('from')) {
            if (opts.has('text_self')) {
                source.channel.send(opts.getText('text_self'))
            }
        } else {
            state.db.run(
                'UPDATE users SET balance = ? WHERE id = ?',
                balanceFrom - decuction,
                opts.getMember('from').id,
            )
            state.db.run(
                'UPDATE users SET balance = ? WHERE id = ?',
                balanceTo + opts.getNumber('amount'),
                opts.getMember('to').id,
            )

            if (opts.has('text_success')) {
                source.channel.send(opts.getText('text_success'))
            }
        }
    },

    async WEBHOOK(source, opts, state) {
        const channel = opts.has('to') ? opts.getChannel('to') : source.channel
        const webhookOpts = await state.config.get('webhook')
        const webhookComponents = (opts.has('webhook_url')
            ? opts.getText('webhook_url')
            : webhookOpts.default_webhook_url
        )
            .replace('https://discordapp.com/api/webhooks/', '')
            .split('/')
        const webhook = await (await source.message.guild.fetchWebhooks()).get(webhookComponents[0])

        await webhook.edit({
            channel: channel.id,
        })

        webhook.send({
            username: opts.has('display_name')
                ? opts.getText('display_name')
                : webhookOpts.default_display_name,
            avatarURL: opts.has('avatar_url')
                ? opts.getText('avatar_url')
                : webhookOpts.default_avatar_url,

            content: opts.has('text') ? opts.getText('text') : '',
            embeds: opts.has('embeds') ? opts.getRaw('embeds') : [],
        })
    },

    async SCHEDULE(source, opts, state, idx) {
        const actions = await source.eventConfig.actions.slice(idx + 1)

        let runTime = timeObjToMs(opts.getText('time'))

        source.event_call = 'schedule'
        source.eventConfig.actions = actions

        await storeSchedule(
            state.db,
            actions,
            source,
            runTime,
            opts.getBoolean('cancel_if_passed', true),
        )

        setTimeout(async () => {
            state.executeActionChain(actions, source)

            let compressedSource = JSON.parse(JSON.stringify(source))

            compressedSource.channel = source.channel.id
            compressedSource.member = source.member.id
            compressedSource.message = source.message.id
            compressedSource.isGuild = source.channel.guild != undefined

            removeSchedule(state.db, {
                actions,
                compressedSource,
                runTime,
            })
        }, runTime)

        return false
    },
}
