Wechaty Telegram Bot Adaptor
===

Run your Telegram bot on WeChat!

Powered by [Wechaty](https://github.com/Chatie/wechaty).

Usage
---

This package is available on npm:

    npm install wechaty-telegram

If you are already familiar with [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api), you just need to import `wechaty-telegram` instead of the original package. It would work if you are lucky, but something may need to be fixed in most cases since this project is still in its early stage. For more information about how to use node-telegram-bot-api, please look at its [API documentation](https://github.com/yagop/node-telegram-bot-api/blob/master/doc/api.md).

The first parameter of `WechatyTelegramBot`'s constructor is an identifier of your bot. It works if you keep your Telegram bot token there, but replacing it with something else would be a better idea.

    const WechatyTelegramBot = require('wechaty-telegram');

    const bot = new WechatyTelegramBot('my_bot', {
        polling: true,
        wechaty: {
            // some wechaty options
        },
        // some other options
    });

Some methods from node-telegram-bot-api are not implemented because they are not supported by Web WeChat or Wechaty. Some behaviors may be different. In case that the method is shown implemented but it breaks your bot, please feel free to post an issue.

When you start the bot, a QR Code will be shown on the screen. Please scan it with the WeChat account you want to log your bot in.

Options
---

In addition to node-telegram-bot-api's options, there are extra options that could be passed to the constructor:

| Param                           | Type    | Default | Description                                                                        |
| ------------------------------- | ------- | ------- | ---------------------------------------------------------------------------------- |
| `options.wechaty.profile`       | String  | n/a     | The identifier of the bot. It may override the first parameter of the constructor. |
| `options.wechaty.autoAlias`     | Boolean | True    | Allowing the bot to set alias automatically.                                       |
| `options.wechaty.autoFriend`    | Boolean | True    | Allowing the bot to accept friend requests automatically.                          |
| `options.wechaty.forwardWithAt` | Boolean | True    | Forwarding messages with an @user tag.                                             |

Contribution
---

"It works" is everything. Please feel free to do any kind of contribution.

License
---

The MIT License (MIT)

Copyright (c) 2017 hcz
