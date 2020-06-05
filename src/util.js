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

const checkCooldown = async (userid, cooldownid, state, count_use, timeRequired) => {
    const cooldown = await state.db.get(
        'SELECT * FROM cooldowns WHERE userid = ? AND cooldownid = ?',
        userid,
        cooldownid,
    )
    if (
        cooldown == undefined ||
        isNaN(cooldown.date) ||
        (count_use && Date.now() - cooldown.date > timeRequired)
    ) {
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
    if (objs.source && objs.source.args) str = replaceArgPlaceholders(str, objs.source.args)
    if (objs.source) str = replaceEventPlaceholders(str, objs.source)

    if (objs.globalPlaceholders) str = replaceOptsPlaceholders(str, objs.globalPlaceholders, '$g_')
    if (objs.eventConfig) str = replaceOptsPlaceholders(str, objs.eventConfig, '$e_')
    if (objs.opts) str = replaceOptsPlaceholders(str, objs.opts)
    return str
}

const replaceArgPlaceholders = (str, args) => {
    const re = new RegExp(escapeRegexSpecialChars('$args'), 'g')
    str = str.replace(re, args.join(' '))
    for (let i = 0; i < args.length; i++) {
        const re = new RegExp(escapeRegexSpecialChars('$arg' + i), 'g')
        str = str.replace(re, args[i])
    }
    const reSpares = new RegExp(escapeRegexSpecialChars('$arg') + '[0-9]+', 'g')
    str = str.replace(reSpares, '')
    return str
}

const replaceEventPlaceholders = (str, source) => {
    var keys = Object.keys(source)
    keys.forEach(key => {
        if (key == 'args' || key == 'eventConfig') return
        const re = new RegExp(escapeRegexSpecialChars('$:' + key), 'g')
        str = str.replace(re, source[key])
    })
    return str
}

const replaceOptsPlaceholders = (str, opts, prefix = '$_') => {
    var keys = Object.keys(opts)
    keys.forEach(key => {
        const re = new RegExp(escapeRegexSpecialChars(prefix + key), 'g')
        if (typeof opts[key] == 'object') {
            str = str.replace(re, JSON.stringify(opts[key]))
        } else {
            str = str.replace(re, opts[key].toString())
        }
    })
    return str
}

const placeholdersInOpts = (val, opts, source, eventConfig, globalPlaceholders) => {
    if (typeof val == 'string') {
        val = handlePlaceholders(val.toString(), {
            opts: opts,
            source: source,
            eventConfig: eventConfig,
            globalPlaceholders: globalPlaceholders,
        })
    }
    if (typeof val == 'number') {
        val = Number(
            handlePlaceholders(val.toString(), {
                opts: opts,
                source: source,
                eventConfig: eventConfig,
                globalPlaceholders: globalPlaceholders,
            }),
        )
    }
    if (typeof val == 'object') {
        val = JSON.parse(
            handlePlaceholders(JSON.stringify(val), {
                opts: opts,
                source: source,
                eventConfig: eventConfig,
                globalPlaceholders: globalPlaceholders,
            }),
        )
    }
    return val
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

const multiOption = value => {
    if (typeof value == 'object' && value.type == 'MULTI') {
        let choices = []
        for (let i = 0; i < value.choices.length; i++) {
            for (let r = 0; r < (value.weights[i] || 1); r++) {
                choices.push(value.choices[i])
            }
        }
        return choices[Math.floor(Math.random() * choices.length)]
    }
    return value
}

const mathOption = value => {
    if (typeof value == 'object' && value.type == 'MATH') {
        let operated = Number(value.input)
        for (operator of value.operators) {
            if (operator.type == 'ADD') operated += Number(operator.operand)
            if (operator.type == 'SUBTRACT') operated -= Number(operator.operand)
            if (operator.type == 'MULTIPLE') operated *= Number(operator.operand)
            if (operator.type == 'DIVIDE') operated /= Number(operator.operand)
            if (operator.type == 'FLOOR') operated = Math.floor(operated)
            if (operator.type == 'CEILING') operated = Math.ceil(operated)
            if (operator.type == 'ROUND') operated = Math.round(operated)
        }
        return operated
    }
    return value
}

const storeSchedule = async (db, actions, source, runTime, cancelIfPassed) => {
    if (actions.length) {
        let compressedSource = JSON.parse(JSON.stringify(source))

        compressedSource.channel = source.channel.id
        compressedSource.member = source.member.id
        compressedSource.message = source.message.id
        compressedSource.isGuild = source.channel.guild != undefined
        compressedSource.cancelIfPassed = cancelIfPassed

        await db.run(
            'INSERT INTO schedules (actions, source, runTime) VALUES (?, ?, ?)',
            JSON.stringify(actions),
            JSON.stringify(compressedSource),
            Date.now() + runTime,
        )
    }
}
const removeSchedule = async (db, schedule) => {
    await db.run(
        'DELETE FROM schedules WHERE actions = ? AND source = ? AND runTime = ?',
        schedule.actions,
        schedule.source,
        schedule.runTime,
    )
}

const timeDiffString = (first, last) => {
    const diff = Math.round(first - last)

    const CONV = {
        YEAR: 31536000000,
        MONTH: 2629800000,
        DAY: 86400000,
        HOUR: 3600000,
        MINUTE: 60000,
        SECOND: 1000,
    }

    let amount
    let str

    switch (true) {
        case diff >= CONV.YEAR:
            str = 'year'
            amount = Math.round(diff / CONV.YEAR)
            break
        case diff >= CONV.MONTH:
            str = 'month'
            amount = Math.round(diff / CONV.MONTH)
            break
        case diff >= CONV.DAY:
            str = 'day'
            amount = Math.round(diff / CONV.DAY)
            break
        case diff >= CONV.HOUR:
            str = 'hour'
            amount = Math.round(diff / CONV.HOUR)
            break
        case diff >= CONV.MINUTE:
            str = 'minute'
            amount = Math.round(diff / CONV.MINUTE)
            break
        case diff >= CONV.SECOND:
            str = 'second'
            amount = Math.round(diff / CONV.SECOND)
            break
    }

    return String(amount) + ' ' + str + (amount == 1 ? '' : 's')
}

module.exports = {
    sleep,
    timeObjToMs,
    timeDiffString,
    checkCooldown,
    uniqueArray,
    storeSchedule,
    removeSchedule,

    strToEmoji,
    safeToString,
    replacePlaceholders,
    placeholdersInOpts,
    multiOption,
    mathOption,

    escapeMarkdown,
    attachmentType,

    getBalance,
    userHasItem,
}
