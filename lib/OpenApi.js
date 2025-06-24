const axios = require('axios');

class OpenApi {
    constructor(token) {
        this.token = token;
        this.baseUrl = 'https://chat-go.jwzhd.com/open-apis/v1';
    }

    async sendMessage(recvId, recvType, content) {
        return this._sendMessage(recvId, recvType, 'text', content);
    }

    async sendMarkdownMessage(recvId, recvType, content) {
        return this._sendMessage(recvId, recvType, 'markdown', content);
    }

    async _sendMessage(recvId, recvType, contentType, content) {
        const params = {
            recvId,
            recvType,
            contentType,
            content,
        };
        const headers = { 'Content-Type': 'application/json' };
        const response = await axios.post(
            `${this.baseUrl}/bot/send?token=${this.token}`,
            params,
            { headers }
        );
        return response.data;
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
        const response = await axios.post(
            `${this.baseUrl}/bot/batch_send?token=${this.token}`,
            params,
            { headers }
        );
        return response.data;
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
        const response = await axios.post(
            `${this.baseUrl}/bot/edit?token=${this.token}`,
            params,
            { headers }
        );
        return response.data;
    }

    async recallMessage(msgId, chatId, chatType) {
        const params = {
            msgId,
            chatId,
            chatType
        };
        const headers = { 'Content-Type': 'application/json' };
        const response = await axios.post(
            `${this.baseUrl}/bot/recall?token=${this.token}`,
            params,
            { headers }
        );
        return response.data;
    }

    async checkGroupAdmin(groupId, userId) {
        const headers = { 'Content-Type': 'application/json' };
        try {
            const response = await axios.get(
                `${this.baseUrl}/group/${groupId}/members/${userId}/admin?token=${this.token}`
            );
            // 检查 response.data 和 response.data.data 是否存在
            if (response.data && response.data.data && typeof response.data.data.isAdmin === 'boolean') {
                return response.data.data.isAdmin;
            }
            // 如果数据不存在或者 isAdmin 不是布尔值，返回 false 或者抛出错误
            console.error('Invalid response data when checking group admin:', response.data);
            return false;
        } catch (error) {
            console.error('Error checking group admin:', error);
            return false;
        }
    }
}

module.exports = OpenApi;
