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

module.exports = {
    sleep,
    timeObjToMs,
    checkCooldown,

    handlePlaceholders,
    replacePlaceholders,
    escapeMarkdown,
    attachmentType,

    getBalance,
    userHasItem,
}
