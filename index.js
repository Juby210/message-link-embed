const { Plugin } = require('powercord/entities')
const { getModule, React } = require('powercord/webpack')
const { inject, uninject } = require('powercord/injector')

const LinkEmbed = require('./LinkEmbed')

module.exports = class MessageLinksEmbed extends Plugin {
    async startPlugin() {
        const MessageContent = await getModule(m => m.type && m.type.displayName == 'MessageContent')
        inject('mlembed', MessageContent, 'type', ([{ message }], res) => {
            if (!Array.isArray(res.props.children[0]) ||
                res.props.children[0].find(c => c.type && c.type.name == 'LinkEmbed')) return res
            res.props.children[0].filter(c =>
                c.type && c.type.displayName == 'MaskedLink' &&
                c.props.href.match(/https?:\/\/((canary|ptb)\.)?discord(app)?\.com\/channels\/(\d{17,19}|@me)\/\d{17,19}\/\d{17,19}/g)
            ).forEach(c => res.props.children.push(React.createElement(LinkEmbed, { link: c.props.href, id: message.id })))

            return res
        })
        MessageContent.type.displayName = 'MessageContent'
    }

    pluginWillUnload() {
        uninject('mlembed')
    }
}
