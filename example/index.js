// my-first-yunhu-bot/example/index.js
const express = require('express');
const OpenApi = require('../lib/OpenApi');
const Subscription = require('../lib/Subscription');
const GroupConfigManager = require('../lib/GroupConfigManager');

const app = express();
app.use(express.json());

const TOKEN = 'YOUR_ACTUAL_TOKEN';
const openApi = new OpenApi(TOKEN);
const subscription = new Subscription();
const groupConfigManager = new GroupConfigManager();

const HELP_MESSAGE = `欢迎使用本机器人！以下是使用说明：
- 设置群看板: [群 ID]: [群看板内容]：设置群看板，支持 MD 语法。
- 设置进群消息: [群 ID]: [进群消息内容]：设置进群消息，支持 MD 语法。
- 设置退群消息: [群 ID]: [退群消息内容]：设置退群消息，支持 MD 语法。
- 添加黑名单: [群 ID]: [用户 ID]：将用户添加到群黑名单。
- 移除黑名单: [群 ID]: [用户 ID]：将用户从群黑名单中移除。`;

// 定义表单 ID 与设置项的映射
const FORM_ID_MAPPING = {
    'qavaqt': 'board',
    'ynpcgr': 'joinMessage',
    'kcykjx': 'leaveMessage',
    'khonut': 'blacklist'
};

// 处理普通消息
subscription.onMessageNormal(async (event) => {
    try {
        const senderId = event.sender.senderId;
        const messageText = event.message.content.text;
        const conversation = event.chat;
        const msgId = event.message.msgId;

        if (conversation.chatType === 'bot') {
            // 处理私聊消息
            if (messageText.startsWith('设置群看板:')) {
                const [_, groupId, ...boardContentArr] = messageText.split(':');
                const boardContent = boardContentArr.join(':').trim();
                const config = groupConfigManager.getConfig(groupId);
                config.board = boardContent;
                groupConfigManager.setConfig(groupId, config);
                openApi.sendMessage(senderId, 'user', { text: `群 ${groupId} 的群看板已设置为: ${boardContent}` });
            } else if (messageText.startsWith('设置进群消息:')) {
                const [_, groupId, ...joinMessageArr] = messageText.split(':');
                const joinMessage = joinMessageArr.join(':').trim();
                const config = groupConfigManager.getConfig(groupId);
                config.joinMessage = joinMessage;
                groupConfigManager.setConfig(groupId, config);
                openApi.sendMessage(senderId, 'user', { text: `群 ${groupId} 的进群消息已设置为: ${joinMessage}` });
            } else if (messageText.startsWith('设置退群消息:')) {
                const [_, groupId, ...leaveMessageArr] = messageText.split(':');
                const leaveMessage = leaveMessageArr.join(':').trim();
                const config = groupConfigManager.getConfig(groupId);
                config.leaveMessage = leaveMessage;
                groupConfigManager.setConfig(groupId, config);
                openApi.sendMessage(senderId, 'user', { text: `群 ${groupId} 的退群消息已设置为: ${leaveMessage}` });
            } else if (messageText.startsWith('添加黑名单:')) {
                const [_, groupId, userId] = messageText.split(':');
                const config = groupConfigManager.getConfig(groupId);
                if (!config.blacklist.includes(userId)) {
                    config.blacklist.push(userId);
                    groupConfigManager.setConfig(groupId, config);
                    openApi.sendMessage(senderId, 'user', { text: `已将用户 ${userId} 添加到群 ${groupId} 的黑名单` });
                } else {
                    openApi.sendMessage(senderId, 'user', { text: `用户 ${userId} 已经在群 ${groupId} 的黑名单中` });
                }
            } else if (messageText.startsWith('移除黑名单:')) {
                const [_, groupId, userId] = messageText.split(':');
                const config = groupConfigManager.getConfig(groupId);
                const index = config.blacklist.indexOf(userId);
                if (index !== -1) {
                    config.blacklist.splice(index, 1);
                    groupConfigManager.setConfig(groupId, config);
                    openApi.sendMessage(senderId, 'user', { text: `已将用户 ${userId} 从群 ${groupId} 的黑名单中移除` });
                } else {
                    openApi.sendMessage(senderId, 'user', { text: `用户 ${userId} 不在群 ${groupId} 的黑名单中` });
                }
            }
        } else if (conversation.chatType === 'group') {
            const groupId = conversation.chatId;
            const config = groupConfigManager.getConfig(groupId);

            // 检查是否是查看群看板指令
            if (messageText === '查看群看板') {
                if (config.board) {
                    openApi.sendMarkdownMessage(groupId, 'group', { text: `当前群看板内容: ${config.board}` });
                } else {
                    openApi.sendMessage(groupId, 'group', { text: '当前群还没有设置群看板。' });
                }
            } 
            // 检查发送者是否在黑名单中
            else if (config.blacklist.includes(senderId)) {
                openApi.recallMessage(msgId, groupId, 'group')
                   .then(response => {
                        if (response.code === 0) {
                            openApi.sendMessage(groupId, 'group', { text: `用户 ${senderId} 在黑名单中，其消息已撤回。` });
                        } else {
                            openApi.sendMessage(groupId, 'group', { text: `撤回用户 ${senderId} 消息失败，错误信息: ${response.msg}` });
                        }
                    })
                   .catch(error => {
                        openApi.sendMessage(groupId, 'group', { text: `撤回用户 ${senderId} 消息失败，网络错误: ${error.message}` });
                    });
            }
        }
    } catch (error) {
        console.error('Error handling message:', error);
    }
});

// 处理表单提交事件
subscription.onButtonReport(async (event) => {
    try {
        const senderId = event.sender.senderId;
        const groupId = event.chat.chatId;
        const formData = event.reportData.formData;

        const config = groupConfigManager.getConfig(groupId);

        for (const [formId, value] of Object.entries(formData)) {
            const settingKey = FORM_ID_MAPPING[formId];
            if (settingKey) {
                if (settingKey === 'blacklist') {
                    // 处理黑名单设置，将输入的用户 ID 分割成数组
                    config[settingKey] = value.split(',').map(id => id.trim()).filter(id => id);
                } else {
                    config[settingKey] = value;
                }
                openApi.sendMessage(senderId, 'user', { text: `群 ${groupId} 的 ${FORM_ID_MAPPING[formId]} 已设置为: ${value}` });
            }
        }

        groupConfigManager.setConfig(groupId, config);
    } catch (error) {
        console.error('Error handling form submission:', error);
    }
});

// 处理用户关注机器人事件
subscription.onBotFollowed((event) => {
    const userId = event.sender.senderId;
    openApi.sendMessage(userId, 'user', { text: HELP_MESSAGE });
});

// 处理用户加入群聊事件
subscription.onGroupJoin((event) => {
    const groupId = event.chat.chatId;
    const userId = event.sender.senderId;
    const config = groupConfigManager.getConfig(groupId);
    const joinMessage = config.joinMessage.replace('{userId}', userId);
    openApi.sendMarkdownMessage(groupId, 'group', { text: joinMessage });
});

// 处理用户离开群聊事件
subscription.onGroupLeave((event) => {
    const groupId = event.chat.chatId;
    const userId = event.sender.senderId;
    const config = groupConfigManager.getConfig(groupId);
    const leaveMessage = config.leaveMessage.replace('{userId}', userId);
    openApi.sendMarkdownMessage(groupId, 'group', { text: leaveMessage });
});

app.post('/sub', (req, res) => {
    subscription.listen(req.body);
    res.sendStatus(200);
});

const PORT = 7889;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
