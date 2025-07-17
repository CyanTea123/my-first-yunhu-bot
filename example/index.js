const express = require('express');
const OpenApi = require('../lib/OpenApi');
const Subscription = require('../lib/Subscription');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const activeSessions = new Map(); // groupId -> timestamp

const app = express();
app.use(express.json());

const TOKEN = '5155ecf9c1fb485595f2a6d295b5cba4'; // 看什么看，你没有自己的token啊
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
function hasBlockedWord(event) {
    const message = event.message;
    // 检查 message 对象是否存在
    if (!message) {
        return false;
    }
    const contentType = message.contentType;
    const messageText = message.content && message.content.text;

    // 只处理文本消息
    if (contentType!== 'text' || typeof messageText!== 'string') {
        return false;
    }

    const groupId = event.chat.chatId;
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
    const sender = event.sender;
    const chat = event.chat;
    const message = event.message;
    const groupId = chat.chatId;
    const userId = sender.senderId;

    if (!message || !message.content || !message.content.text) {
        console.log('消息内容格式不正确，忽略处理');
        return;
    }

    try {
        console.log('Received a normal message:', event);

        // 1. 强制检查公共黑名单（无论群是否启用独立黑名单）
        const isInPublicBlacklist = isUserInPublicBlacklist(userId);
        if (isInPublicBlacklist) {
            const msgId = message.msgId;
            console.log(`检测到黑名单用户 ${userId} 发送消息，尝试撤回...`);
            const recallResult = await openApi.recallMessage(msgId, groupId, 'group');
            
            if (recallResult.code === 1) {  // 修正：code === 0 表示成功
                await openApi.sendMessage(groupId, 'group', 'text', { 
                    text: `用户 @${sender.senderNickname} (${userId}) 在公共黑名单中，消息已撤回。原因：${publicBlacklist.find(u => u.userId === userId)?.reason || '未知'}`
                });
                console.log(`群 ${groupId} 已撤回黑名单用户 ${userId} 的消息，msgId: ${msgId}`);
                return; // 直接终止处理
            } else {
                console.error(`撤回失败！群 ${groupId} 用户 ${userId}，错误: ${recallResult.msg}`);
                await openApi.sendMessage(groupId, 'group', 'text', { 
                    text: `检测到黑名单用户 @${sender.senderNickname}，但撤回失败，请管理员手动处理！`
                });
                return;
            }
        }

        // 2. 检查群独立黑名单（如果启用）
        const enabledGroupBlacklists = loadEnabledGroupBlacklists();
        if (enabledGroupBlacklists.includes(groupId)) {
            const isInGroupBlacklist = isUserInGroupBlacklist(userId, groupId);
            if (isInGroupBlacklist) {
                const msgId = message.msgId;
                const recallResult = await openApi.recallMessage(msgId, groupId, 'group');
                if (recallResult.code === 1) {
                    await openApi.sendMessage(groupId, 'group', 'text', { 
                        text: `用户 @${sender.senderNickname} 在本群黑名单中，消息已撤回。`
                    });
                    return;
                }
            }
        }

        // 3. 检查屏蔽词
        if (hasBlockedWord(event)) {
            const msgId = message.msgId;
            const recallResult = await openApi.recallMessage(msgId, groupId, 'group');
            if (recallResult.code === 1) {
                await openApi.sendMessage(groupId, 'group', 'text', { text: '消息包含屏蔽词，已被撤回。' });
            }
        }

        // 4. 处理管理员命令
        await handleAdminCommand(event);

    } catch (error) {
        console.error('处理消息时发生异常:', error);
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

app.use((req, res, next) => {
    globalReq = req;
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'your-strong-secret-here', // 改为强密码
    resave: true,                      // 改为true
    saveUninitialized: false,          // 改为false
    cookie: { 
        secure: false,                 // 开发用false，生产用true
        maxAge: 24 * 60 * 60 * 1000,  // 24小时有效期
        httpOnly: true
    }
}));

// 验证码存储
const verificationCodes = new Map(); // key: groupId, value: {code, timestamp}

// 生成随机验证码
function generateVerificationCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// 验证码管理路由
app.get('/api/generate-code', (req, res) => {
    const groupId = req.query.groupId;
    console.log('生成验证码请求，群ID:', groupId); // 调试日志
    
    if (!groupId) {
        console.log('缺少群ID参数');
        return res.status(200).json({ code: 0, msg: '缺少群ID参数' });
    }
    
    const code = generateVerificationCode();
    verificationCodes.set(groupId, {
        code,
        timestamp: Date.now()
    });
    
    console.log('生成的验证码:', code, '当前存储的验证码:', verificationCodes); // 调试日志
    
    // 5分钟后过期
    setTimeout(() => {
        verificationCodes.delete(groupId);
    }, 5 * 60 * 1000);
    
    res.status(200).json({ code: 1, msg: '验证码生成成功', data: { code } });
});

// 验证验证码
app.post('/api/verify-code', (req, res) => {
    const { groupId, code } = req.body;
    if (!groupId || !code) {
        return res.status(200).json({ code: 0, msg: '缺少必要参数' }); // 失败返回code=0
    }
    
    const storedCode = verificationCodes.get(groupId);
    if (!storedCode || storedCode.code !== code.toUpperCase()) {
        return res.status(200).json({ code: 0, msg: '验证码无效或已过期' });
    }
    
    // 验证成功，创建会话
    req.session.verifiedGroups = req.session.verifiedGroups || [];
    if (!req.session.verifiedGroups.includes(groupId)) {
        req.session.verifiedGroups.push(groupId);
    }
    
    verificationCodes.delete(groupId);
    res.status(200).json({ code: 1, msg: '验证成功' }); // 成功返回code=1
});

// 检查会话状态
app.get('/api/check-session', (req, res) => {
    const groupId = req.query.groupId;
    console.log('检查会话，群ID:', groupId, '活跃会话:', activeSessions);
    
    if (!groupId) {
        return res.status(200).json({ code: 0, msg: '缺少群ID参数' });
    }
    
    const isVerified = activeSessions.has(groupId);
    console.log('验证状态:', isVerified);
    
    res.status(200).json({ 
        code: isVerified ? 1 : 0,
        isVerified,
        msg: isVerified ? '已验证' : '未验证'
    });
});

// 获取群屏蔽词配置
app.get('/api/group-blocked-words', (req, res) => {
    const groupId = req.query.groupId;
    if (!groupId) {
        return res.status(400).json({ error: '缺少群ID参数' });
    }
    
    if (!req.session.verifiedGroups || !req.session.verifiedGroups.includes(groupId)) {
        return res.status(403).json({ error: '未验证权限' });
    }
    
    const blockedWords = loadBlockedWords();
    const groupBlockedWords = loadGroupBlockedWords();
    const groupConfig = groupBlockedWords[groupId] || { allofthem: false, words: [] };
    
    res.json({
        allBlockedWords: blockedWords,
        disabledWords: groupConfig.words,
        isDisabled: groupConfig.allofthem
    });
});

// 更新群屏蔽词配置
app.post('/api/update-group-blocked-words', (req, res) => {
    const { groupId, disabledWords, isDisabled } = req.body;
    if (!groupId) {
        return res.status(400).json({ error: '缺少群ID参数' });
    }
    
    if (!req.session.verifiedGroups || !req.session.verifiedGroups.includes(groupId)) {
        return res.status(403).json({ error: '未验证权限' });
    }
    
    const groupBlockedWords = loadGroupBlockedWords();
    groupBlockedWords[groupId] = {
        allofthem: isDisabled,
        words: disabledWords || []
    };
    
    saveGroupBlockedWords(groupBlockedWords);
    res.json({ success: true });
});

// 获取群黑名单
app.get('/api/group-blacklist', (req, res) => {
    const groupId = req.query.groupId;
    if (!groupId) {
        return res.status(400).json({ error: '缺少群ID参数' });
    }
    
    if (!req.session.verifiedGroups || !req.session.verifiedGroups.includes(groupId)) {
        return res.status(403).json({ error: '未验证权限' });
    }
    
    const enabledGroupBlacklists = loadEnabledGroupBlacklists();
    const useGroupBlacklist = enabledGroupBlacklists.includes(groupId);
    const groupBlacklist = useGroupBlacklist ? loadGroupBlacklist(groupId) : [];
    
    res.json({
        useGroupBlacklist,
        blacklist: groupBlacklist
    });
});

// 更新群黑名单
app.post('/api/update-group-blacklist', (req, res) => {
    const { groupId, blacklist, useGroupBlacklist } = req.body;
    if (!groupId) {
        return res.status(400).json({ error: '缺少群ID参数' });
    }
    
    if (!req.session.verifiedGroups || !req.session.verifiedGroups.includes(groupId)) {
        return res.status(403).json({ error: '未验证权限' });
    }
    
    // 更新独立黑名单启用状态
    let enabledGroupBlacklists = loadEnabledGroupBlacklists();
    if (useGroupBlacklist && !enabledGroupBlacklists.includes(groupId)) {
        enabledGroupBlacklists.push(groupId);
        saveEnabledGroupBlacklists(enabledGroupBlacklists);
    } else if (!useGroupBlacklist && enabledGroupBlacklists.includes(groupId)) {
        enabledGroupBlacklists = enabledGroupBlacklists.filter(id => id !== groupId);
        saveEnabledGroupBlacklists(enabledGroupBlacklists);
    }
    
    // 保存黑名单数据
    if (useGroupBlacklist) {
        saveGroupBlacklist(groupId, blacklist);
    }
    
    res.json({ success: true });
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/login.html'));
});

// 管理面板
app.get('/manage', (req, res) => {
    const groupId = req.query.groupId;
    if (!groupId) {
        return res.status(400).send('缺少群ID参数');
    }
    
    if (!req.session.verifiedGroups || !req.session.verifiedGroups.includes(groupId)) {
        return res.redirect(`/login?groupId=${groupId}`);
    }
    
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.post('/sub', (req, res) => {
    subscription.listen(req.body);
    res.sendStatus(200);
});

const PORT = 7889;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});