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
try {
    if (fs.existsSync(blacklistFilePath)) {
        const blacklistData = fs.readFileSync(blacklistFilePath, 'utf8');
        publicBlacklist = JSON.parse(blacklistData);
        console.log('公共黑名单加载成功');
    } else {
        console.log('公共黑名单文件不存在');
    }
} catch (error) {
    console.error('加载公共黑名单时出错:', error);
}

// 群黑名单配置
const groupBlacklistConfig = {};

// 启用独立黑名单的群 ID 文件路径
const enabledGroupBlacklistFilePath = path.join(__dirname, 'enabled_group_blacklists.json');

// 加载启用独立黑名单的群 ID
function loadEnabledGroupBlacklists() {
    try {
        if (fs.existsSync(enabledGroupBlacklistFilePath)) {
            const data = fs.readFileSync(enabledGroupBlacklistFilePath, 'utf8');
            console.log('启用独立黑名单的群 ID 加载成功');
            return JSON.parse(data);
        }
        console.log('启用独立黑名单的群 ID 文件不存在');
        return [];
    } catch (error) {
        console.error('加载启用独立黑名单的群 ID 时出错:', error);
        return [];
    }
}

// 保存启用独立黑名单的群 ID
function saveEnabledGroupBlacklists(groupIds) {
    try {
        fs.writeFileSync(enabledGroupBlacklistFilePath, JSON.stringify(groupIds, null, 2));
        console.log('启用独立黑名单的群 ID 保存成功');
    } catch (error) {
        console.error('保存启用独立黑名单的群 ID 时出错:', error);
    }
}

// 加载群独立黑名单
function loadGroupBlacklist(groupId) {
    const groupBlacklistFilePath = path.join(__dirname, `${groupId}.json`);
    try {
        if (fs.existsSync(groupBlacklistFilePath)) {
            const blacklistData = fs.readFileSync(groupBlacklistFilePath, 'utf8');
            console.log(`群 ${groupId} 独立黑名单加载成功`);
            return JSON.parse(blacklistData);
        }
        console.log(`群 ${groupId} 独立黑名单文件不存在`);
        return [];
    } catch (error) {
        console.error(`加载群 ${groupId} 独立黑名单时出错:`, error);
        return [];
    }
}

// 保存群独立黑名单
function saveGroupBlacklist(groupId, blacklist) {
    const groupBlacklistFilePath = path.join(__dirname, `${groupId}.json`);
    try {
        fs.writeFileSync(groupBlacklistFilePath, JSON.stringify(blacklist, null, 2));
        console.log(`群 ${groupId} 独立黑名单保存成功`);
    } catch (error) {
        console.error(`保存群 ${groupId} 独立黑名单时出错:`, error);
    }
}

// 从独立黑名单中移除用户
function removeUserFromGroupBlacklist(groupId, userId) {
    const groupBlacklist = loadGroupBlacklist(groupId);
    const newBlacklist = groupBlacklist.filter(user => user.userId!== userId);
    saveGroupBlacklist(groupId, newBlacklist);
    return newBlacklist;
}

// 检查用户是否在公共黑名单中
function isUserInPublicBlacklist(userId) {
    const isInBlacklist = publicBlacklist.some(user => user.userId === userId);
    console.log(`用户 ${userId} 是否在公共黑名单中: ${isInBlacklist}`);
    return isInBlacklist;
}

// 检查用户是否在群独立黑名单中
function isUserInGroupBlacklist(userId, groupId) {
    const enabledGroupBlacklists = loadEnabledGroupBlacklists();
    if (enabledGroupBlacklists.includes(groupId)) {
        const groupBlacklist = loadGroupBlacklist(groupId);
        const isInBlacklist = groupBlacklist.some(user => user.userId === userId);
        console.log(`用户 ${userId} 是否在群 ${groupId} 独立黑名单中: ${isInBlacklist}`);
        return isInBlacklist;
    }
    console.log(`群 ${groupId} 未启用独立黑名单，用户 ${userId} 不在群独立黑名单中`);
    return false;
}

// 动态加载屏蔽词列表
function loadBlockedWords() {
    const blockedWordsFilePath = path.join(__dirname, 'blocked_words.json');
    let blockedWords = [];
    try {
        if (fs.existsSync(blockedWordsFilePath)) {
            const blockedWordsData = fs.readFileSync(blockedWordsFilePath, 'utf8');
            blockedWords = JSON.parse(blockedWordsData);
            console.log('屏蔽词列表加载成功');
        } else {
            console.log('屏蔽词列表文件不存在');
        }
    } catch (error) {
        console.error('加载屏蔽词列表时出错:', error);
    }
    return blockedWords;
}

// 群自定义禁用屏蔽词文件路径
const groupBlockedWordsFilePath = path.join(__dirname, 'group_blocked_words.json');

// 加载群自定义禁用屏蔽词
function loadGroupBlockedWords() {
    try {
        if (fs.existsSync(groupBlockedWordsFilePath)) {
            const data = fs.readFileSync(groupBlockedWordsFilePath, 'utf8');
            console.log('群自定义禁用屏蔽词加载成功');
            return JSON.parse(data);
        }
        console.log('群自定义禁用屏蔽词文件不存在');
        return {};
    } catch (error) {
        console.error('加载群自定义禁用屏蔽词时出错:', error);
        return {};
    }
}

// 保存群自定义禁用屏蔽词
function saveGroupBlockedWords(groupBlockedWords) {
    try {
        const chunkSize = 100; // 每批保存的数据量
        const keys = Object.keys(groupBlockedWords);
        for (let i = 0; i < keys.length; i += chunkSize) {
            const chunkKeys = keys.slice(i, i + chunkSize);
            const chunkData = {};
            chunkKeys.forEach(key => {
                chunkData[key] = groupBlockedWords[key];
            });

            const existingData = fs.existsSync(groupBlockedWordsFilePath)? JSON.parse(fs.readFileSync(groupBlockedWordsFilePath, 'utf8')) : {};
            const newData = { ...existingData, ...chunkData };

            fs.writeFileSync(groupBlockedWordsFilePath, JSON.stringify(newData, null, 2));
        }
        console.log('群自定义禁用屏蔽词保存成功');
    } catch (error) {
        console.error('保存群自定义禁用屏蔽词时出错:', error);
    }
}

// 检查消息是否包含屏蔽词
function hasBlockedWord(messageText, groupId) {
    if (typeof messageText!== 'string') {
        return false;
    }
    const blockedWords = loadBlockedWords();
    const groupBlockedWords = loadGroupBlockedWords();
    const groupConfig = groupBlockedWords[groupId];

    if (groupConfig && groupConfig.allofthem) {
        return false; // 群屏蔽词判断已关闭
    }

    const disabledWords = groupConfig? groupConfig.words : [];
    const filteredBlockedWords = blockedWords.filter(word =>!disabledWords.includes(word));

    const hasBlocked = filteredBlockedWords.some(word => messageText.includes(word));
    console.log('屏蔽词已检测');
    return hasBlocked;
}

// 处理群管命令
async function handleAdminCommand(event) {
    const sender = event.sender;
    const chat = event.chat;
    const message = event.message;
    const groupId = chat.chatId;
    const command = message.content.text.trim();

    // 检查消息是否以 / 开头
    if (!command.startsWith('/')) {
        console.log(`群 ${groupId} 收到非指令消息: ${command}`);
        return;
    }

    if (sender.senderUserLevel === 'owner' || sender.senderUserLevel === 'administrator') {
        if (command === '/启用公共黑名单') {
            groupBlacklistConfig[groupId] = { ...groupBlacklistConfig[groupId], usePublicBlacklist: true };
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已启用公共黑名单' });
            console.log(`群 ${groupId} 已启用公共黑名单`);
        } else if (command === '/禁用公共黑名单') {
            groupBlacklistConfig[groupId] = { ...groupBlacklistConfig[groupId], usePublicBlacklist: false };
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已禁用公共黑名单' });
            console.log(`群 ${groupId} 已禁用公共黑名单`);
        } else if (command === '/启用独立黑名单') {
            groupBlacklistConfig[groupId] = { ...groupBlacklistConfig[groupId], useGroupBlacklist: true };
            const enabledGroupBlacklists = loadEnabledGroupBlacklists();
            if (!enabledGroupBlacklists.includes(groupId)) {
                enabledGroupBlacklists.push(groupId);
                saveEnabledGroupBlacklists(enabledGroupBlacklists);
            }
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已启用独立黑名单' });
            console.log(`群 ${groupId} 已启用独立黑名单`);
        } else if (command === '/禁用独立黑名单') {
            groupBlacklistConfig[groupId] = { ...groupBlacklistConfig[groupId], useGroupBlacklist: false };
            const enabledGroupBlacklists = loadEnabledGroupBlacklists();
            const newEnabledGroupBlacklists = enabledGroupBlacklists.filter(id => id!== groupId);
            saveEnabledGroupBlacklists(newEnabledGroupBlacklists);
            await openApi.sendMessage(groupId, 'group', 'text', { text: '已禁用独立黑名单' });
            console.log(`群 ${groupId} 已禁用独立黑名单`);
        } else if (command.startsWith('/添加独立黑名单')) {
            const parts = command.split(' ');
            if (parts.length >= 3) {
                const userId = parts[1];
                const reason = parts.slice(2).join(' ');
                const groupBlacklist = loadGroupBlacklist(groupId);
                groupBlacklist.push({ userId, reason });
                saveGroupBlacklist(groupId, groupBlacklist);
                await openApi.sendMessage(groupId, 'group', 'text', { text: `已将用户 ${userId} 添加到独立黑名单，原因：${reason}` });
                console.log(`已将用户 ${userId} 添加到群 ${groupId} 独立黑名单，原因：${reason}`);
            } else {
                await openApi.sendMessage(groupId, 'group', 'text', { text: '命令格式错误，正确格式：/添加独立黑名单 <用户 ID> <原因>' });
                console.log(`群 ${groupId} 添加独立黑名单命令格式错误`);
            }
        } else if (command.startsWith('/移出独立黑名单')) {
            const parts = command.split(' ');
            if (parts.length === 2) {
                const userId = parts[1];
                const newBlacklist = removeUserFromGroupBlacklist(groupId, userId);
                if (newBlacklist.length < loadGroupBlacklist(groupId).length) {
                    await openApi.sendMessage(groupId, 'group', 'text', { text: `已将用户 ${userId} 移出独立黑名单` });
                    console.log(`已将用户 ${userId} 移出群 ${groupId} 独立黑名单`);
                } else {
                    await openApi.sendMessage(groupId, 'group', 'text', { text: `已将用户 ${userId} 移出独立黑名单` });
                    console.log(`已将用户 ${userId} 移出群 ${groupId} 独立黑名单`);
                }
            } else {
                await openApi.sendMessage(groupId, 'group', 'text', { text: '命令格式错误，正确格式：/移出独立黑名单 <用户 ID>' });
                console.log(`群 ${groupId} 移出独立黑名单命令格式错误`);
            }
        } else if (command.startsWith('/禁用群屏蔽词')) {
            const parts = command.split(' ');
            if (parts.length === 2) {
                const word = parts[1];
                const groupBlockedWords = loadGroupBlockedWords();
                if (!groupBlockedWords[groupId]) {
                    groupBlockedWords[groupId] = { allofthem: false, words: [] };
                }
                if (word === 'allofthem') {
                    groupBlockedWords[groupId].allofthem = true;
                    await openApi.sendMessage(groupId, 'group', 'text', { text: '已关闭该群的屏蔽词判断' });
                    console.log(`群 ${groupId} 已关闭屏蔽词判断`);
                } else {
                    if (!groupBlockedWords[groupId].words.includes(word)) {
                        groupBlockedWords[groupId].words.push(word);
                        await openApi.sendMessage(groupId, 'group', 'text', { text: `已禁用屏蔽词 "${word}"` });
                        console.log(`群 ${groupId} 已禁用屏蔽词 "${word}"`);
                    } else {
                        await openApi.sendMessage(groupId, 'group', 'text', { text: `屏蔽词 "${word}" 已被禁用` });
                        console.log(`群 ${groupId} 屏蔽词 "${word}" 已被禁用`);
                    }
                }
                saveGroupBlockedWords(groupBlockedWords);
            }
        }
    } else {
        await openApi.sendMessage(groupId, 'group', 'text', { text: '你没有权限执行此命令' });
        console.log(`群 ${groupId} 非管理员尝试执行群管命令`);
    }
}

subscription.onMessageNormal(async (event) => {
    console.log('Received a normal message:', event);
    const userId = event.sender.senderId;
    const messageText = event.message.content? event.message.content.text : null;
    const groupId = event.chat.chatId;

    if (messageText && hasBlockedWord(messageText, groupId)) {
        const msgId = event.message.msgId;
        const recallResult = await openApi.recallMessage(msgId, groupId, 'group');
        if (recallResult.code === 1) {
            await openApi.sendMessage(groupId, 'group', 'text', { text: '消息包含屏蔽词，已被拦截并撤回' });
            console.log(`群 ${groupId} 消息包含屏蔽词，已被拦截并撤回，msgId: ${msgId}`);
        } else {
            await openApi.sendMessage(groupId, 'group', 'text', { text: '消息包含屏蔽词，但撤回失败，请手动处理' });
            console.error(`群 ${groupId} 消息包含屏蔽词，撤回失败，msgId: ${msgId}, 错误信息: ${recallResult.msg}`);
        }
    }

    await handleAdminCommand(event);
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