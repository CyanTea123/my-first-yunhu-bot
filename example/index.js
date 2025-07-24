const OpenApi = require('../lib/OpenApi');
const Subscription = require('../lib/Subscription');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const chokidar = require('chokidar');
const activeSessions = new Map(); // groupId -> timestamp

const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'vio-bot-session-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 300000 } // 5分钟会话有效期
}));

// 配置
const TOKEN = '5155ecf9c1fb485595f2a6d295b5cba4'; // 看什么看，你没有自己的token啊
const openApi = new OpenApi(TOKEN);
const subscription = new Subscription();
const groupConfigsDir = path.join(__dirname, 'group_configs');
fs.mkdirSync(groupConfigsDir, { recursive: true });

// 群配置文件路径处理
const getGroupConfigPath = (groupId) => path.join(groupConfigsDir, `${groupId}.json`);

// 初始化群配置
function initNewGroup(groupId) {
    const configPath = getGroupConfigPath(groupId);
    if (!fs.existsSync(configPath)) {
        const defaultConfig = {
            usePublicBlacklist: true,
            useGroupBlacklist: false,
            blacklist: [],
            blockedWords: {
                disabled: false,
                disabledWords: [],
                enabledWords: []
            }
        };
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
        console.log(`已为群 ${groupId} 创建默认配置`);
    }
}

// 配置加载与保存
function loadGroupConfig(groupId) {
    const configPath = path.join(groupConfigsDir, `${groupId}.json`);
    
    try {
        if (fs.existsSync(configPath)) {
            const rawData = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(rawData);
            
            // 确保配置结构完整
            return {
                usePublicBlacklist: config.usePublicBlacklist !== false,
                useGroupBlacklist: config.useGroupBlacklist === true,
                blacklist: Array.isArray(config.blacklist) ? config.blacklist : [],
                blockedWords: {
                    disabled: config.blockedWords?.disabled === true,
                    disabledWords: Array.isArray(config.blockedWords?.disabledWords) 
                        ? config.blockedWords.disabledWords 
                        : []
                }
            };
        }
    } catch (error) {
        console.error(`加载群 ${groupId} 配置失败:`, error);
    }
    
    // 返回默认配置
    return {
        usePublicBlacklist: true,
        useGroupBlacklist: false,
        blacklist: [],
        blockedWords: {
            disabled: false,
            disabledWords: []
        }
    };
}

function saveGroupConfig(groupId, config) {
    try {
        fs.writeFileSync(getGroupConfigPath(groupId), JSON.stringify(config, null, 2));
        console.log(`群 ${groupId} 配置已保存`);
    } catch (error) {
        console.error(`保存群 ${groupId} 配置失败:`, error);
    }
}

// 黑名单管理
function loadGroupBlacklist(groupId) {
    const config = loadGroupConfig(groupId);
    return config.blacklist || [];
}

// 屏蔽词管理
function loadBlockedWords() {
    const blockedWordsPath = path.join(__dirname, 'blocked_words.json');
    try {
        if (fs.existsSync(blockedWordsPath)) {
            const data = fs.readFileSync(blockedWordsPath, 'utf8');
            // 支持数组或逗号分隔的字符串
            if (data.startsWith('[')) {
                return JSON.parse(data);
            } else {
                return data.split(',')
                    .map(word => word.trim())
                    .filter(word => word.length > 0);
            }
        }
        return [];
    } catch (error) {
        console.error('加载屏蔽词列表失败:', error);
        return [];
    }
}

subscription.onBotSetting(async (event) => {
    try {
        const { groupId, settingJson } = event;
        console.log(`🛠️ 收到群 ${groupId} 的设置更新`);

        const settings = JSON.parse(settingJson);

        // 处理黑名单（支持逗号分隔或换行分隔）
        const processIds = (input) => {
            if (!input) return [];
            // 先按逗号分割，再按换行分割，最后过滤空值
            return input.split(/[,;\n]/)
                .flatMap(part => part.split('\n'))
                .map(id => id.trim())
                .filter(id => id.length > 0);
        };

        // 处理屏蔽词（支持逗号分隔或换行分隔）
        const processWords = (input) => {
            if (!input) return [];
            return input.split(/[,;\n]/)
                .flatMap(part => part.split('\n'))
                .map(word => word.trim())
                .filter(word => word.length > 0);
        };

        const config = {
            usePublicBlacklist: settings.lehzep?.value !== false,
            useGroupBlacklist: settings.jsgqio?.value?.trim() !== '',
            blacklist: processIds(settings.jsgqio?.value),
            blockedWords: {
                disabled: settings.yezkdo?.value === false,
                disabledWords: processWords(settings.pduhoq?.value)
            }
        };
        
        saveGroupConfig(groupId, config);
        console.log(`✅ 群 ${groupId} 配置已更新`, {
            ...config,
            blacklist: config.blacklist.join(','), // 日志中显示合并后的结果
            blockedWords: {
                ...config.blockedWords,
                disabledWords: config.blockedWords.disabledWords.join(',')
            }
        });
    } catch (error) {
        console.error('处理设置事件时出错:', error);
    }
});

// 配置热加载
const configCache = new Map();
const CACHE_TTL = 500;

function initConfigWatchers() {
    const watcher = chokidar.watch(groupConfigsDir, { persistent: true, ignoreInitial: true });
    
    watcher.on('change', (filePath) => {
        const fileName = path.basename(filePath);
        const groupIdMatch = fileName.match(/^(\d+)(_blacklist)?\.json$/);
        if (groupIdMatch) {
            const groupId = groupIdMatch[1];
            configCache.delete(groupId);
            console.log(`群 ${groupId} 配置已更新，缓存已清理`);
        }
    });
    
    console.log('配置热加载监听已启动');
}

subscription.onMessageNormal(async (event) => {
    try {
        const { sender, chat, message } = event;
        const { chatId: groupId, chatType } = chat;
        const { msgId, content } = message;
        const senderId = sender.senderId;
        const messageText = content?.text || '';

        console.log(`[消息处理开始] 群: ${groupId} 发送者: ${senderId} 内容: "${messageText}"`);

        // 加载最新配置
        const config = loadGroupConfig(groupId);
        console.log('当前群配置:', JSON.stringify(config, null, 2));

        // 1. 检查黑名单用户
        if (config.useGroupBlacklist && config.blacklist.includes(senderId)) {
            console.log(`⚠️ 检测到黑名单用户 ${senderId} 发送的消息`);
            
            const recallResult = await openApi.recallMessage(msgId, groupId, chatType);
            console.log('撤回结果:', recallResult);
            
            if (recallResult.code === 1) {
                console.log(`✅ 成功撤回黑名单用户 ${senderId} 的消息`);
                return;
            } else {
                console.error(`❌ 撤回失败: ${recallResult.msg}`);
                // 即使撤回失败也不再处理该消息
                return;
            }
        }

        // 2. 检查屏蔽词
        if (!config.blockedWords.disabled && messageText) {
            const publicBlockedWords = loadBlockedWords();
            const effectiveBlockedWords = publicBlockedWords.filter(
                word => !config.blockedWords.disabledWords.includes(word)
            );

            const foundWord = effectiveBlockedWords.find(word => 
                messageText.includes(word)
            );

            if (foundWord) {
                console.log(`⚠️ 检测到屏蔽词 "${foundWord}"`);
                
                const recallResult = await openApi.recallMessage(msgId, groupId, chatType);
                console.log('撤回结果:', recallResult);
                
                if (recallResult.code === 1) {
                    console.log(`✅ 成功撤回包含屏蔽词的消息`);
                    return;
                }
            }
        }

        console.log(`✅ 消息检查通过: "${messageText}"`);
    } catch (error) {
        console.error('处理消息时发生错误:', error);
    }
});

// 网页管理接口（已废弃，等待更新）
app.get('/login', (req, res) => {
    const groupId = req.query.groupId;
    if (!groupId) return res.status(400).send('缺少群ID参数');
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/manage', (req, res) => {
    const groupId = req.query.groupId;
    if (!groupId || !req.session[groupId]) return res.redirect(`/login?groupId=${groupId}`);
    res.sendFile(path.join(__dirname, 'views', 'management.html'));
});

app.get('/api/generate-code', (req, res) => {
    const groupId = req.query.groupId;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    activeSessions.set(groupId, { code, timestamp: Date.now() });
    res.json({ code: 1, data: { code } });
});

app.get('/api/check-session', (req, res) => {
    const groupId = req.query.groupId;
    const sessionData = activeSessions.get(groupId);
    
    if (sessionData && Date.now() - sessionData.timestamp < 300000) {
        req.session[groupId] = true;
        return res.json({ code: 1 });
    }
    
    res.json({ code: 0, msg: '验证未通过或已过期' });
});

app.get('/api/group-blocked-words', (req, res) => {
    const groupId = req.query.groupId;
    const config = loadGroupConfig(groupId);
    res.json({
        allBlockedWords: loadBlockedWords(),
        disabledWords: config.blockedWords.disabledWords,
        isDisabled: config.blockedWords.disabled
    });
});

app.post('/api/update-group-blocked-words', (req, res) => {
    const { groupId, disabledWords, isDisabled } = req.body;
    const config = loadGroupConfig(groupId);
    config.blockedWords = { disabled: isDisabled, disabledWords };
    saveGroupConfig(groupId, config);
    res.json({ code: 1 });
});

app.get('/api/group-blacklist', (req, res) => {
    const groupId = req.query.groupId;
    const config = loadGroupConfig(groupId);
    res.json({
        blacklist: loadGroupBlacklist(groupId),
        useGroupBlacklist: config.useGroupBlacklist
    });
});

app.post('/api/update-group-blacklist', (req, res) => {
    const { groupId, blacklist, useGroupBlacklist } = req.body;
    const config = loadGroupConfig(groupId);
    config.useGroupBlacklist = useGroupBlacklist;
    saveGroupConfig(groupId, config);
    saveGroupBlacklist(groupId, blacklist);
    res.json({ code: 1 });
});

// 订阅地址
app.post('/sub', (req, res) => {
    console.log('收到订阅请求，原始数据:', {
        body: req.body,
        headers: req.headers,
        ip: req.ip,
        timestamp: new Date().toISOString()
    });
    
    subscription.listen(req.body);
    res.status(200).json({ code: 0, msg: 'success' });
});

// 启动服务
const PORT = process.env.PORT || 7889;
app.listen(PORT, () => {
    console.log(`机器人服务已启动，端口: ${PORT}`);
    initConfigWatchers();
});