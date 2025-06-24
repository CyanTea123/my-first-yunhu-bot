class Subscription {
    constructor() {
        this.callbacks = {
            'message.receive.normal': [],
            'message.receive.instruction': [],
            'bot.followed': [],
            'bot.unfollowed': [],
            'group.join': [],
            'group.leave': [],
            'button.report.inline': [],
            'bot.shortcut.menu': []
        };
    }

    onMessageNormal(callback) {
        this.callbacks['message.receive.normal'].push(callback);
    }

    onMessageInstruction(callback) {
        this.callbacks['message.receive.instruction'].push(callback);
    }

    onBotFollowed(callback) {
        this.callbacks['bot.followed'].push(callback);
    }

    onBotUnfollowed(callback) {
        this.callbacks['bot.unfollowed'].push(callback);
    }

    onGroupJoin(callback) {
        this.callbacks['group.join'].push(callback);
    }

    onGroupLeave(callback) {
        this.callbacks['group.leave'].push(callback);
    }

    onButtonReport(callback) {
        this.callbacks['button.report.inline'].push(callback);
    }

    onShortcutMenu(callback) {
        this.callbacks['bot.shortcut.menu'].push(callback);
    }

    listen(eventData) {
        const eventType = eventData.header.eventType;
        if (this.callbacks[eventType]) {
            this.callbacks[eventType].forEach(callback => {
                callback(eventData.event);
            });
        }
    }
}

module.exports = Subscription;
