// 群发通知使用,非Vio本体!
const OpenApi = require('./lib/OpenApi');
const Subscription = require('./lib/Subscription');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// 初始化Express和订阅服务
const app = express();
app.use(express.json()); // 解析JSON请求体
const subscription = new Subscription();

// 读取JSON文件工具函数
async function readJsonFile(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`读取文件 ${filePath} 失败:`, error.message);
        process.exit(1);
    }
}

// 消息发送主函数
async function sendMessages(openApi) {
    // 读取配置文件
    const groups = await readJsonFile('groups.json');
    const messages = await readJsonFile('messages.json');

    // 验证群聊和消息配置
    if (!Array.isArray(groups) || groups.length === 0) {
        console.error('groups.json 必须包含非空数组');
        return;
    }
    if (!messages || (!messages.text && !messages.markdown)) {
        console.error('messages.json 必须包含 text 或 markdown 字段');
        return;
    }

    // 发送消息
    try {
        let result;
        if (messages.text) {
            console.log(`开始向 ${groups.length} 个群聊发送文本消息`);
            result = await openApi.batchSendTextMessage(groups, 'group', { text: messages.text });
        } else if (messages.markdown) {
            console.log(`开始向 ${groups.length} 个群聊发送Markdown消息`);
            result = await openApi.batchSendMarkdownMessage(groups, 'group', { text: messages.markdown });
        }
        console.log('发送结果:', result);
        console.log('所有消息发送完成');
    } catch (error) {
        console.error('发送消息失败:', error.response?.data || error.message);
    }
}

// 配置事件订阅回调
function setupSubscriptions(openApi) {
    // 监听普通消息事件
    subscription.onMessageNormal((event) => {
        console.log('收到普通消息:', event);
        // 示例：自动回复消息
        openApi.sendMessage(event.sender.senderId, event.sender.senderType, {
            text: `收到你的消息: ${event.content.text}`
        });
    });

    // 监听指令消息事件
    subscription.onMessageInstruction((event) => {
        console.log('收到指令消息:', event);
    });

    // 监听群成员加入事件
    subscription.onGroupJoin((event) => {
        console.log('群成员加入:', event);
        // 示例：欢迎新成员
        openApi.sendMessage(event.groupId, 'group', {
            text: `欢迎 ${event.userId} 加入群聊！`
        });
    });

    // 监听群成员离开事件
    subscription.onGroupLeave((event) => {
        console.log('群成员离开:', event);
    });

    // 配置订阅接口（云湖平台会向此地址推送事件）
    app.post('/sub', (req, res) => {
        subscription.listen(req.body); // 转发事件到订阅处理器
        res.sendStatus(200); // 必须返回200表示接收成功
    });
}

// 主入口
async function main() {
    // 验证配置文件
    const requiredFiles = ['groups.json', 'messages.json', 'config.json'];
    for (const file of requiredFiles) {
        try {
            await fs.access(file);
        } catch {
            console.error(`缺少必要文件: ${file}`);
            process.exit(1);
        }
    }

    // 初始化SDK
    const config = await readJsonFile('config.json');
    if (!config.token) {
        console.error('config.json 中必须包含 token 字段');
        process.exit(1);
    }
    const openApi = new OpenApi(config.token);

    // 启动消息发送和事件订阅
    await sendMessages(openApi); // 先执行一次消息发送
    setupSubscriptions(openApi); // 配置事件监听

    // 启动HTTP服务（用于接收云湖事件回调）
    const PORT = config.port || 7889; // 端口可在config.json中配置，默认7889
    app.listen(PORT, () => {
        console.log(`服务已启动，监听端口 ${PORT}`);
        console.log(`订阅地址为：http://你的服务器IP:${PORT}/sub`);
    });
}

// 启动程序
main();
