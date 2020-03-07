const { getModule, getModuleByDisplayName, React, http: { get }, constants: { Endpoints } } = require('powercord/webpack')
const cache = {}

const { getMessage } = getModule(['getMessages'], false)
const { parse } = getModule(['parse', 'parseTopic'], false)
const User = getModule(m => m.prototype && m.prototype.tag, false)
const Timestamp = getModule(m => m.prototype && m.prototype.toDate && m.prototype.month, false)
const Image = getModuleByDisplayName('LazyImageZoomable', false)
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

async function getMsg(channelId, messageId) {
    let message = cache[messageId] || getMessage(channelId, messageId)
    if (!message) {
        const data = await get({
            url: Endpoints.MESSAGES(channelId),
            query: {
                limit: 1,
                around: messageId
            },
            retries: 2
        })
        message = data.body[0]
        if (!message) return
        message.author = new User(message.author)
        message.timestamp = new Timestamp(message.timestamp)
        await new Promise(r => setTimeout(r, 2500))
    }
    cache[messageId] = message
    return message
}

module.exports = class LinkEmbed extends React.Component {
    constructor(props) {
        super(props)
        this.state = props.message
    }

    async componentDidMount() {
        if (!this.state) {
            const linkArray = this.props.link.split('/')
            this.setState(await getMsgWithQueue(linkArray[5], linkArray[6]))
        }
    }

    render() {
        if (!this.state) return null

        let image
        if (this.state.attachments[0] && this.state.attachments[0].width) image = this.state.attachments[0]
        if (this.state.embeds[0] && this.state.embeds[0].type == 'image')
            image = this.state.embeds[0].image || this.state.embeds[0].thumbnail
        if (image && !image.proxy_url) image.proxy_url = image.proxyURL

        // unfortunately, but there is no easy-to-use embed component
        return (<div class={classes.container}>
            <div class={`${classes.embed} ${classes.embedFull} ${classes.embedWrapper} ${classes.markup} ${classes.grid}`}>
                <div class={`${classes.embedAuthor} ${classes.embedMargin}`}>
                    <img class={classes.embedAuthorIcon} src={this.state.author.avatarURL} />
                    <a class={`${classes.anchor} ${classes.embedAuthorName} ${classes.embedAuthorNameLink} ${classes.embedLink}`}
                        href={this.props.link} rel='noreferrer noopener' target='_blank'>{this.state.author.tag}</a>
                </div>
                <div class={`${classes.embedDescription} ${classes.embedMargin}`}>
                    {parse(this.state.content)}
                </div>
                {image ? (<Image
                    width={image.width}
                    height={image.height}
                    original={image.url}
                    src={image.proxy_url}
                    className={`${classes.embedMedia} ${classes.embedImage} ${classes.embedWrapper}`}
                    shouldLink={true} />) : null}
                <div class={`${classes.embedFooter} ${classes.embedFooterText} ${classes.embedMargin}`}>
                    {parse(`<#${this.state.channel_id}>`)}
                    <span class={classes.embedFooterSeparator}>•</span>
                    <MessageTimestamp timestamp={this.state.timestamp} />
                </div>
            </div>
        </div>)
    }
}
