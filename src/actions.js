module.exports = {
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
        await source.member.addRole(opts.getRole('role'))
    },

    // Revokes a role (option: 'role') from the source member.
    //
    // If the member doesn't have the role, nothing happens.
    // If the named role does not exist, an error is thrown.
    async REVOKE_ROLE(source, opts) {
        await source.member.removeRole(opts.getRole('role'))
    },

    // Deletes the source message (ie. the message with the command in it).
    async DELETE_SOURCE_MESSAGE(source) {
        await source.message.delete()
    },

    // Copies the source message to a target channel (option: 'to').
    async COPY_SOURCE_MESSAGE(source, opts) {
        const channel = opts.getChannel('to')

        channel.send({
            embed: {
                author: {
                    name: source.message.member.displayName,
                    icon_url: source.message.author.displayAvatarURL,
                },
                image: {
                    url: (source.message.attachments.first() || {}).proxyURL,
                },
                description: `${escapeMarkdown(source.message.content)}\n[Jump to Message](${source.message.url})`,
                timestamp: source.message.createdTimestamp
            },
        })
    },
}

const escapeMarkdown = s => s.replace(/([\[\]\(\)])/g, '\\$&')