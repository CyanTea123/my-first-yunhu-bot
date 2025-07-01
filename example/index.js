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

// 加载公共黑名单
const blacklistFilePath = path.join(__dirname, 'blacklist.json');
let publicBlacklist = [];
if (fs.existsSync(blacklistFilePath)) {
    const blacklistData = fs.readFileSync(blacklistFilePath, 'utf8');
    publicBlacklist = JSON.parse(blacklistData);
}

// 群黑名单配置
const groupBlacklistConfig = {};

// 启用独立黑名单的群 ID 文件路径
const enabledGroupBlacklistFilePath = path.join(__dirname, 'enabled_group_blacklists.json');

// 加载启用独立黑名单的群 ID
function loadEnabledGroupBlacklists() {
    if (fs.existsSync(enabledGroupBlacklistFilePath)) {
        const data = fs.readFileSync(enabledGroupBlacklistFilePath, 'utf8');
        return JSON.parse(data);
    }
    return [];
}

// 保存启用独立黑名单的群 ID
function saveEnabledGroupBlacklists(groupIds) {
    fs.writeFileSync(enabledGroupBlacklistFilePath, JSON.stringify(groupIds, null, 2));
}

// 加载群独立黑名单
function loadGroupBlacklist(groupId) {
    const groupBlacklistFilePath = path.join(__dirname, `${groupId}.json`);
    if (fs.existsSync(groupBlacklistFilePath)) {
        const blacklistData = fs.readFileSync(groupBlacklistFilePath, 'utf8');
        return JSON.parse(blacklistData);
    }
    return [];
}

// 保存群独立黑名单
function saveGroupBlacklist(groupId, blacklist) {
    const groupBlacklistFilePath = path.join(__dirname, `${groupId}.json`);
    fs.writeFileSync(groupBlacklistFilePath, JSON.stringify(blacklist, null, 2));
}

// 从独立黑名单中移除用户
function removeUserFromGroupBlacklist(groupId, userId) {
    const groupBlacklist = loadGroupBlacklist(groupId);
    const newBlacklist = groupBlacklist.filter(user => user.userId!== userId);
    saveGroupBlacklist(groupId, newBlacklist);
    return newBlacklist;
}

// 检查用户是否在黑名单中
function isUserInBlacklist(userId, groupId) {
    let blacklist = [];
    const groupConfig = groupBlacklistConfig[groupId] || {};
    if (groupConfig.usePublicBlacklist) {
        blacklist = blacklist.concat(publicBlacklist);
    }
    if (groupConfig.useGroupBlacklist) {
        blacklist = blacklist.concat(loadGroupBlacklist(groupId));
    }
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
            groupBlacklistConfig[groupId] = { ...groupBlacklistConfig[groupId], usePublicBlacklist: true };
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已启用公共黑名单' });
        } else if (command === '/禁用公共黑名单') {
            groupBlacklistConfig[groupId] = { ...groupBlacklistConfig[groupId], usePublicBlacklist: false };
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已禁用公共黑名单' });
        } else if (command === '/启用独立黑名单') {
            groupBlacklistConfig[groupId] = { ...groupBlacklistConfig[groupId], useGroupBlacklist: true };
            const enabledGroupBlacklists = loadEnabledGroupBlacklists();
            if (!enabledGroupBlacklists.includes(groupId)) {
                enabledGroupBlacklists.push(groupId);
                saveEnabledGroupBlacklists(enabledGroupBlacklists);
            }
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已启用独立黑名单' });
        } else if (command === '/禁用独立黑名单') {
            groupBlacklistConfig[groupId] = { ...groupBlacklistConfig[groupId], useGroupBlacklist: false };
            const enabledGroupBlacklists = loadEnabledGroupBlacklists();
            const newEnabledGroupBlacklists = enabledGroupBlacklists.filter(id => id!== groupId);
            saveEnabledGroupBlacklists(newEnabledGroupBlacklists);
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已禁用独立黑名单' });
        } else if (command.startsWith('/添加独立黑名单')) {
            const parts = command.split(' ');
            if (parts.length >= 3) {
                const userId = parts[1];
                const reason = parts.slice(2).join(' ');
                const groupBlacklist = loadGroupBlacklist(groupId);
                groupBlacklist.push({ userId, reason });
                saveGroupBlacklist(groupId, groupBlacklist);
                await openApi.sendMessage(groupId, 'group', 'text', { text: `已将用户 ${userId} 添加到独立黑名单，原因：${reason}` });
            } else {
                await openApi.sendMessage(groupId, 'group', 'text', { text: '命令格式错误，正确格式：/添加独立黑名单 <用户 ID> <原因>' });
            }
        } else if (command.startsWith('/移出独立黑名单')) {
            const parts = command.split(' ');
            if (parts.length === 2) {
                const userId = parts[1];
                const newBlacklist = removeUserFromGroupBlacklist(groupId, userId);
                if (newBlacklist.length < loadGroupBlacklist(groupId).length) {
                    await openApi.sendMessage(groupId, 'group', 'text', { text: `已将用户 ${userId} 移出独立黑名单` });
                } else {
                    await openApi.sendMessage(groupId, 'group', 'text', { text: `用户 ${userId} 不在独立黑名单中` });
                }
            } else {
                await openApi.sendMessage(groupId, 'group', 'text', { text: '命令格式错误，正确格式：/移出独立黑名单 <用户 ID>' });
            }
        }
    } else {
        await openApi.sendMessage(groupId, 'group', 'text', { text: '你没有权限执行此命令' });
    }
}

subscription.onMessageNormal(async (event) => {
    console.log('Received a normal message:', event);
    const userId = event.sender.senderId;
    const messageText = event.message.content? event.message.content.text : null;
    const msgId = event.message.msgId;
    const recvId = event.chat.chatId;
    const recvType = event.chat.chatType;

    if (messageText && messageText.startsWith('/')) {
        await handleAdminCommand(event);
        return;
    }

    let shouldRecall = false;
    let noticeContent = '';

    if (isUserInBlacklist(userId, recvId)) {
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