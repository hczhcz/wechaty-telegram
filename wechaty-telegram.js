'use strict';

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

    _tgUserContact(contact) {
        let id = null;

        if (String(contact.alias()).match(/^#\d+/)) {
            id = parseInt(contact.alias().slice(1), 10);
        } else {
            // notice: may affect the performance
            for (const i in this._buffers.contact) {
                if (this._buffers.contact[i].id === contact.id) {
                    id = i;
                    this._buffers.contact[i] = contact; // update

                    break;
                }
            }

            if (!id) {
                id = this._uniqueId('contact', contact);

                if (this.options.wechaty.autoAlias) {
                    contact.alias('#' + id);
                }
            }
        }

        return {
            id: id,
            first_name: contact.name(),
            // username: contact.weixin(),
        };
    }

    _tgChatContact(contact) {
        const chat = this._tgUserContact(contact);

        chat.type = 'private';

        return chat;
    }

    _tgChatRoom(room) {
        let id = null;

        if (String(room.alias(this.wechaty.self())).match(/^#\d+/)) {
            id = parseInt(room.alias(this.wechaty.self()).slice(1), 10);
        } else {
            // notice: may affect the performance
            for (const i in this._buffers.room) {
                if (this._buffers.room[i].id === room.id) {
                    id = i;
                    this._buffers.room[i] = room; // update

                    break;
                }
            }

            if (!id) {
                id = this._uniqueId('room', room);
                // notice: not able to set a chatroom id automatically
            }
        }

        return {
            id: -id,
            type: 'group',
            title: room.topic(),
            all_members_are_administrators: false,
        };
    }

    _tgMessage(message) {
        const entities = [];

        // notice: the other entities are not supported
        //         the bot should parse the text by itself
        message.mentioned().forEach((contact) => {
            entities.push({
                type: 'text_mention',
                offset: 0, // TODO
                length: 0, // TODO
                user: this._tgUserContact(contact),
            });
        });

        message.tgMessage = {
            message_id: this._uniqueId('message', message),
            from: this._tgUserContact(message.from()),
            date: Date.now(),
            chat: message.room()
                ? this._tgChatRoom(message.room())
                : this._tgChatContact(message.from()),
            text: message.content(),
            // TODO: other content types
            entities: entities,
        };

        return message.tgMessage;
    }

    _wxContact(userId) {
        return wechaty.Contact.find({
            alias: '#' + userId,
        }).then((contact) => {
            if (contact) {
                return contact;
            } else if (this._buffers.contact[userId]) {
                // data in the buffer may be out of date
                return this._buffers.contact[userId];
            } else {
                return new errors.TelegramError('contact not found');
            }
        });
    }

    _wxRoom(chatId) {
        return wechaty.Room.findAll().then((rooms) => {
            return rooms.find((room) => {
                return room.alias(this.wechaty.self()) === '#' + -chatId;
            });
        }).then((room) => {
            if (room) {
                return room;
            } else if (this._buffers.room[-chatId]) {
                // data in the buffer may be out of date
                return this._buffers.room[-chatId];
            } else {
                return new errors.TelegramError('room not found');
            }
        });
    }

    // ======== initialization ========

    constructor(profile = null, options = {}) {
        super();

        const objectOption = (root, key) => {
            if (root[key] === true) {
                root[key] = {};
            }
        };

        const defaultOption = (root, key, value) => {
            if (typeof root[key] === 'undefined') {
                root[key] = value;
            }
        };

        this.options = options;
        defaultOption(this.options, 'polling', false);
        objectOption(this.options, 'polling');
        if (this.options.polling) {
            defaultOption(this.options.polling, 'autoStart', true);
        }
        defaultOption(this.options, 'webHook', false);
        objectOption(this.options, 'webHook');
        if (this.options.webHook) {
            defaultOption(this.options.webHook, 'autoOpen', true);
        }
        defaultOption(this.options, 'onlyFirstMatch', false);
        // defaultOption(this.options, 'filepath', true); // TODO
        defaultOption(this.options, 'wechaty', {});
        objectOption(this.options, 'wechaty');
        defaultOption(this.options.wechaty, 'profile', profile);
        defaultOption(this.options.wechaty, 'autoAlias', true);
        defaultOption(this.options.wechaty, 'autoFriend', true);
        defaultOption(this.options.wechaty, 'forwardWithAt', true);
        // TODO: allow slient fail if wechat does not support the method

        // notice: wechaty supports singleton only
        this.wechaty = wechaty.Wechaty.instance(this.options.wechaty);

        // other events: 'heartbeat', 'login', 'logout', 'scan'
        this.wechaty.on('error', (err) => {
            if (this._mode === 'polling') {
                this.emit('polling_error', err);
            } else if (this._mode === 'webhook') {
                this.emit('webhook_error', err);
            } else {
                this.emit('standby_error', err); // notice: custom event
            }
        }).on('friend', (contact, request) => {
            if (request && this.options.wechaty.autoFriend) {
                request.accept();
            }

            this.processUpdate({
                update_id: this._uniqueId('update'),
                message: {
                    message_id: this._uniqueId('sysmessage'),
                    from: this._tgUserContact(contact),
                    date: Date.now(),
                    chat: this._tgChatContact(contact),
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
                this.processUpdate({
                    update_id: this._uniqueId('update'),
                    message: this._tgMessage(message),
                });
            }
        }).on('room-join', (room, invitees, inviter) => {
            const members = [];

            invitees.forEach((invitee) => {
                members.push(this._tgUserContact(invitee));
            });

            this.processUpdate({
                update_id: this._uniqueId('update'),
                message: {
                    message_id: this._uniqueId('sysmessage'),
                    from: this._tgUserContact(inviter),
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
                        from: this._tgUserContact(leaver), // notice: can not detect admin kicking
                        date: Date.now(),
                        chat: this._tgChatRoom(room),
                        left_chat_member: this._tgUserContact(leaver),
                    },
                });
            });
        }).on('room-topic', (room, newTitle, oldTitle, changer) => {
            this.processUpdate({
                update_id: this._uniqueId('update'),
                message: {
                    message_id: this._uniqueId('sysmessage'),
                    from: this._tgUserContact(changer),
                    date: Date.now(),
                    chat: this._tgChatRoom(room),
                    new_chat_title: newTitle,
                },
            });
        });

        this._mode = 'standby';
        this._textRegexpCallbacks = [];
        this._replyListeners = [];

        this._buffers = {
            contact: {
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

        if (this.options.polling && this.options.polling.autoStart) {
            this.startPolling();
        }

        if (this.options.webHook && this.options.webHook.autoOpen) {
            this.openWebHook();
        }
    }

    // ======== polling ========

    startPolling(options = {}) {
        if (this.hasOpenWebHook()) {
            return Promise.reject(new errors.FatalError('polling and webhook are mutually exclusive'));
        } else if (options.restart) {
            return this.stopPolling().then(() => {
                return this.wechaty.init().then(() => {
                    this._mode = 'polling';
                });
            });
        } else {
            return this.wechaty.init().then(() => {
                this._mode = 'polling';
            });
        }
    }

    // deprecated
    initPolling(options = {}) {
        return this.startPolling(options);
    }

    stopPolling() {
        this._mode = 'standby';

        return this.wechaty.quit();
    }

    isPolling() {
        return this._mode === 'polling' && this.wechaty.state.current() === 'ready';
    }

    getUpdates(form = {}) {
        return Promise.resolve([]);
    }

    // ======== web hook ========

    openWebHook() {
        if (this.isPolling()) {
            return Promise.reject(new errors.FatalError('polling and webhook are mutually exclusive'));
        } else {
            return this.wechaty.init().then(() => {
                this._mode = 'webhook';
            });
        }
    }

    closeWebHook() {
        this._mode = 'standby';

        return this.wechaty.quit();
    }

    hasOpenWebHook() {
        return this._mode === 'webhook' && this.wechaty.state.current() === 'ready';
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
        return Promise.resolve(this._tgUserContact(this.wechaty.self()));
    }

    sendMessage(chatId, text, form = {}) {
        // notice: parse_mode is not supported
        // TODO: reply_markup

        if (chatId >= 0) {
            return this._wxContact(chatId).then((contact) => {
                const replyMessage = this._buffers.message[form.reply_to_message_id];
                const reply = replyMessage ? replyMessage.from() : null;

                return contact.say(text, reply).then((succeed) => {
                    if (succeed) {
                        const message = {
                            message_id: this._uniqueId('message'),
                            from: this._tgUserContact(this.wechaty.self()),
                            date: Date.now(),
                            chat: this._tgChatContact(contact),
                            text: text,
                            // TODO: other content types
                            entities: [],
                        };

                        if (replyMessage) {
                            message.reply_to_message = replyMessage.tgMessage;
                        }

                        return message;
                    } else {
                        return new errors.TelegramError('failed to send message');
                    }
                });
            });
        } else {
            return this._wxRoom(chatId).then((room) => {
                const replyMessage = this._buffers.message[form.reply_to_message_id];
                const reply = replyMessage ? replyMessage.from() : null;

                return room.say(text, reply).then((succeed) => {
                    if (succeed) {
                        const message = {
                            message_id: this._uniqueId('message'),
                            from: this._tgUserContact(this.wechaty.self()),
                            date: Date.now(),
                            chat: this._tgChatRoom(room),
                            text: text,
                            // TODO: other content types
                            entities: [],
                        };

                        if (replyMessage) {
                            message.reply_to_message = replyMessage.tgMessage;
                        }

                        return message;
                    } else {
                        return new errors.TelegramError('failed to send message');
                    }
                });
            });
        }
    }

    forwardMessage(chatId, fromChatId, messageId, form = {}) {
        const forwardMessage = this._buffers.message[messageId];

        if (forwardMessage) {
            return this.sendMessage(chatId, forwardMessage.content(), {
                reply_to_message_id: this.options.wechaty.forwardWithAt ? messageId : null,
            }).then((message) => {
                message.forward_from = forwardMessage.tgMessage.from;
                message.forward_from_chat = forwardMessage.tgMessage.chat;
                message.forward_from_message_id = forwardMessage.tgMessage.message_id;
                message.forward_date = forwardMessage.tgMessage.date;

                return message;
            });
        } else {
            return new errors.TelegramError('message not found');
        }
    }

    sendPhoto(chatId, photo, options = {}) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    sendAudio(chatId, audio, options = {}) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    sendDocument(chatId, doc, options = {}, fileOpts = {}) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    sendSticker(chatId, sticker, options = {}) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    sendVideo(chatId, video, options = {}) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    sendVoice(chatId, voice, options = {}) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    sendVideoNote(chatId, videoNote, options = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    sendLocation(chatId, latitude, longitude, form = {}) {
        return Promise.reject(new Error('not supported in wechat')); // TODO: ?
    }

    sendVenue(chatId, latitude, longitude, title, address, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    sendContact(chatId, phoneNumber, firstName, form = {}) {
        return Promise.reject(new Error('not supported in wechat')); // TODO: ?
    }

    sendChatAction(chatId, action) {
        return Promise.reject(new Error('not supported in wechat')); // TODO: ?
    }

    getUserProfilePhotos(userId, form = {}) {
        return Promise.reject(new Error('not supported in wechat')); // TODO: ?
    }

    getFile(fileId) {
        // TODO: provide a mock solution?
        return Promise.reject(new Error('not supported in wechat'));
    }

    kickChatMember(chatId, userId) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    unbanChatMember(chatId, userId) {
        // TODO: implement as inviting chat member
        return Promise.reject(new Error('not implemented')); // TODO
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
        return Promise.reject(new Error('not implemented')); // TODO
    }

    setChatDescription(chatId, description, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    pinChatMessage(chatId, messageId, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    unpinChatMessage(chatId, form = {}) {
        return Promise.reject(new Error('not supported in wechat'));
    }

    leaveChat(chatId) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    getChat(chatId) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    getChatAdministrators(chatId) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    getChatMembersCount(chatId) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    getChatMember(chatId, userId) {
        return Promise.reject(new Error('not implemented')); // TODO
    }

    answerCallbackQuery(form = {}) {
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
        // TODO
        return this.getFile(fileId).then((file) => {
            return null;
            // return this.options.baseApiUrl + '/file/bot' + this.token + '/' + resp.file_path;
        });
    }

    downloadFile(fileId, downloadDir) {
        // TODO
        return this.getFile(fileId).then((file) => {
            return null; // TODO: return the downloaded file path
        });
    }
}

module.exports = WechatyTelegramBot;
