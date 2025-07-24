const express = require('express');
const OpenApi = require('../lib/OpenApi');
const Subscription = require('../lib/Subscription');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
            useSharedBlacklist: false, // 共享黑名单开关
            boundGroups: [],           // 绑定的群组ID数组
            blacklist: [],             // 本群黑名单
            blockedWords: {
                disabled: false,
                disabledWords: []
            }
        };
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
        console.log(`已为群 ${groupId} 创建默认配置`);
    }
}

// 配置加载与保存
function loadGroupConfig(groupId) {
    initNewGroup(groupId);
    try {
        const data = fs.readFileSync(getGroupConfigPath(groupId), 'utf8');
        const config = JSON.parse(data);
        
        // 确保配置结构完整
        return {
            usePublicBlacklist: config.usePublicBlacklist !== false,
            useGroupBlacklist: config.useGroupBlacklist === true,
            useSharedBlacklist: config.useSharedBlacklist === true,
            boundGroups: Array.isArray(config.boundGroups) ? config.boundGroups : [],
            blacklist: Array.isArray(config.blacklist) ? config.blacklist : [],
            blockedWords: {
                disabled: config.blockedWords?.disabled === true,
                disabledWords: Array.isArray(config.blockedWords?.disabledWords) 
                    ? config.blockedWords.disabledWords 
                    : []
            }
        };
    } catch (error) {
        console.error(`加载群 ${groupId} 配置失败:`, error);
        return getDefaultConfig();
    }
}

function getDefaultConfig() {
    return {
        usePublicBlacklist: true,
        useGroupBlacklist: false,
        useSharedBlacklist: false,
        boundGroups: [],
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
    } catch (error) {
        console.error(`保存群 ${groupId} 配置失败:`, error);
    }
}

// 加载共享黑名单
function loadSharedBlacklist(groupId) {
    const config = loadGroupConfig(groupId);
    if (!config.useSharedBlacklist || config.boundGroups.length === 0) {
        return [];
    }

    const allBlacklists = new Set(config.blacklist);
    
    // 加载所有绑定群的黑名单
    config.boundGroups.forEach(boundGroupId => {
        try {
            const boundConfig = loadGroupConfig(boundGroupId);
            boundConfig.blacklist.forEach(id => allBlacklists.add(id));
        } catch (error) {
            console.error(`加载绑定群 ${boundGroupId} 配置失败:`, error);
        }
    });

    return Array.from(allBlacklists);
}

// 屏蔽词管理
function loadBlockedWords() {
    const blockedWordsPath = path.join(__dirname, 'blocked_words.json');
    try {
        if (fs.existsSync(blockedWordsPath)) {
            return JSON.parse(fs.readFileSync(blockedWordsPath, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('加载屏蔽词列表失败:', error);
        return [];
    }
}

// 处理机器人设置事件
subscription.onBotSetting(async (event) => {
    try {
        const { groupId, settingJson } = event;
        const settings = JSON.parse(settingJson);
        const config = loadGroupConfig(groupId);

        // 处理列表型输入（支持逗号、分号、换行分隔）
        const processListInput = (input) => 
            input ? input.split(/[,;\n]/).map(item => item.trim()).filter(item => item) : [];

        // 更新共享黑名单设置
        config.useSharedBlacklist = settings.wejeav?.value === true;
        config.boundGroups = processListInput(settings.tttnss?.value)
            .filter(id => id !== groupId); // 排除自身群组

        // 更新其他设置
        config.usePublicBlacklist = settings.lehzep?.value !== false;
        config.useGroupBlacklist = settings.jsgqio?.value?.trim() !== '';
        config.blacklist = processListInput(settings.jsgqio?.value);
        config.blockedWords.disabled = settings.yezkdo?.value === false;
        config.blockedWords.disabledWords = processListInput(settings.pduhoq?.value);

        saveGroupConfig(groupId, config);
        console.log(`群 ${groupId} 配置已更新`, {
            useSharedBlacklist: config.useSharedBlacklist,
            boundGroups: config.boundGroups.join(','),
            blacklistCount: config.blacklist.length,
            disabledWordsCount: config.blockedWords.disabledWords.length
        });

    } catch (error) {
        console.error('处理设置事件时出错:', error);
    }
});

// 配置热加载
function initConfigWatchers() {
    const watcher = chokidar.watch(groupConfigsDir, { persistent: true, ignoreInitial: true });
    watcher.on('change', (filePath) => {
        const groupId = path.basename(filePath, '.json');
        console.log(`群 ${groupId} 配置已更新`);
    });
}

// 处理普通消息事件
subscription.onMessageNormal(async (event) => {
    try {
        const { sender, chat, message } = event;
        const { chatId: groupId, chatType } = chat;
        const { msgId, content } = message;
        const senderId = sender.senderId;
        const messageText = content?.text || '';

        // 加载配置
        const config = loadGroupConfig(groupId);
        const publicBlockedWords = loadBlockedWords();

        // 获取适用的黑名单（共享或本地）
        let effectiveBlacklist = [];
        if (config.useSharedBlacklist) {
            effectiveBlacklist = loadSharedBlacklist(groupId);
            console.log(`[共享黑名单] 群 ${groupId} 有效黑名单用户数: ${effectiveBlacklist.length}`);
        } else if (config.useGroupBlacklist) {
            effectiveBlacklist = config.blacklist;
        }

        // 检查黑名单
        if (effectiveBlacklist.includes(senderId)) {
            console.log(`🚫 拦截黑名单用户 ${senderId} 的消息`);
            const recallResult = await openApi.recallMessage(msgId, groupId, chatType);
            if (recallResult.code !== 1) {
                console.error('撤回消息失败:', recallResult);
            }
            return;
        }

        // 检查屏蔽词
        if (!config.blockedWords.disabled && messageText) {
            const effectiveBlockedWords = publicBlockedWords.filter(
                word => !config.blockedWords.disabledWords.includes(word)
            );

            const foundWord = effectiveBlockedWords.find(word => 
                messageText.includes(word)
            );

            if (foundWord) {
                console.log(`🚫 拦截包含屏蔽词 "${foundWord}" 的消息`);
                const recallResult = await openApi.recallMessage(msgId, groupId, chatType);
                if (recallResult.code !== 1) {
                    console.error('撤回消息失败:', recallResult);
                }
                return;
            }
        }

    } catch (error) {
        console.error('处理消息时发生错误:', error);
    }
});

// 订阅地址
app.post('/sub', (req, res) => {
    subscription.listen(req.body);
    res.status(200).json({ code: 0, msg: 'success' });
});

// 启动服务
const PORT = process.env.PORT || 7890;
app.listen(PORT, () => {
    console.log(`机器人服务已启动，端口: ${PORT}`);
    initConfigWatchers();
});