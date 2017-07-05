'use strict';

const fs = require('fs');

const EventEmitter = require('events');
const Wechaty = require('wechaty');

const errors = require('./errors');

const _messageTypes = [
    'audio',
    'channel_chat_created',
    'contact',
    'delete_chat_photo',
    'document',
    'game',
    'group_chat_created',
    'invoice',
    'left_chat_member',
    // 'left_chat_participant', // deprecated
    'location',
    'migrate_from_chat_id',
    'migrate_to_chat_id',
    'new_chat_members',
    // 'new_chat_participant', // deprecated
    'new_chat_photo',
    'new_chat_title',
    'photo',
    'pinned_message',
    'sticker',
    'successful_payment',
    'supergroup_chat_created',
    'text',
    'video',
    'video_note',
    'voice',
];

class WechatyTelegramBot extends EventEmitter {
    static get errors() {
        return errors;
    }

    static get messageTypes() {
        return _messageTypes;
    }

    constructor(profile = null, options = {}) {
        super();

        this.options = options;
        this.options.wechaty = this.options.wechaty || {};
        this.options.wechaty.profile = profile || this.options.wechaty.profile;

        this.wechaty = new Wechaty(this.options.wechaty);
        this.wechaty.on('scan', (url, code) => {
            this.emit('wechaty_scan', url, code);
        });
        this.wechaty.on('login', (user) => {
            this.wechaty.user = user;
            // TODO
        }).on('logout', (user) => {
            this.wechaty.user = user;
            // TODO
        }).on('message', (msg) => {
            // TODO
        }).on('error', (err) => {
            // TODO
        }).on('friend', (user, req) => {
            // TODO
        }).on('room-join', (chat, invitees, inviter) => {
            // TODO
        }).on('room-leave', (chat, leavers) => {
            // TODO
        }).on('room-topic', (chat, newTitle, oldTitle, changer) => {
            // TODO
        });

        this._textRegexpCallbacks = [];
        this._replyListenerId = 0;
        this._replyListeners = [];

        if (options.polling) {
            const autoStart = options.polling.autoStart;

            if (typeof autoStart === 'undefined' || autoStart === true) {
                this.startPolling();
            }
        }

        if (options.webHook) {
            const autoOpen = options.webHook.autoOpen;

            if (typeof autoOpen === 'undefined' || autoOpen === true) {
                this.openWebHook();
            }
        }
    }

    // ======== polling ========

    startPolling(options = {}) {
        if (options.restart) {
            return this.stopPolling().then(() => {
                return this.wechaty.init();
            });
        } else {
            return this.wechaty.init();
        }
    }

    // deprecated
    initPolling(options = {}) {
        return this.startPolling(options);
    }

    stopPolling() {
        return this.wechaty.quit();
    }

    isPolling() {
        return this.wechaty.state.current() === 'ready';
    }

    getUpdates(form = {}) {
        return new Promise((resolve, reject) => {
            resolve([]);
        });
    }

    // ======== web hook ========

    openWebHook() {
        return this.wechaty.init();
    }

    closeWebHook() {
        return this.wechaty.quit();
    }

    hasOpenWebHook() {
        return this.wechaty.state.current() === 'ready';
    }

    setWebHook(url, options = {}) {
        return new Promise((resolve, reject) => {
            resolve(true);
        });
    }

    deleteWebHook() {
        return new Promise((resolve, reject) => {
            resolve(true);
        });
    }

    getWebHookInfo() {
        return new Promise((resolve, reject) => {
            resolve({
                url: '',
                has_custom_certificate: false,
                pending_update_count: 0,
            });
        });
    }

    // ======== updating ========

    processUpdate(update) {
        if (update.message) {
            this.emit('message', update.message);

            WechatyTelegramBot.messageTypes.forEach((messageType) => {
                if (update.message[messageType]) {
                    this.emit(messageType, update.message);
                }
            });

            if (update.message.text) {
                this._textRegexpCallbacks.some((reg) => {
                    const result = reg.regexp.exec(update.message.text);

                    if (result) {
                        reg.regexp.lastIndex = 0;
                        reg.callback(update.message, result);

                        return this.options.onlyFirstMatch;
                    } else {
                        return false;
                    }
                });
            }

            if (update.message.reply_to_message) {
                this._replyListeners.forEach((reply) => {
                    if (reply.chatId === update.message.chat.id) {
                        if (reply.messageId === update.message.reply_to_message.message_id) {
                            reply.callback(update.message);
                        }
                    }
                });
            }
        } else if (update.edited_message) {
            this.emit('edited_message', update.edited_message);

            if (update.edited_message.text) {
                this.emit('edited_message_text', update.edited_message);
            }

            if (update.edited_message.caption) {
                this.emit('edited_message_caption', update.edited_message);
            }
        } else if (update.channel_post) {
            this.emit('channel_post', update.channel_post);
        } else if (update.edited_channel_post) {
            this.emit('edited_channel_post', update.edited_channel_post);

            if (update.edited_channel_post.text) {
                this.emit('edited_channel_post_text', update.edited_channel_post);
            }

            if (update.edited_channel_post.caption) {
                this.emit('edited_channel_post_caption', update.edited_channel_post);
            }
        } else if (update.inline_query) {
            this.emit('inline_query', update.inline_query);
        } else if (update.chosen_inline_result) {
            this.emit('chosen_inline_result', update.chosen_inline_result);
        } else if (update.callback_query) {
            this.emit('callback_query', update.callback_query);
        } else if (update.shipping_query) {
            this.emit('shipping_query', update.shipping_query);
        } else if (update.pre_checkout_query) {
            this.emit('pre_checkout_query', update.pre_checkout_query);
        }
    }

    // ======== methods: basic ========

    getMe() {
        // TODO
    }

    sendMessage(chatId, text, form = {}) {
        form.chat_id = chatId;
        form.text = text;
        return this._request('sendMessage', { form });
    }

    forwardMessage(chatId, fromChatId, messageId, form = {}) {
        form.chat_id = chatId;
        form.from_chat_id = fromChatId;
        form.message_id = messageId;
        return this._request('forwardMessage', { form });
    }

    sendPhoto(chatId, photo, options = {}) {
        const opts = {
            qs: options,
        };
        opts.qs.chat_id = chatId;
        try {
            const sendData = this._formatSendData('photo', photo);
            opts.formData = sendData[0];
            opts.qs.photo = sendData[1];
        } catch (ex) {
            return Promise.reject(ex);
        }
        return this._request('sendPhoto', opts);
    }

    sendAudio(chatId, audio, options = {}) {
        const opts = {
            qs: options
        };
        opts.qs.chat_id = chatId;
        try {
            const sendData = this._formatSendData('audio', audio);
            opts.formData = sendData[0];
            opts.qs.audio = sendData[1];
        } catch (ex) {
            return Promise.reject(ex);
        }
        return this._request('sendAudio', opts);
    }

    sendDocument(chatId, doc, options = {}, fileOpts = {}) {
        const opts = {
            qs: options
        };
        opts.qs.chat_id = chatId;
        try {
            const sendData = this._formatSendData('document', doc);
            opts.formData = sendData[0];
            opts.qs.document = sendData[1];
        } catch (ex) {
            return Promise.reject(ex);
        }
        if (opts.formData && Object.keys(fileOpts).length) {
            opts.formData.document.options = fileOpts;
        }
        return this._request('sendDocument', opts);
    }

    sendSticker(chatId, sticker, options = {}) {
        const opts = {
            qs: options
        };
        opts.qs.chat_id = chatId;
        try {
            const sendData = this._formatSendData('sticker', sticker);
            opts.formData = sendData[0];
            opts.qs.sticker = sendData[1];
        } catch (ex) {
            return Promise.reject(ex);
        }
        return this._request('sendSticker', opts);
    }

    sendVideo(chatId, video, options = {}) {
        const opts = {
            qs: options
        };
        opts.qs.chat_id = chatId;
        try {
            const sendData = this._formatSendData('video', video);
            opts.formData = sendData[0];
            opts.qs.video = sendData[1];
        } catch (ex) {
            return Promise.reject(ex);
        }
        return this._request('sendVideo', opts);
    }

    sendVoice(chatId, voice, options = {}) {
        const opts = {
            qs: options
        };
        opts.qs.chat_id = chatId;
        try {
            const sendData = this._formatSendData('voice', voice);
            opts.formData = sendData[0];
            opts.qs.voice = sendData[1];
        } catch (ex) {
            return Promise.reject(ex);
        }
        return this._request('sendVoice', opts);
    }

    sendVideoNote(chatId, videoNote, options = {}) {
        const opts = {
            qs: options
        };
        opts.qs.chat_id = chatId;
        try {
            const sendData = this._formatSendData('video_note', videoNote);
            opts.formData = sendData[0];
            opts.qs.video_note = sendData[1];
        } catch (ex) {
            return Promise.reject(ex);
        }
        return this._request('sendVideoNote', opts);
    }

    sendLocation(chatId, latitude, longitude, form = {}) {
        form.chat_id = chatId;
        form.latitude = latitude;
        form.longitude = longitude;
        return this._request('sendLocation', { form });
    }

    sendVenue(chatId, latitude, longitude, title, address, form = {}) {
        form.chat_id = chatId;
        form.latitude = latitude;
        form.longitude = longitude;
        form.title = title;
        form.address = address;
        return this._request('sendVenue', { form });
    }

    sendContact(chatId, phoneNumber, firstName, form = {}) {
        form.chat_id = chatId;
        form.phone_number = phoneNumber;
        form.first_name = firstName;
        return this._request('sendContact', { form });
    }

    sendChatAction(chatId, action) {
        const form = {
            action,
            chat_id: chatId
        };
        return this._request('sendChatAction', { form });
    }

    getUserProfilePhotos(userId, form = {}) {
        form.user_id = userId;
        return this._request('getUserProfilePhotos', { form });
    }

    getFile(fileId) {
        const form = { file_id: fileId };
        return this._request('getFile', { form });
    }

    kickChatMember(chatId, userId) {
        const form = {
            chat_id: chatId,
            user_id: userId
        };
        return this._request('kickChatMember', { form });
    }

    unbanChatMember(chatId, userId) {
        const form = {
            chat_id: chatId,
            user_id: userId
        };
        return this._request('unbanChatMember', { form });
    }

    // TODO: some APIs are not implemented

    leaveChat(chatId) {
        const form = {
            chat_id: chatId
        };
        return this._request('leaveChat', { form });
    }

    getChat(chatId) {
        const form = {
            chat_id: chatId
        };
        return this._request('getChat', { form });
    }

    getChatAdministrators(chatId) {
        const form = {
            chat_id: chatId
        };
        return this._request('getChatAdministrators', { form });
    }

    getChatMembersCount(chatId) {
        const form = {
            chat_id: chatId
        };
        return this._request('getChatMembersCount', { form });
    }

    getChatMember(chatId, userId) {
        const form = {
            chat_id: chatId,
            user_id: userId
        };
        return this._request('getChatMember', { form });
    }

    answerCallbackQuery(callbackQueryId, text, showAlert, form = {}) {
        form.callback_query_id = callbackQueryId;
        form.text = text;
        form.show_alert = showAlert;
        return this._request('answerCallbackQuery', { form });
    }

    // ======== methods: updating messages ========

    editMessageText(text, form = {}) {
        form.text = text;
        return this._request('editMessageText', { form });
    }

    editMessageCaption(caption, form = {}) {
        form.caption = caption;
        return this._request('editMessageCaption', { form });
    }

    editMessageReplyMarkup(replyMarkup, form = {}) {
        form.reply_markup = replyMarkup;
        return this._request('editMessageReplyMarkup', { form });
    }

    deleteMessage(chatId, messageId, form = {}) {
        form.chat_id = chatId;
        form.message_id = messageId;
        return this._request('deleteMessage', { form });
    }

    // ======== methods: inline mode ========

    answerInlineQuery(inlineQueryId, results, form = {}) {
        form.inline_query_id = inlineQueryId;
        form.results = JSON.stringify(results);
        return this._request('answerInlineQuery', { form });
    }

    // ======== methods: payments ========

    sendInvoice(chatId, title, description, payload, providerToken, startParameter, currency, prices, form = {}) {
        form.chat_id = chatId;
        form.title = title;
        form.description = description;
        form.payload = payload;
        form.provider_token = providerToken;
        form.start_parameter = startParameter;
        form.currency = currency;
        form.prices = JSON.stringify(prices);
        return this._request('sendInvoice', { form });
    }

    answerShippingQuery(shippingQueryId, ok, form = {}) {
        form.shipping_query_id = shippingQueryId;
        form.ok = ok;
        return this._request('answerShippingQuery', { form });
    }

    answerPreCheckoutQuery(preCheckoutQueryId, ok, form = {}) {
        form.pre_checkout_query_id = preCheckoutQueryId;
        form.ok = ok;
        return this._request('answerPreCheckoutQuery', { form });
    }

    // ======== methods: games ========

    sendGame(chatId, gameShortName, form = {}) {
        form.chat_id = chatId;
        form.game_short_name = gameShortName;
        return this._request('sendGame', { form });
    }

    setGameScore(userId, score, form = {}) {
        form.user_id = userId;
        form.score = score;
        return this._request('setGameScore', { form });
    }

    getGameHighScores(userId, form = {}) {
        form.user_id = userId;
        return this._request('getGameHighScores', { form });
    }

    // ======== file downloading ========

    getFileLink(fileId) {
        return this.getFile(fileId)
            .then((resp) => {
                return this.options.baseApiUrl + '/file/bot' + this.token + '/' + resp.file_path;
            });
    }

    downloadFile(fileId, downloadDir) {
        return this
            .getFileLink(fileId)
            .then((fileURI) => {
                const fileName = fileURI.slice(fileURI.lastIndexOf('/') + 1);
                // TODO: ensure fileName doesn't contains slashes
                const filePath = path.join(downloadDir, fileName);

                // notice: properly handles errors and closes all streams
                return Promise
                    .fromCallback((next) => {
                        pump(streamedRequest({ uri: fileURI }), fs.createWriteStream(filePath), next);
                    })
                    .return(filePath);
            });
    }

    // ======== customized events ========

    onText(regexp, callback) {
        this._textRegexpCallbacks.push({ regexp, callback });
    }

    removeTextListener(regexp) {
        const index = this._textRegexpCallbacks.findIndex((textListener) => {
            return textListener.regexp === regexp;
        });
        if (index === -1) {
            return null;
        }
        return this._textRegexpCallbacks.splice(index, 1)[0];
    }

    onReplyToMessage(chatId, messageId, callback) {
        const id = ++this._replyListenerId;
        this._replyListeners.push({
            id,
            chatId,
            messageId,
            callback
        });
        return id;
    }

    removeReplyListener(replyListenerId) {
        const index = this._replyListeners.findIndex((replyListener) => {
            return replyListener.id === replyListenerId;
        });
        if (index === -1) {
            return null;
        }
        return this._replyListeners.splice(index, 1)[0];
    }
}

module.exports = WechatyTelegramBot;
