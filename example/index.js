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

subscription.onMessageNormal(async (event) => {
    console.log('Received a normal message:', event);
    const userId = event.sender.senderId;
    const messageText = event.message.content? event.message.content.text : null;
    const msgId = event.message.msgId;
    const recvId = event.chat.chatId;
    const recvType = event.chat.chatType;

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
            await openApi.sendMessage(recvId, recvType, noticeContent);
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