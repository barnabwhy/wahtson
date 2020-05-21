module.exports = () => {
    let cache = {}

    return {
        reset(config = {}) {
            cache = config
        },

        async get(key, testFn = () => true) {
            if (typeof cache[key] === 'undefined') {
                throw `config '${key}' is missing`
            }

            let isOk = false
            try {
                isOk = await testFn(cache[key])
            } finally {
                if (!isOk) {
                    throw `config '${key}' is invalid`
                }
            }

            return cache[key]
        },

        async has(key) {
            return typeof cache[key] !== 'undefined'
        },
    }
}
