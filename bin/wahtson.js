const chalk = require('chalk')
const fs = require('fs')
const p = require('util').promisify
const toml = require('toml')

const argv = require('minimist')(process.argv.slice(2))

const Bot = require('..')
const { version } = require('../package.json')

if (argv.h || argv.help) {
    console.log(
        `
highly configurable discord bot

USAGE:
    wahtson [OPTIONS]

OPTIONS:
    -c, --config <PATH>     Load configuration from specified file (default: ./config.toml)
    -d, --database <PATH>   Path to SQLite database file to use (default: ./database.sqlite)
        --no-watch          Disable reloading the config file when it changes
    -v, --version           Print version info and exit
    -h, --help              Print help information and exit
`,
    )
} else if (argv.v || argv.version) {
    console.log(`wahtson ${version}`)
} else {
    process.title = `wahtson ${version}`

    const configPath = argv.c || argv.config || 'config.toml'
    const dbPath = argv.d || argv.database || 'database.sqlite'

    const bot = new Bot({
        dbPath,
        promptInvite: true,
    })

    bot.on('log', ({ level, text }) => {
        switch (level) {
            case Bot.logLevel.INFO:
                console.log(chalk.cyan(text))
                break
            case Bot.logLevel.WARN:
                console.warn(chalk.yellow(text))
                break
            case Bot.logLevel.ERROR:
                console.error(chalk.red(text))
                break
            default:
                console.log(text)
        }
    })

    bot.on('action', ({ index, numActions, action, skipped }) => {
        // Print the last action only
        if (index === numActions - 1) {
            console.log(`Executed ${numActions} actions`)
        }
    })

    loadConfig(configPath)
        .then(config => {
            bot.config.reset(config)
            return bot.start()
        })
        .then(() => {
            if (!argv.watch) {
                let configChangedLast = Date.now()
                fs.watch(configPath, () => {
                    // Debounce; fs.watch likes to call this multiple times for a single change.
                    if (Date.now() - configChangedLast < 500) {
                        return
                    }
                    configChangedLast = Date.now()

                    console.log(chalk.grey('Config file changed, reloading...'))
                    loadConfig(configPath)
                        .then(config => {
                            bot.config.reset(config)
                        })
                        .catch(err => {
                            console.error(chalk.red(err))
                        })
                })
            }
        })
        .catch(err => {
            console.error(chalk.red(err))
            process.exit(1)
        })
}

async function loadConfig(configPath) {
    const source = await p(fs.readFile)(configPath, 'utf8')

    try {
        return toml.parse(source)
    } catch (err) {
        throw `Syntax error in config on line ${err.line} column ${err.column}`
    }
}
