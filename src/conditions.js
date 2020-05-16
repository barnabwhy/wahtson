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
		let timeRequired = (opts.months || 1) * ONE_MONTH

		return (Date.now() - source.member.premiumSince) < timeRequired
	},

	async PREVIOUS_ACTION_SKIPPED(source, opts, state) {
		return state.previousActionSkipped
	},

	async REQUIRE_COINS(source, opts, state) {
		var balance = await getBalance(source.member.id, state)

		if(opts.getBoolean('deduct') && balance >= opts.getNumber('amount')) {
			state.db.run('UPDATE users SET balance = ? WHERE id = ?', balance-opts.getNumber('amount'), source.member.id);
		}

		return balance >= opts.getNumber('amount');
	},

	async TIME_SINCE(source, opts, state) {
		let timeRequired = timeObjToMs(opts.getText("time"));

		var last_used = await getLastUsed(source.member.id, (opts.cooldown_group || source.command), state, await opts.getBoolean("count_use", true))

		return (Date.now() - last_used) > timeRequired;
	},
}

const timeObjToMs = (timeObj) => {
	const CONV = {
		YEAR: 31536000000,
		MONTH: 2629800000,
		DAY: 86400000,
		HOUR: 3600000,
		MINUTE: 60000,
		SECOND: 1000
	}
	var ms = 0;
	ms += (timeObj.years || 0) * CONV.YEAR
	ms += (timeObj.months || 0) * CONV.MONTH
	ms += (timeObj.days || 0) * CONV.DAY
	ms += (timeObj.hours || 0) * CONV.HOUR
	ms += (timeObj.minutes || 0) * CONV.MINUTE
	ms += (timeObj.seconds  || 0)* CONV.SECOND
	ms += (timeObj.milliseconds || 0)

	return ms
}

const replacePlaceholders = (str, placeholders) => {
    Object.keys(placeholders).forEach((p) => {
        var re = new RegExp(RegExp.quote(p),"g")
        str = str.replace(re, placeholders[p]);
    });
    return str;
}
RegExp.quote = function(str) {
    return str.replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
};

const getBalance = async (id, state) => {
	var balance = await state.db.get('SELECT * FROM users WHERE id = ?', id);
    if(balance == undefined || isNaN(balance.balance)) {
        await state.db.run('INSERT INTO users (id, balance) VALUES (?, ?)', id, (await state.config.get('economy')).starting_coins);
    }
    balance = await state.db.get('SELECT * FROM users WHERE id = ?', id);

    return balance.balance
}
const getLastUsed = async (userid, cooldownid, state, count_use) => {
	var cooldown = await state.db.get('SELECT * FROM cooldowns WHERE userid = ? AND cooldownid = ?', userid, cooldownid);
	if(count_use) {
		if(cooldown == undefined || isNaN(cooldown.date)) {
			await state.db.run('INSERT INTO cooldowns (userid, cooldownid, date) VALUES (?, ?, ?)', userid, cooldownid, Date.now());
		} else {
			await state.db.run('UPDATE cooldowns SET date = ? WHERE userid = ? AND cooldownid = ?', Date.now(), userid, cooldownid);
		}
	}

	try{
		return cooldown.date
	} catch(e) {
		return 0
	}
}