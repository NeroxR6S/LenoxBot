const LenoxCommand = require('../LenoxCommand.js');

module.exports = class createmuteroleCommand extends LenoxCommand {
	constructor(client) {
		super(client, {
			name: 'createmuterole',
			group: 'administration',
			memberName: 'createmuterole',
			description: 'Toggles the deletion of a command after execution',
			format: 'createmuterole',
			aliases: [],
			examples: ['createmuterole'],
			category: 'administration',
			clientPermissions: ['SEND_MESSAGES', 'MANAGE_ROLES', 'MANAGE_CHANNELS'],
			userPermissions: ['ADMINISTRATOR'],
			shortDescription: 'Roles',
			dashboardsettings: true
		});
	}

	async run(msg) {
		const langSet = msg.client.provider.getGuild(msg.message.guild.id, 'language');
		const lang = require(`../../languages/${langSet}.json`);

		const newMuteRole = await msg.guild.createRole({
			name: 'muted',
			position: 1
		}, 'Lenoxbot muted role');

		const message = await msg.channel.send(lang.createmuterole_waitmessage);
		await message.channel.startTyping();

		for (let i = 0; i < msg.guild.channels.array().length; i++) {
			await msg.guild.channels.array()[i].overwritePermissions(newMuteRole, {
				SEND_MESSAGES: false,
				SPEAK: false,
				ADD_REACTIONS: false
			});
		}

		await message.channel.stopTyping();
		return message.edit(lang.createmuterole_done);
	}
};