const { Plugin } = require('powercord/entities')
const { getModule, React } = require('powercord/webpack')
const { inject, uninject } = require('powercord/injector')

const LinkEmbed = require('./LinkEmbed')

module.exports = class MessageLinksEmbed extends Plugin {
    async startPlugin() {
        const Message = await getModule(m => m.default && m.default.displayName == 'Message')
        inject('mlembed', Message, 'default', a => {
            const [{ childrenMessageContent: { props: { content, message } } }] = a
            if (!content || !message) return a
            const match = message.content.match(/https?:\/\/((canary|ptb)\.)?discordapp\.com\/channels\/(\d{17,19}|@me)\/\d{17,19}\/\d{17,19}/g)
            if (!match) return a
            match.forEach(link => {
                content.push(React.createElement(LinkEmbed, { link }))
            })

            return a
        }, true)
        Message.default.displayName = 'Message'
    }

    pluginWillUnload() {
        uninject('mlembed')
    }
}
