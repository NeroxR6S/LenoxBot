const Command = require("../../lib/LenoxCommand");
const { StreamTrack } = require('../../lib/classes/music');
const { Util: { escapeMarkdown }, MessageEmbed } = require('discord.js');
const ytdl = require('ytdl-core');
const youtubeInfo = require("youtube-info");
const ytlist = require("youtube-playlist");
const crawl = require('youtube-crawl');
const axios = require('axios');
const parseMilliseconds = require('parse-ms');
const moment = require('moment');
require('moment-duration-format');

const regexes = {
	youtube: /(?:(?:https?\:\/\/)?(?:w{1,4}\.)?youtube\.com\/\S*(?:(?:\/e(?:mbed))?\/|watch\/?\?(?:\S*?&?v\=)|playlist\/?\?(?:\S*?&?list\=))|youtu\.be\/)([A-z0-9_-]{6,34})/i,
	youtube_playlist: /(?:(?:https?\:\/\/)?(?:w{1,4}\.)?youtube\.com\/\S*(?:playlist\/?\?(?:\S*?&?list\=))|youtu\.be\/)([A-z0-9_-]{20,34})/i,
	domain_name: /(?:.*www\.)?(\w+)(?:\..+)/i,
	split_track: / - (.+)/i
}

module.exports = class extends Command {
	constructor(...args) {
		super(...args, {
			runIn: ['text'],
			description: language => language.get('COMMAND_PLAY_DESCRIPTION'),
			extendedHelp: language => language.get('COMMAND_PLAY_EXTENDEDHELP'),
			usage: '<query:str>',
			requiredPermissions: ['SEND_MESSAGES', 'CONNECT', 'SPEAK'],
			userPermissions: ['CONNECT']
		});
	}

	_getVoiceChannel(message) {
		return message.member.voice.channel;
	}
	
	_getVoiceConnection(message) {
		return message.guild.voice ? message.guild.voice.connection : null;
	}

	async _nowPlaying(message, audio = {}) {
		const { hours, minutes, seconds } = parseMilliseconds(audio.duration);
		const embed = new MessageEmbed()
			.setTitle(audio.title ? audio.title.replace(/\&quot;/g, '"') : message.language.get('MUSIC_UNKNOWNTITLETITLE'))
			.setURL(audio.url)
			.setColor(3447003)
			.setThumbnail(audio.thumbnailUrl || audio.album_art)
			.setAuthor(audio.owner || audio.artist, audio.channelUrl || undefined, audio.channelThumbnailUrl || audio.album_art)
			.setDescription([`**${message.language.get('MUSIC_DURATIONDESCRIPTION')}**: \`${audio.duration === Infinity ? 'Infinity' : `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`}\``].join('\n'))
			.setFooter(message.language.get('MUSIC_NOWPLAYINGFOOTER'))
			.setTimestamp()
		return await message.channel.send(embed);
	}

	async _executeQueue(message, queue) {
		const music_settings = message.guildSettings.get('music');
		const current_audio = queue[0];
		if (!queue.length) { // If the queue is empty
			if (this._getVoiceConnection(message)) this._getVoiceConnection(message).disconnect(); // Leave the voice channel.
			return message.channel.sendLocale('MUSIC_PLAYBACKFINISHED');
		} else {
			try {
				await this._nowPlaying(message, current_audio);
			} catch (e) {
				throw e;
			}
		}

		new Promise((resolve, reject) => {
			// Join the voice channel if not already in one.
			if (!this._getVoiceConnection(message)) {
				if (!this._getVoiceChannel(message)) return message.channel.sendLocale('MUSIC_NOTINVOICECHANNEL');
				// Check if the user is in a voice channel.
				if (this._getVoiceChannel(message) && this._getVoiceChannel(message).joinable) {
					this._getVoiceChannel(message).join().then((connection) => {
						resolve(connection);
					}).catch((error) => {
						return console.error(error.stack ? error.stack : error.toString());
					});
				} else if (!this._getVoiceChannel(message).joinable) {
					if (this._getVoiceChannel(message).full) {
						message.channel.sendLocale('MUSIC_VOICECHANNELFULL');
					} else {
						message.channel.sendLocale('MUSIC_JOINVOICECHANNELNOPERMS');
					}
					reject();
				} else {
					// Otherwise, clear the queue and do nothing.
					queue.length = 0;
					reject();
				}
			} else {
				resolve(this._getVoiceConnection(message));
			}
		}).then((connection) => {
			// Play the video.
			try {
				if (!current_audio) return message.channel.sendLocale('MUSIC_UNABLETOPLAYAUDIO');
				
				const dispatcher =/*!music_settings.stream_mode ?*/ connection.play(ytdl.validateURL(current_audio.url) ? ytdl(current_audio.url, { filter: 'audioonly' }) : current_audio.url, { volume: music_settings.volume / 100 });

				connection.once('failed', (reason) => {
					console.error(`Connection failed: ${reason.toString()}`);
					if (message && message.channel) message.channel.send(reason.toString());
					try {
						if (connection) connection.disconnect();
					} catch (err) {
						console.error(err.stack ? err.stack : err.toString());
					};
				});
				
				connection.once('error', (err) => {
					console.error(`Connection error: ${err.stack ? err.stack : err.toString()}`);
					if (message && message.channel) message.channel.sendLocale('MUSIC_CONNECTIONERROR', [err.toString()]);
					if (queue.length) {
						if (music_settings.loop && !current_audio.repeat) {
							queue.push(queue.shift()); // Push first item to end
						} else if (!music_settings.loop && current_audio.repeat) {
							// do nothing
						} else {
							queue.shift(); // Skip to the next song.
						}
					}
					this._executeQueue(message, queue);
				});

				/*connection.once('disconnect', () => {
					//
				});*/
				
				dispatcher.once('error', (err) => {
					console.error(`Dispatcher error: ${err.stack ? err.stack : err.toString()}`);
					if (message && message.channel) message.channel.sendLocale('MUSIC_DISPATCHERERROR', [err.toString()]);
					if (queue.length) {
						if (music_settings.loop && !current_audio.repeat) {
							queue.push(queue.shift()); // Push first item to end
						} else if (!music_settings.loop && current_audio.repeat) {
							// do nothing
						} else {
							queue.shift(); // Skip to the next song.
						}
					}
					this._executeQueue(message, queue);
				});
				
				dispatcher.once('end', () => {
					// Wait a second before continuing
					setTimeout(() => {
						if (queue.length && !current_audio.isStream) {
							if (music_settings.loop && !current_audio.repeat) {
								queue.push(queue.shift()); // Push first item to end
							} else if (!music_settings.loop && current_audio.repeat) {
								// do nothing
							} else {
								queue.shift(); // Skip to the next song.
							}
						}
						this._executeQueue(message, queue);
					}, 1000);
				});
			} catch (err) {
				return console.error(err.stack ? err.stack : err.toString());
			};
		}).catch((err) => {
			return console.error(err.stack ? err.stack : err.toString());
		});
	}

	_pushToQueue(message, track, { is_playlist = false, is_stream = false } = {}) {
		const { queue } = message.guildSettings.get('music');
		const premium = message.guildSettings.get('premium.status');
		/*let audio_info = {
			requester: message.author,
			skipvotes: [],
			isStream: is_stream,
			repeat: false,
			...options
		}
		if (!(options instanceof StreamTrack)) {
			audio_info = {
				channelUrl: options.channelId ? "https://www.youtube.com/channel/" + options.channelId : undefined,
				duration: (options.duration * 1000 || 0),
				title: options.title ? escapeMarkdown(options.title.replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&OElig;/g, 'Œ').replace(/&oelig;/g, 'œ').replace(/&Scaron;/g, 'Š').replace(/&scaron;/g, 'š').replace(/&Yuml;/g, 'Ÿ').replace(/&circ;/g, 'ˆ').replace(/&tilde;/g, '˜').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’').replace(/&sbquo;/g, '‚').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&bdquo;/g, '„').replace(/&dagger;/g, '†').replace(/&Dagger;/g, '‡').replace(/&permil;/g, '‰').replace(/&lsaquo;/g, '‹').replace(/&rsaquo;/g, '›').replace(/&euro;/g, '€').replace(/&copy;/g, '©').replace(/&trade;/g, '™').replace(/&reg;/g, '®').replace(/&nbsp;/g, ' ')) : undefined,
				url: decodeURIComponent(options.url),
				...audio_info
			}
		}*/
		if (queue.length && !premium) {
			if ((queue.length + 1) > 8) return message.reply(message.language.get('COMMAND_PLAY_QUEUELIMIT_REACHED'));
			let duration = 0;
			queue.map((audio) => duration += audio.duration);
			if (parseMilliseconds(duration).minutes >= 30 || (parseMilliseconds(duration) + parseMilliseconds(track.duration).minutes) >= 30) return message.reply(message.language.get('COMMAND_PLAY_SONGLENGTHLIMIT'));
		}
		if (queue.length > 1 && is_stream) queue.length = 0;
		queue.push(track);
		if (queue.length > 1 && is_stream && this._getVoiceConnection(message)) this._getVoiceConnection(message).dispatcher.end();
		if (queue.length === 1 || is_playlist) return;
		const { hours, minutes, seconds } = parseMilliseconds(track.duration);
		const embed = new MessageEmbed()
			.setAuthor(track[is_stream ? 'artist' : 'owner'], track[is_stream ? 'album_art' : 'channelThumbnailUrl'], is_stream ? undefined : track.channelUrl)
			.setTitle(track[is_stream ? 'name' : 'title'] ? track[is_stream ? 'name' : 'title'].replace(/\&quot;/g, '"') : message.language.get('MUSIC_UNKNOWNTITLETITLE'))
			.setURL(track.url)
			.setColor(3447003)
			.setDescription([`**${message.language.get('MUSIC_DURATIONDESCRIPTION')}**: \`${track.duration === Infinity ? 'Infinity' : `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`}\``].join('\n'))
			.setThumbnail(track[is_stream ? 'album_art' : 'thumbnailUrl'])
			.setFooter(message.language.get('MUSIC_ADDEDTOQUEUEFOOTER'))
			.setTimestamp()
		return message.channel.send(embed);
	}

	async _isValidURL(url = undefined) {
		if (!url || typeof (url) !== 'string') return false;
		try {
			await axios.get(url);
			return true;
		} catch (error) {
			return false;
		}
	}

	async _getYoutubeVideoInfo(video_id, playlist = false) {
		try {
			return await youtubeInfo(video_id);
		} catch (e) {
			if (!playlist) throw e.message; // ignore error if retrieving from playlist otherwise the playlist array will include rejected promises
		}
	}

	async _getYoutubePlaylistVideos(playlist_url) {
		try {
			const videos = await ytlist(playlist_url, "id");
			return await Promise.all(videos.data.playlist.map((id) => this._getYoutubeVideoInfo(id, true)));
		} catch (error) {
			throw error.message;
		}
	}

	async _promptVideoSelect(message, video_queue) {
		if (video_queue.length > 10) video_queue.splice(10, video_queue.length);
		let results = '';
		await video_queue.map((video, index) => results += `\n${index + 1}. [${escapeMarkdown(video.title)}](${video.uri})`);
		if (video_queue.length > 1) {
			await message.prompt({
				embed: {
					color: 0x43B581,
					description: message.language.get('MULTIPLE_ITEMS_FOUND_PROMPT', results)
				}
			}).then(async (choices) => {
				if (choices.content.toLowerCase() === message.language.get('ANSWER_CANCEL_PROMPT') || !parseInt(choices.content)) return message.sendLocale('MESSAGE_PROMPT_CANCELLED');
				const answer = video_queue[parseInt(choices.content) - 1];
				if (parseInt(choices.content) - 1 < 0 || parseInt(choices.content) - 1 > video_queue.length - 1) return message.sendLocale('MESSAGE_PROMPT_CANCELLED');
				return this._pushToQueue(message, await this._getYoutubeVideoInfo(ytdl.getVideoID(answer.uri)));
			}).catch(console.error);
		} else if (video_queue.length === 1) {
			return this._pushToQueue(message, await this._getYoutubeVideoInfo(ytdl.getVideoID(video_queue[0].uri)));
		}
	}

	async _searchForYoutubeVideo(message, query) {
		try {
			const videos = await crawl(query).filter((video) => video.title && video.uri && ytdl.validateURL(video.uri));
			if (!videos.length) throw message.language.get('MUSIC_UNABLETOFINDVIDEO');
			return await this._promptVideoSelect(message, videos);
		} catch (error) {
			throw error.message;
		}
	}

	async run(message, [query]) {
		const music_settings = message.guildSettings.get('music');
		moment.locale(message.guildSettings.get('momentLanguage'));

		if (!this._getVoiceChannel(message)) return message.channel.sendLocale('MUSIC_NOTINVOICECHANNEL');
		/* Planned Removal */
		/*for (let i = 0; i < message.client.provider.getGuild(message.guild.id, 'musicchannelblacklist').length; i++) {
			if (voiceChannel.id === message.client.provider.getGuild(message.guild.id, 'musicchannelblacklist')[i]) return message.reply(lang.play_blacklistchannel);
		}*/
		/* Planned Removal */

		if ((ytdl.validateURL(query) || ytdl.validateID(query)) && !query.includes(' ')) { // youtube video
			/**
			 * @property { videoId, url, title, description, owner, channelId, thumbnailUrl, embedURL, datePublished, genre, paid, unlisted, isFamilyFriendly, duration, views, regionsAllowed, dislikeCount, likeCount, channelThumbnailUrl, commentCount }
			*/
			this._pushToQueue(message, await this._getYoutubeVideoInfo(ytdl.getVideoID(query)));
		} else if ((regexes.youtube_playlist.test(query) || (query.length >= 20 && query.length <= 34)) && !query.includes(' ') && decodeURIComponent(query).includes('/playlist?list=')) { // youtube playlist
			await message.send({ embed: { description: message.language.get('LOADING_MESSAGE'), color: 7506394 } });
			const videos = (await this._getYoutubePlaylistVideos(query)).map((info) => this._pushToQueue(message, info, { is_playlist: true }));
			await message.send({ embed: { description: message.language.get('MUSIC_ADDEDNUMITEMSTOQUEUE', videos.length), color: 7506394 } });
		} else if (!query.includes(' ') && regexes.domain_name.test(query) && !ytdl.validateURL(query)) { // radio stream
			const track = new StreamTrack(message, query);
			await track._autoFill();
			this._pushToQueue(message, track, { is_stream: true })
			//this._pushToQueue(message, { url: query, duration: Infinity }, { is_stream: true });
		} else { // play from stream [only supports youtube and radio streams currently]
				
			if (query.toLowerCase().startsWith('yt:')) {
				await this._searchForYoutubeVideo(message, query.replace(/^yt\:/i, '')); // if query starts with `yt:` search for youtube video
			} else {
				await this._searchForYoutubeVideo(message, query); // if none match default to youtube
			}
			// search for builtin radio name or youtube video
			//otherwise it's a search query for youtube
		}

		if (music_settings.queue.length === 1 || !this._getVoiceConnection(message)) await this._executeQueue(message, music_settings.queue);
	}

}