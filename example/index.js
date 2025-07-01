const express = require('express');
const OpenApi = require('../lib/OpenApi');
const Subscription = require('../lib/Subscription');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const TOKEN = '5155ecf9c1fb485595f2a6d295b5cba4';
const openApi = new OpenApi(TOKEN);
const subscription = new Subscription();

// 加载黑名单
const blacklistFilePath = path.join(__dirname, 'blacklist.json');
let blacklist = [];
if (fs.existsSync(blacklistFilePath)) {
    const blacklistData = fs.readFileSync(blacklistFilePath, 'utf8');
    blacklist = JSON.parse(blacklistData);
}

// 检查用户是否在黑名单中
function isUserInBlacklist(userId) {
    return blacklist.some(user => user.userId === userId);
}

// 动态加载屏蔽词列表
function loadBlockedWords() {
    const blockedWordsFilePath = path.join(__dirname, 'blocked_words.json');
    let blockedWords = [];
    if (fs.existsSync(blockedWordsFilePath)) {
        const blockedWordsData = fs.readFileSync(blockedWordsFilePath, 'utf8');
        blockedWords = JSON.parse(blockedWordsData);
    }
    return blockedWords;
}

// 检查消息是否包含屏蔽词
function hasBlockedWord(messageText) {
    if (typeof messageText!== 'string') {
        return false;
    }
    const blockedWords = loadBlockedWords();
    return blockedWords.some(word => messageText.includes(word));
}

// 处理群管命令
async function handleAdminCommand(event) {
    const sender = event.sender;
    const chat = event.chat;
    const message = event.message;
    const groupId = chat.chatId;
    const command = message.content.text.trim();

    if (sender.senderUserLevel === 'owner' || sender.senderUserLevel === 'administrator') {
        if (command === '/启用公共黑名单') {
            // 这里添加启用公共黑名单的逻辑
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已启用公共黑名单' });
        } else if (command === '/禁用公共黑名单') {
            // 这里添加禁用公共黑名单的逻辑
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已禁用公共黑名单' });
        } else if (command === '/启用独立黑名单') {
            // 这里添加启用独立黑名单的逻辑
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已启用独立黑名单' });
        } else if (command === '/禁用独立黑名单') {
            // 这里添加禁用独立黑名单的逻辑
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已禁用独立黑名单' });
        } else if (command.startsWith('/添加独立黑名单')) {
            // 这里添加添加独立黑名单的逻辑
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已将用户添加到独立黑名单' });
        } else if (command.startsWith('/移出独立黑名单')) {
            // 这里添加移出独立黑名单的逻辑
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已将用户移出独立黑名单' });
        }
    } else {
        await openApi.sendMessage(groupId, 'group', 'text', { text: '你没有权限执行此命令' });
    }
}

// 处理帮助指令
async function handleHelpCommand(event) {
    const senderId = event.sender.senderId;
    const recvType = 'user';
    const helpMessage = `以下是可用指令列表：
/help 或 /帮助 - 获取指令列表
/启用公共黑名单 - 启用公共黑名单
/禁用公共黑名单 - 禁用公共黑名单
/启用独立黑名单 - 启用独立黑名单
/禁用独立黑名单 - 禁用独立黑名单
/添加独立黑名单 <用户 ID> <原因> - 将用户添加到独立黑名单
/移出独立黑名单 <用户 ID> - 将用户移出独立黑名单`;
    await openApi.sendMessage(senderId, recvType, 'text', { text: helpMessage });
}

subscription.onMessageNormal(async (event) => {
    console.log('Received a normal message:', event);
    const userId = event.sender.senderId;
    const messageText = event.message.content? event.message.content.text : null;
    const msgId = event.message.msgId;
    const recvId = event.chat.chatId;
    const recvType = event.chat.chatType;

    if (messageText) {
        if (recvType === 'user' && (messageText === '/help' || messageText === '/帮助')) {
            await handleHelpCommand(event);
            return;
        } else if (messageText.startsWith('/')) {
            if (recvType === 'group') {
                await handleAdminCommand(event);
            }
            return;
        }
    }

    let shouldRecall = false;
    let noticeContent = '';

    if (isUserInBlacklist(userId)) {
        shouldRecall = true;
        noticeContent = { text: '您已被列入黑名单，您的消息已被撤回。' };
    } else if (hasBlockedWord(messageText)) {
        shouldRecall = true;
        noticeContent = { text: '您的消息包含屏蔽词，已被撤回。' };
    }

    if (shouldRecall) {
        // 撤回消息
        const recallResponse = await openApi.recallMessage(msgId, recvId, recvType);
        if (recallResponse.code === 0) {
            // 撤回成功，发送告知消息
            await openApi.sendMessage(recvId, recvType, 'text', noticeContent);
        } else {
            console.log('Failed to recall message:', recallResponse);
        }
    }
});

subscription.onMessageInstruction((event) => {
    console.log(event);
    openApi.sendMarkdownMessage(event.sender.senderId, 'user', { text: 'Hello! This is a *markdown* message response.' });
});

subscription.onGroupJoin((event) => {
    console.log('A user joined the group:', event);
});

subscription.onGroupLeave((event) => {
    console.log('A user left the group:', event);
});

app.post('/sub', (req, res) => {
    subscription.listen(req.body);
    res.sendStatus(200);
});

const PORT = 7889;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});