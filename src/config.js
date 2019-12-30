const { promisify: p } = require('util')
const path = require('path')
const fs = require('fs')
const toml = require('toml')
const open = require('open')
const chalk = require('chalk')

const CONFIG_TOML_PATH = './config.toml'
const CONFIG_EXAMPLE_PATH = path.join(__dirname, '../config-example.toml')

let cache, isWatching = false

module.exports = {
    async load() {
        const source = await p(fs.readFile)(CONFIG_TOML_PATH)
            .catch(async err => {
                console.log(chalk.red('config.toml not found! copying the example file...'))
                await p(fs.copyFile)(CONFIG_EXAMPLE_PATH, CONFIG_TOML_PATH)
                return await p(fs.readFile)(CONFIG_TOML_PATH)
            })

        if (!isWatching) {
            isWatching = true
            fs.watch(CONFIG_TOML_PATH, () => {
                console.log(chalk.grey('config.toml changed, reloading...'))
                module.exports.load()
            })
        }

        try {
            return cache = toml.parse(source)
        } catch (err) {
            console.error(chalk.red(`syntax error in config.toml on line ${err.line} column ${err.column}`))

            await open(CONFIG_TOML_PATH, { app: 'notepad', wait: true })
            await this.load()
        }
    },

    async get(key, testFn = () => true) {
        if (!cache) {
            await this.load()
        }

        if (typeof cache[key] === 'undefined') {
            console.error(chalk.red(`config.toml '${key}' is missing`))

            await open(CONFIG_TOML_PATH, { app: 'notepad', wait: true })
            return await this.get(key, testFn)
        }

        let isOk = false
        try {
            isOk = await testFn(cache[key])
        } finally {
            if (!isOk) {
                console.error(chalk.red(`config.toml '${key}' is invalid`))

                await open(CONFIG_TOML_PATH, { app: 'notepad', wait: true })
                return await this.get(key, testFn)
            }
        }

        return cache[key]
    },
}