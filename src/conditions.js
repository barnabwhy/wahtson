module.exports = {
	// Skips the action if the source user does not have the given role (option: 'role').
	async HAS_ROLE(source, opts) {
		return source.member.roles.cache.some(role => role.id === opts.getRole('role').id)
	},

	// Skips the action if the source user is not a nitro booster of the server.
	//
	// You can also specify a number of months (option?: 'month')
	// to allow ex-boosters of n months ago to pass this condition too.
	async IS_NITRO_BOOSTER(source) {
		const ONE_MONTH = 2629800000
		let timeRequired = (source.months || 1) * ONE_MONTH

		return (Date.now() - source.member.premiumSince) < timeRequired
	},

	async PREVIOUS_ACTION_SKIPPED(source, opts, state) {
		return state.previousActionSkipped
	},
}
