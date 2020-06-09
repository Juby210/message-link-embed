const { getModule, getModuleByDisplayName, React, http: { get }, constants: { Endpoints } } = require('powercord/webpack')
const cache = {}, suppressed = []

const { getMessage } = getModule(['getMessages'], false)
const { jumpToMessage } = getModule(['jumpToMessage'], false)
const { parse } = getModule(['parse', 'parseTopic'], false)
const { renderImageComponent, renderVideoComponent } = getModule(['renderVideoComponent'], false)
const { renderSuppressButton } = getModuleByDisplayName('Embed', false).prototype
const User = getModule(m => m.prototype && m.prototype.tag, false)
const Timestamp = getModule(m => m.prototype && m.prototype.toDate && m.prototype.month, false)
const { EmbedVideo } = getModule(['EmbedVideo'], false)
const { MessageTimestamp } = getModule(['MessageTimestamp'], false)
const classes = {
    ...getModule(['anchorUnderlineOnHover'], false),
    ...getModule(['embedAuthor'], false),
    ...getModule(['embedWrapper'], false),
    markup: getModule(['markup'], false).markup
}

// queue based on https://stackoverflow.com/questions/53540348/js-async-await-tasks-queue
const getMsgWithQueue = (() => {
    let pending = Promise.resolve()

    const run = async (channelId, messageId) => {
        try {
            await pending
        } finally {
            return getMsg(channelId, messageId)
        }
    }

    return (channelId, messageId) => (pending = run(channelId, messageId))
})()

let lastFetch = 0
async function getMsg(channelId, messageId) {
    let message = getMessage(channelId, messageId) || cache[messageId]
    if (!message) {
        if (lastFetch > Date.now() - 2500) await new Promise(r => setTimeout(r, 2500))
        const data = await get({
            url: Endpoints.MESSAGES(channelId),
            query: {
                limit: 1,
                around: messageId
            },
            retries: 2
        })
        lastFetch = Date.now()
        message = data.body[0]
        if (!message) return
        message.author = new User(message.author)
        message.timestamp = new Timestamp(message.timestamp)
    }
    cache[messageId] = message
    return message
}

const isVideo = attachment => !!attachment.url.match(/\.(?:mp4|mov|webm)$/)

module.exports = class LinkEmbed extends React.Component {
    constructor(props) {
        super(props)
        this.state = props.message
    }

    async componentDidMount() {
        if (!suppressed.includes(this.props.id) && !this.state) {
            const linkArray = this.props.link.split('/')
            this.setState(await getMsgWithQueue(linkArray[5], linkArray[6]))
        }
    }

    render() {
        if (suppressed.includes(this.props.id) || !this.state) return null

        let attachment = null, video
        if (this.state.attachments[0] &&
            this.state.attachments[0].width)
            attachment = this.state.attachments[0]
        if (this.state.embeds[0]) {
            const embed = this.state.embeds[0]
            if (embed.type == 'image')
                attachment = this.state.embeds[0].image || this.state.embeds[0].thumbnail
            else if (embed.type == 'video' || embed.type == 'gifv') {
                video = true
                if (embed.provider) attachment = embed
                else attachment = embed.video
            }
        }

        if (attachment) {
            if (!attachment.proxy_url) attachment.proxy_url = attachment.proxyURL
            if (video || isVideo(attachment)) {
                if (attachment.provider) attachment = (<EmbedVideo
                    className={`${classes.embedMedia} ${classes.embedWrapper}`}
                    href={attachment.url}
                    maxWidth={400}
                    playable={true}
                    renderImageComponent={renderImageComponent}
                    renderVideoComponent={renderVideoComponent}
                    thumbnail={attachment.thumbnail}
                    video={attachment.video}
                />); else attachment = renderVideoComponent({
                    className: `${classes.embedMedia} ${classes.embedWrapper}`,
                    fileName: attachment.filename,
                    fileSize: attachment.size,
                    naturalHeight: attachment.height,
                    naturalWidth: attachment.width,
                    poster: attachment.proxy_url + '?format=jpeg',
                    src: attachment.url,
                    width: attachment.width > 400 ? 400 : attachment.width
                })
            } else attachment = renderImageComponent({
                className: `${classes.embedMedia} ${classes.embedImage} ${classes.embedWrapper}`,
                src: attachment.proxy_url,
                width: attachment.width,
                height: attachment.height,
                original: attachment.url
            })
        }

        // unfortunately, but there is no easy-to-use embed component
        return (<div class={classes.container}>
            <div style={this.state.colorString ? { borderLeft: "4px solid "+this.state.colorString } : {}} class={`${classes.embed} ${classes.embedFull} ${classes.embedWrapper} ${classes.markup} ${classes.grid}`}>
                {renderSuppressButton(() => this.suppress())}
                <div class={`${classes.embedAuthor} ${classes.embedMargin}`}>
                    <img class={classes.embedAuthorIcon} src={this.state.author.avatarURL} />
                    <a class={`${classes.anchor} ${classes.embedAuthorName} ${classes.embedAuthorNameLink} ${classes.embedLink}`}
                        href={this.props.link} onClick={e => this.jumpToMessage(e)}>{this.state.author.tag}</a>
                </div>
                <div class={`${classes.embedDescription} ${classes.embedMargin}`}>
                    {parse(this.state.content)}
                </div>
                {attachment}
                <div class={`${classes.embedFooter} ${classes.embedFooterText} ${classes.embedMargin}`}>
                    {parse(`<#${this.state.channel_id}>`)}
                    <span class={classes.embedFooterSeparator}>•</span>
                    <MessageTimestamp timestamp={this.state.timestamp} />
                </div>
            </div>
        </div>)
    }

    jumpToMessage(e) {
        e.preventDefault()
        jumpToMessage(this.state.channel_id, this.state.id)
    }

    suppress() {
        suppressed.push(this.props.id)
        this.setState({})
    }
}
