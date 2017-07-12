'use strict';

const fs = require('fs');

const EventEmitter = require('events');
const wechaty = require('wechaty');

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

    _uniqueId(key, data) {
        const buffer = this._buffers[key];

        while (Date.now() === buffer.last) {
            // spin
            // Date.now() should not be less than buffer.last
        }

        buffer.last += 1;

        if (buffer.bufsize) {
            buffer[buffer.last] = data;
            delete buffer[buffer.last - buffer.bufsize];
        }

        return buffer.last;
    }

    _tgUser(user) {
        let id;

        if (user.alias().match(/^#\d+/)) {
            id = parseInt(user.alias().slice(1), 10);
        } else {
            id = this._uniqueId('user', user);
            user.alias('#' + id);
        }

        return {
            id: id,
            first_name: user.name(),
            // username: user.weixin(),
        };
    }

    _tgChatUser(user) {
        let id;

        if (user.alias().match(/^#\d+/)) {
            id = parseInt(user.alias().slice(1), 10);
        } else {
            id = this._uniqueId('user', user);
            user.alias('#' + id);
        }

        return {
            id: id,
            type: 'private',
            first_name: user.name(),
            // username: user.weixin(),
        };
    }

    _tgChatRoom(room) {
        let id;

        if (room.alias(this.wechaty.self()).match(/^#\d+/)) {
            id = parseInt(room.alias(this.wechaty.self()).slice(1), 10);
        } else {
            id = this._uniqueId('room', room);
            // notice: not able to identify a chatroom automatically
        }

        return {
            id: -id,
            type: 'group',
            title: room.topic(),
            all_members_are_administrators: false,
        };
    }

    _wxUser(userId) {
        if (this._buffers.user[userId]) {
            return Promise.resolve(this._buffers.user[userId]);
        } else {
            return wechaty.Contact.find({
                alias: '#' + userId,
            });
        }
        //
    }

    _wxRoom(chatId) {
        if (this._buffers.room[-chatId]) {
            return Promise.resolve(this._buffers.room[-chatId]);
        } else {
            return wechaty.Room.findAll().then((rooms) => {
                return rooms.find((room) => {
                    return room.alias(this.wechaty.self()) === '#' + -chatId;
                });
            });
        }
    }

    // ======== initialization ========

    constructor(profile = null, options = {}) {
        super();

        this.options = options;
        this.options.wechaty = this.options.wechaty || {};
        this.options.wechaty.profile = profile || this.options.wechaty.profile;
        // this.options.wechaty.autoFriend

        this.wechaty = new wechaty.Wechaty(this.options.wechaty);

        // other events: 'heartbeat', 'login', 'logout', 'scan'
        this.wechaty.on('error', (err) => {
            if (this.listeners('polling_error').length) {
                this.emit('polling_error', err);
            } else if (this.listeners('webhook_error').length) {
                this.emit('webhook_error', err);
            } else {
                console.error(err);
            }
        }).on('friend', (contact, request) => {
            if (request && this.options.wechaty.autoFriend) {
                request.accept();
            }

            this.processUpdate({
                update_id: this._uniqueId('update'),
                message: {
                    message_id: this._uniqueId('sysmessage'),
                    from: this._tgUser(contact),
                    date: Date.now(),
                    chat: this._tgChatUser(contact),
                    text: '/start',
                    entities: [{
                        type: 'bot_command',
                        offset: 0,
                        length: 6,
                    }],
                },
            });
        }).on('message', (message) => {
            if (!message.self()) {
                const entities = [];

                // notice: the other entities are not supported
                //         the bot should parse the text by itself
                message.mentioned().forEach((contact) => {
                    entities.push({
                        type: 'mention',
                        offset: 0, // TODO
                        length: 0, // TODO
                        user: this._tgUser(contact),
                    });
                });

                this.processUpdate({
                    update_id: this._uniqueId('update'),
                    message: {
                        message_id: this._uniqueId('message', message),
                        from: this._tgUser(message.from()),
                        date: Date.now(),
                        chat: message.room()
                            ? this._tgChatRoom(message.room())
                            : this._tgChatUser(message.from()),
                        text: message.content(),
                        // TODO: other content types
                        entities: entities,
                    },
                });
            }
        }).on('room-join', (room, invitees, inviter) => {
            const members = [];

            invitees.forEach((invitee) => {
                members.push(this._tgUser(invitee));
            });

            this.processUpdate({
                update_id: this._uniqueId('update'),
                message: {
                    message_id: this._uniqueId('sysmessage'),
                    from: this._tgUser(inviter),
                    date: Date.now(),
                    chat: this._tgChatRoom(room),
                    new_chat_member: members[0],
                    new_chat_members: members,
                },
            });
        }).on('room-leave', (room, leavers) => {
            leavers.forEach((leaver) => {
                this.processUpdate({
                    update_id: this._uniqueId('update'),
                    message: {
                        message_id: this._uniqueId('sysmessage'),
                        from: this._tgUser(leaver), // notice: can not detect admin kicking
                        date: Date.now(),
                        chat: this._tgChatRoom(room),
                        left_chat_member: this._tgUser(leaver),
                    },
                });
            });
        }).on('room-topic', (room, newTitle, oldTitle, changer) => {
            this.processUpdate({
                update_id: this._uniqueId('update'),
                message: {
                    message_id: this._uniqueId('sysmessage'),
                    from: this._tgUser(changer),
                    date: Date.now(),
                    chat: this._tgChatRoom(room),
                    new_chat_title: newTitle,
                },
            });
        });

        this._textRegexpCallbacks = [];
        this._replyListeners = [];

        this._buffers = {
            user: {
                last: Date.now() - 1,
                bufsize: 65536,
            },
            room: {
                last: Date.now() - 1,
                bufsize: 65536,
            },
            update: {
                last: Date.now() - 1,
            },
            message: {
                last: Date.now() - 1,
                bufsize: 1048576,
            },
            sysmessage: {
                last: Date.now() - 1,
            },
            callback: {
                last: Date.now() - 1,
            },
        };

        if (options.polling) {
            const autoStart = options.polling.autoStart;

            if (typeof autoStart === 'undefined' || autoStart === true) {
                this.startPolling();
            }
        } else if (options.webHook) {
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
        return Promise.resolve([]);
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
        return Promise.resolve(true);
    }

    deleteWebHook() {
        return Promise.resolve(true);
    }

    getWebHookInfo() {
        return Promise.resolve({
            url: '',
            has_custom_certificate: false,
            pending_update_count: 0,
        });
    }

    // ======== customized events ========

    onText(regexp, callback) {
        this._textRegexpCallbacks.push({
            regexp: regexp,
            callback: callback,
        });
    }

    removeTextListener(regexp) {
        const index = this._textRegexpCallbacks.findIndex((textListener) => {
            return textListener.regexp === regexp;
        });

        if (index >= 0) {
            return this._textRegexpCallbacks.splice(index, 1)[0];
        } else {
            return null;
        }
    }

    onReplyToMessage(chatId, messageId, callback) {
        const id = this._uniqueId('callback');

        this._replyListenerId += 1;

        this._replyListeners.push({
            id: id,
            chatId: chatId,
            messageId: messageId,
            callback: callback,
        });

        return id;
    }

    removeReplyListener(replyListenerId) {
        const index = this._replyListeners.findIndex((replyListener) => {
            return replyListener.id === replyListenerId;
        });

        if (index >= 0) {
            return this._replyListeners.splice(index, 1)[0];
        } else {
            return null;
        }
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
        return Promise.resolve(this._tgUser(this.wechaty.self()));
    }

    sendMessage(chatId, text, form = {}) {
        // TODO
        if (id < 0) {
            return this._wxRoom(chatId).then((room) => {
                room.say(text);

                return {
                    // TODO: Message object
                };
            });
        } else {
            return this._wxUser(chatId).then((user) => {
                user.say(text);

                return {
                    // TODO: Message object
                };
            });
        }
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
        return Promise.reject(new Error('not supported in wechat'));
    }

    kickChatMember(chatId, userId) {
        const form = {
            chat_id: chatId,
            user_id: userId
        };
        return this._request('kickChatMember', { form });
    }

    unbanChatMember(chatId, userId) {
        // TODO: implement as inviting chat member
    }

    restrictChatMember(chatId, userId, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    promoteChatMember(chatId, userId, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    exportChatInviteLink(chatId, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    setChatPhoto(chatId, photo, options = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    deleteChatPhoto(chatId, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    setChatTitle(chatId, title, form = {}) {
        form.chat_id = chatId;
        form.title = title;
        return this._request('setChatTitle', { form })
    }

    setChatDescription(chatId, description, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    pinChatMessage(chatId, messageId, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    unpinChatMessage(chatId, form = {}) {
        form.chat_id = chatId;
        return this._request('unpinChatMessage', { form });
    }

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
        // TODO: implement it with messages?
        return Promise.reject(new Error('not supported in wechat'));
    }

    // ======== methods: updating messages ========

    editMessageText(text, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    editMessageCaption(caption, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    editMessageReplyMarkup(replyMarkup, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    deleteMessage(chatId, messageId, form = {}) {
        // TODO: recall the message?
        return Promise.reject(new Error('not supported in wechat'));
    }

    // ======== methods: inline mode ========

    answerInlineQuery(inlineQueryId, results, form = {}) {
        // TODO: implement it with messages?
        return Promise.reject(new Error('not supported in wechat'));
    }

    // ======== methods: payments ========

    sendInvoice(chatId, title, description, payload, providerToken, startParameter, currency, prices, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    answerShippingQuery(shippingQueryId, ok, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    answerPreCheckoutQuery(preCheckoutQueryId, ok, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    // ======== methods: games ========

    sendGame(chatId, gameShortName, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    setGameScore(userId, score, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    getGameHighScores(userId, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
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
}

module.exports = WechatyTelegramBot;
