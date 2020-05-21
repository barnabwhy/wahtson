const {
    uniqueArray,
    replacePlaceholders,
    attachmentType,
    escapeMarkdown,
    getBalance,
} = require('./util.js')

module.exports = {
    async SEND_TO_CHANNEL(source, opts) {
        await opts.getChannel('to').send(opts.getText('text'))
    },
    async SEND_TO_USER(source, opts) {
        await opts.getMember('to').send(opts.getText('text'))
    },
    // Sends a message (option: 'text') to the source channel.
    async REPLY(source, opts) {
        await source.channel.send(opts.getText('text'))
    },

    // Sends a DM (option: 'text') to the source user.
    async REPLY_DM(source, opts) {
        await source.member.send(opts.getText('text'))
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
        const balance = await getBalance(source.member.id, state)
        const placeholders = { $balance: balance }
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
                            message: source.message,
                            channel: source.channel,
                            member: source.member,
                            command: source.command,
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
                                catCmds[3] = { usage: `**${catCmds.length - 3} more commands**` }
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
}
