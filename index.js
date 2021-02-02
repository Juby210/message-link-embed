const { Plugin } = require('powercord/entities')
const { findInReactTree } = require('powercord/util')
const { getModule, getModuleByDisplayName, http: { get }, constants: { Endpoints }, React } = require('powercord/webpack')
const { inject, uninject } = require('powercord/injector')

const cache = {}, suppressed = []
let lastFetch = 0

const { getMessage } = getModule(['getMessages'], false)
const dispatcher = getModule(['dispatch'], false)
const User = getModule(m => m.prototype && m.prototype.tag, false)
const Timestamp = getModule(m => m.prototype && m.prototype.toDate && m.prototype.month, false)

const isMLEmbed = e => e && e.author && e.author.name[1] && e.author.name[1].props && e.author.name[1].props.__mlembed
const isVideo = attachment => !!attachment.video || !!attachment.url.match(/\.(?:mp4|mov|webm)$/)

module.exports = class MessageLinksEmbed extends Plugin {
    async startPlugin() {
        this.loadStylesheet('style.css')

        const MessageContent = await getModule(m => m.type && m.type.displayName == 'MessageContent')
        inject('mlembed-message', MessageContent, 'type', ([{ message }], res) => {
            const children = res.props.children.find(c => Array.isArray(c))
            if (suppressed.includes(message.id) || !children || (message.embeds[0] && isMLEmbed(message.embeds[0]))) return res
            this.processLinks(message, children.filter(c =>
                c.type && c.type.displayName == 'MaskedLink' &&
                c.props.href.match(/https?:\/\/((canary|ptb)\.)?discord(app)?\.com\/channels\/(\d{17,19}|@me)\/\d{17,19}\/\d{17,19}/g)
            ).map(c => c.props.href))

            return res
        })
        MessageContent.type.displayName = 'MessageContent'

        const _this = this
        const { jumpToMessage } = await getModule(['jumpToMessage'])
        const Attachment = await getModuleByDisplayName('Attachment')

        const Embed = await getModuleByDisplayName('Embed')
        inject('mlembed', Embed.prototype, 'render', function (args) {
            if (!this.props.embed || !isMLEmbed(this.props.embed)) return args

            const msg = this.props.embed.author.name[1].props.__mlembed // hack
            const { renderAll } = this
            this.renderAll = function () {
                const res = renderAll.apply(this)

                const c = findInReactTree(res.author, c => c.href)
                if (c) {
                    c.onClick = e => {
                        e.preventDefault()
                        const linkArray = c.href.split('/')
                        jumpToMessage(linkArray[5], linkArray[6])
                    }
                }

                if (!this.props.embed._attachment) return res
                res.media = React.createElement(Attachment, { className: 'mle-attachment', ...this.props.embed._attachment })

                return res
            }
            this.props.onSuppressEmbed = () => {
                suppressed.push(msg.embedmessage.id)
                const m = getMessage(msg.embedmessage.channel_id, msg.embedmessage.id) || { embeds: [] }
                _this.updateMessageEmbeds(msg.embedmessage.id, msg.embedmessage.channel_id, m.embeds.filter(e => !isMLEmbed(e)))
            }
            if (this.props.embed.__mlembed) return args // we changed embed props before, so we don't need to change it again

            let attachment
            if (msg.attachments[0] && msg.attachments[0].width) attachment = msg.attachments[0]
            if (msg.embeds[0]) {
                const embed = msg.embeds[0]
                if (embed.type == 'image') attachment = embed.image || embed.thumbnail
                else if (embed.type == 'video' || embed.type == 'gifv') attachment = embed
            }
            if (attachment) {
                if (!attachment.proxyURL) attachment.proxyURL = attachment.proxy_url
                if (isVideo(attachment)) {
                    if (attachment.provider) this.props.embed = {
                        ...this.props.embed,
                        video: attachment.video,
                        thumbnail: attachment.thumbnail,
                        url: attachment.video.url
                    }; else {
                        if (attachment.video) attachment = attachment.video
                        if (attachment.height > 400) attachment.height = 400
                        if (attachment.width > 400) attachment.width = 400
                        this.props.embed = {
                            ...this.props.embed,
                            video: attachment,
                            thumbnail: { url: attachment.proxyURL + '?format=jpeg', height: attachment.height, width: attachment.width },
                            url: attachment.url
                        }
                    }
                } else {
                    this.props.embed.image = attachment
                    msg.attachments.forEach(a => {
                        if (a.width && !isVideo(a)) {
                            if (!this.props.embed.images) this.props.embed.images = []
                            this.props.embed.images.push(a)
                        }
                    })
                    msg.embeds.forEach(e => {
                        if (e.type == 'image') {
                            if (!this.props.embed.images) this.props.embed.images = []
                            this.props.embed.images.push(e.image || e.thumbnail)
                        }
                    })
                    if (this.props.embed.images && this.props.embed.images.length == 1) delete this.props.embed.images
                }
            } else if (msg.attachments[0] && msg.attachments[0].hasOwnProperty('size')) this.props.embed._attachment = msg.attachments[0]
            this.props.embed.__mlembed = true

            return args
        }, true)
    }

    pluginWillUnload() {
        uninject('mlembed-message')
        uninject('mlembed')
    }

    // queue based on https://stackoverflow.com/questions/53540348/js-async-await-tasks-queue
    getMsgWithQueue = (() => {
        let pending = Promise.resolve()

        const run = async (channelId, messageId) => {
            try {
                await pending
            } finally {
                return this.getMsg(channelId, messageId)
            }
        }

        return (channelId, messageId) => (pending = run(channelId, messageId))
    })()

    async getMsg(channelId, messageId) {
        let message = getMessage(channelId, messageId) || cache[messageId]
        if (!message) {
            if (lastFetch > Date.now() - 2500) await new Promise(r => setTimeout(r, 2500))
            try {
                const data = await get({
                    url: Endpoints.MESSAGES(channelId),
                    query: {
                        limit: 1,
                        around: messageId
                    },
                    retries: 2
                })
                lastFetch = Date.now()
                message = data.body.find(m => m.id == messageId)
                if (!message) return
                message.author = new User(message.author)
                message.timestamp = new Timestamp(message.timestamp)
            } catch(e) { return }
        }
        cache[messageId] = message
        return message
    }

    async processLinks(message, links = []) {
        const { parse } = await getModule(['parse', 'parseTopic'])

        const embeds = []
        for (let i = 0; i < links.length; i++) {
            const linkArray = links[i].split('/')
            const msg = await this.getMsgWithQueue(linkArray[5], linkArray[6])
            if (msg) embeds.push({
                author: {
                    proxy_icon_url: msg.author.avatarURL,
                    icon_url: msg.author.avatarURL,
                    name: [ msg.author.tag, React.createElement(() => null, { __mlembed: { ...msg, embedmessage: message } }) ], // hack
                    url: links[i]
                },
                color: msg.colorString ? parseInt(msg.colorString.substr(1), 16) : undefined,
                description: msg.content,
                footer: { text: parse(`<#${msg.channel_id}>`) },
                timestamp: msg.timestamp,
                type: 'rich'
            })
        }
        if (!embeds.length) return

        this.updateMessageEmbeds(message.id, message.channel_id, [ ...embeds, ...message.embeds ])
    }
    updateMessageEmbeds(id, cid, embeds) {
        const { getChannel } = getModule(['getChannel'], false)
        dispatcher.dispatch({ type: 'MESSAGE_UPDATE', message: {
            channel_id: cid,
            guild_id: getChannel(cid).guild_id,
            id, embeds
        }})
    }
}
