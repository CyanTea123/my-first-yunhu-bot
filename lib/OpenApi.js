const axios = require('axios');

class OpenApi {
    constructor(token) {
        this.token = token;
        this.baseUrl = 'https://chat-go.jwzhd.com/open-apis/v1';
    }

    async sendMessage(recvId, recvType, contentType, content, parentId) {
        const params = {
            recvId,
            recvType,
            contentType,
            content,
        };

        if (parentId) {
            params.parentId = parentId;
        }

        try {
            const headers = { 'Content-Type': 'application/json; charset=utf-8' };
            const response = await axios.post(
                `${this.baseUrl}/bot/send?token=${this.token}`,
                params,
                { headers }
            );

            if (response.data.code !== 0) {
                console.error('Send message failed:', response.data);
            }

            return response.data;
        } catch (error) {
            console.error('Exception occurred while sending message:', error);
            return { code: -1, msg: '发送消息时发生异常', data: null };
        }
    }

    async batchSendTextMessage(recvIds, recvType, content) {
        return this._batchSendMessage(recvIds, recvType, 'text', content);
    }

    async batchSendMarkdownMessage(recvIds, recvType, content) {
        return this._batchSendMessage(recvIds, recvType, 'markdown', content);
    }

    async _batchSendMessage(recvIds, recvType, contentType, content) {
        const params = {
            recvIds,
            recvType,
            contentType,
            content,
        };
        const headers = { 'Content-Type': 'application/json' };
        try {
            const response = await axios.post(
                `${this.baseUrl}/bot/batch_send?token=${this.token}`,
                params,
                { headers }
            );
            return response.data;
        } catch (error) {
            console.error('Exception occurred while batch sending message:', error);
            return { code: -1, msg: '批量发送消息时发生异常', data: null };
        }
    }

    async editMessage(msgId, recvId, recvType, contentType, content) {
        const params = {
            msgId,
            recvId,
            recvType,
            contentType,
            content,
        };
        const headers = { 'Content-Type': 'application/json' };
        try {
            const response = await axios.post(
                `${this.baseUrl}/bot/edit?token=${this.token}`,
                params,
                { headers }
            );
            return response.data;
        } catch (error) {
            console.error('Exception occurred while editing message:', error);
            return { code: -1, msg: '编辑消息时发生异常', data: null };
        }
    }

    async recallMessage(msgId, chatId, chatType) {
        const params = {
            msgId,
            chatId,
            chatType
        };
        const headers = { 'Content-Type': 'application/json; charset=utf-8' };
        try {
            const response = await axios.post(
                `${this.baseUrl}/bot/recall?token=${this.token}`,
                params,
                { headers }
            );
            return response.data;
        } catch (error) {
            console.error('Exception occurred while recalling message:', error);
            return { code: -1, msg: '撤回消息时发生异常', data: null };
        }
    }
}

module.exports = OpenApi;