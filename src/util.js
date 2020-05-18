const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const timeObjToMs = timeObj => {
    const CONV = {
        YEAR: 31536000000,
        MONTH: 2629800000,
        DAY: 86400000,
        HOUR: 3600000,
        MINUTE: 60000,
        SECOND: 1000,
    }

    let ms = 0
    ms += (timeObj.years || 0) * CONV.YEAR
    ms += (timeObj.months || 0) * CONV.MONTH
    ms += (timeObj.days || 0) * CONV.DAY
    ms += (timeObj.hours || 0) * CONV.HOUR
    ms += (timeObj.minutes || 0) * CONV.MINUTE
    ms += (timeObj.seconds || 0) * CONV.SECOND
    ms += timeObj.milliseconds || 0

    return ms
}

const checkCooldown = async (userid, cooldownid, state, count_use) => {
    const cooldown = await state.db.get(
        'SELECT * FROM cooldowns WHERE userid = ? AND cooldownid = ?',
        userid,
        cooldownid,
    )
    if (count_use) {
        if (cooldown == undefined || isNaN(cooldown.date)) {
            await state.db.run(
                'INSERT INTO cooldowns (userid, cooldownid, date) VALUES (?, ?, ?)',
                userid,
                cooldownid,
                Date.now(),
            )
        } else {
            await state.db.run(
                'UPDATE cooldowns SET date = ? WHERE userid = ? AND cooldownid = ?',
                Date.now(),
                userid,
                cooldownid,
            )
        }
    }

    try {
        return cooldown.date
    } catch (e) {
        return 0
    }
}

const escapeMarkdown = s => s.replace(/([\[\]\(\)])/g, '\\$&')

const attachmentType = a =>
    ({
        png: 'image',
        jpg: 'image',
        jpeg: 'image',
        gif: 'image',
        webp: 'image',
        mp4: 'video',
        mov: 'video',
        webm: 'video',
    }[fileExtension(a.url)])

const fileExtension = url => {
    if (!url) return

    return url.split('.').pop().split(/\#|\?/)[0]
}

const getBalance = async (id, state) => {
    let balance = await state.db.get('SELECT * FROM users WHERE id = ?', id)
    if (balance == undefined || isNaN(balance.balance)) {
        await state.db.run(
            'INSERT INTO users (id, balance) VALUES (?, ?)',
            id,
            (await state.config.get('economy')).starting_coins,
        )
    }
    balance = await state.db.get('SELECT * FROM users WHERE id = ?', id)

    return balance.balance
}

async function userHasItem(id, item, db) {
    const itemResult = await db.get(
        'SELECT * FROM purchases WHERE userid = ? AND item = ?',
        id,
        item,
    )
    return itemResult != undefined
}

const handlePlaceholders = (str, objs = {}) => {
    if (objs.source.args) str = replaceArgPlaceholders(str, objs.source.args)
    if (objs.source) str = replaceEventPlaceholders(str, objs.source)
    if (objs.opts) str = replaceOptsPlaceholders(str, objs.opts)
    return str
}

const replaceArgPlaceholders = (str, args) => {
    for (let i = 0; i < args.length; i++) {
        const re = new RegExp(escapeRegexSpecialChars('$arg' + i), 'g')
        str = str.replace(re, args[i])
    }
    return str
}
const replaceEventPlaceholders = (str, source) => {
    var keys = Object.keys(source)
    keys.forEach(key => {
        if (key == 'args') return
        const re = new RegExp(escapeRegexSpecialChars('$:' + key), 'g')
        str = str.replace(re, source[key])
    })
    return str
}

const replaceOptsPlaceholders = (str, opts) => {
    var keys = Object.keys(opts)
    keys.forEach(key => {
        if (safeToString(opts[key]) == '[Object object]') return
        const re = new RegExp(escapeRegexSpecialChars('$_' + key), 'g')
        str = str.replace(re, safeToString(opts[key]))
    })
    return str
}

const replacePlaceholders = (str, placeholders) => {
    Object.keys(placeholders).forEach(p => {
        const re = new RegExp(escapeRegexSpecialChars(p), 'g')
        str = str.replace(re, placeholders[p])
    })
    return str
}
const escapeRegexSpecialChars = str => str.replace(/([.?*+^$[\]\\(){}|-])/g, '\\$1')

function safeToString(x) {
    switch (typeof x) {
        case 'object':
            return '[Object object]'
        case 'function':
            return '[Function function]'
        default:
            return x + ''
    }
}

const uniqueArray = a => a.filter((item, index) => a.indexOf(item) == index)

const emojiMap = require('./emoji_map.json')
const strToEmoji = target => {
    const re = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{3297}\u{3299}\u{303d}\u{00a9}\u{00ae}\u{2122}\u{23f3}\u{24c2}\u{23e9}-\u{23ef}\u{25b6}\u{23f8}-\u{23fa}]/gu
    let emoji
    if (target.match(re)) {
        emoji = target
    }
    if (target.match(/(^(\:)[a-z0-9]+(\:)$)/gi)) {
        emoji = emojiMap[target.replace(/\:/g, '')]
    }
    if (target.match(/(^(\<\:)[a-z0-9]+(\:)[0-9]+(\>)$)/gi)) {
        emoji = target
    }
    return emoji
}

module.exports = {
    sleep,
    timeObjToMs,
    checkCooldown,
    uniqueArray,

    strToEmoji,
    safeToString,
    handlePlaceholders,
    replacePlaceholders,
    escapeMarkdown,
    attachmentType,

    getBalance,
    userHasItem,
}
