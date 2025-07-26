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

// 验证相关常量
const VERIFICATION_COMMAND = '/确认消息互通绑定请求';
const pendingVerifications = new Map(); // targetGroupId -> { sourceGroupId, timestamp, verified }

// 表单ID配置
const FORM_IDS = {
  PUBLIC_BLACKLIST_SWITCH: 'yofkyi',          // 公共黑名单开关
  SHARED_BLACKLIST_SWITCH: 'wcgdcz',          // 共享黑名单开关
  BOUND_GROUPS_INPUT: 'vxismj',               // 绑定群组输入
  GROUP_BLACKLIST_INPUT: 'pckgcp',            // 群独立黑名单输入
  WORD_FILTER_SWITCH: 'zzwdow',               // 屏蔽词判定开关
  DISABLED_WORDS_INPUT: 'nefdmg',             // 禁用屏蔽词输入
  SCHEDULED_SWITCH: 'uzwyjh',                 // 定时消息开关
  SCHEDULED_INTERVAL: 'tmdqih',               // 发送间隔(分钟)
  SCHEDULED_CONTENT: 'cwrkmu',                // 消息内容
  CROSS_GROUP_SWITCH: 'vfnfmc',               // 多群消息互通开关
  CROSS_GROUP_IDS: 'qjmliy'                   // 互通消息的群ID
};

// 定时任务存储
const scheduledMessages = new Map(); // groupId -> { interval, content, timer }

// 辅助函数
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 初始化群配置
function initNewGroup(groupId) {
    const configPath = getGroupConfigPath(groupId);
    if (!fs.existsSync(configPath)) {
        const defaultConfig = {
            usePublicBlacklist: true,
            useGroupBlacklist: false,
            useSharedBlacklist: false,
            boundGroups: [],
            blacklist: [],
            blockedWords: {
                disabled: false,
                disabledWords: []
            },
            crossGroupMessaging: {
                enabled: false,
                linkedGroups: []
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
            },
            crossGroupMessaging: {
                enabled: config.crossGroupMessaging?.enabled === true,
                linkedGroups: Array.isArray(config.crossGroupMessaging?.linkedGroups) 
                    ? config.crossGroupMessaging.linkedGroups 
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
        },
        crossGroupMessaging: {
            enabled: false,
            linkedGroups: []
        }
    };
}

function saveGroupConfig(groupId, config) {
    try {
        config.scheduledMessage = scheduledMessages.has(groupId) ? {
            enabled: true,
            interval: scheduledMessages.get(groupId).interval,
            content: scheduledMessages.get(groupId).content
        } : { enabled: false, interval: 0, content: '' };
        
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

// 加载屏蔽词
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

// 检查消息是否应该被拦截
async function checkAndHandleBlockedMessage(event) {
    const { sender, chat, message } = event;
    const { chatId: groupId, chatType } = chat;
    const { msgId, content } = message;
    const senderId = sender.senderId;
    
    // 加载群配置
    const config = loadGroupConfig(groupId);
    const publicBlockedWords = loadBlockedWords();
    
    // 获取消息文本
    let messageText = '';
    if (content && content.text) {
        messageText = content.text;
    }
    
    // 检查黑名单
    let effectiveBlacklist = [];
    if (config.useSharedBlacklist) {
        effectiveBlacklist = loadSharedBlacklist(groupId);
    } else if (config.useGroupBlacklist) {
        effectiveBlacklist = config.blacklist;
    }

    if (effectiveBlacklist.includes(senderId)) {
        console.log(`🚫 拦截黑名单用户 ${senderId} 的消息`);
        const recallResult = await openApi.recallMessage(msgId, groupId, chatType);
        if (recallResult.code !== 1) {
            console.error('撤回消息失败:', recallResult);
        }
        return true;
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
            return true;
        }
    }
    
    return false;
}

// 发送定时消息
async function sendScheduledMessage(groupId, content) {
    try {
        const messages = content.split('\n').filter(line => line.trim());
        
        for (const msg of messages) {
            const result = await openApi.sendMessage(
                groupId,
                'group',
                'text',
                msg.trim()
            );
            
            if (result.success) {
                console.log(`[定时消息] 成功发送到群 ${groupId}: ${msg.trim()}`);
            } else {
                console.error(`[定时消息] 发送失败到群 ${groupId}:`, result.msg);
                
                if (result.code === 1002) {
                    console.log('尝试使用替代格式发送...');
                    const retryResult = await openApi.sendMessage(
                        groupId,
                        'group',
                        'text',
                        msg.trim(),
                        null,
                        []
                    );
                    
                    if (retryResult.success) {
                        console.log(`[重试成功] 群 ${groupId}: ${msg.trim()}`);
                    } else {
                        console.error(`[重试失败] 群 ${groupId}:`, retryResult.msg);
                    }
                }
            }
            
            await delay(1000);
        }
    } catch (error) {
        console.error(`发送定时消息到群 ${groupId} 失败:`, error);
    }
}

// 设置定时任务
async function setupScheduledTask(groupId, intervalMinutes, content) {
    clearScheduledTask(groupId);
    
    if (intervalMinutes <= 0 || !content.trim()) return;
    
    const intervalMs = intervalMinutes * 60 * 1000;
    
    // 立即发送告知消息
    const testResult = await openApi.sendMessage(
        groupId,
        'group',
        'text',
        // "[定时消息] 配置成功，将定期发送消息"
    );
    
    if (!testResult.success) {
        console.error(`群 ${groupId} 定时消息设置失败，测试消息发送不成功`);
        return;
    }
    
    // 设置定时器
    const timer = setInterval(async () => {
        try {
            const messages = content.split('\n').filter(line => line.trim());
            for (const msg of messages) {
                const result = await openApi.sendMessage(
                    groupId,
                    'group',
                    'text',
                    msg.trim()
                );
                
                if (result.success) {
                    console.log(`[定时消息] 群 ${groupId} 发送成功`);
                } else {
                    console.error(`[定时消息] 群 ${groupId} 发送失败:`, result.msg);
                }
                
                await delay(1000);
            }
        } catch (error) {
            console.error(`处理定时消息时出错:`, error);
        }
    }, intervalMs);
    
    scheduledMessages.set(groupId, {
        interval: intervalMinutes,
        content: content,
        timer: timer,
        lastSent: new Date()
    });
    
    console.log(`群 ${groupId} 定时消息已设置: 每 ${intervalMinutes} 分钟发送`);
}

// 清除定时任务
function clearScheduledTask(groupId) {
    if (scheduledMessages.has(groupId)) {
        clearInterval(scheduledMessages.get(groupId).timer);
        scheduledMessages.delete(groupId);
        console.log(`群 ${groupId} 定时消息已停止`);
    }
}

// 启动时恢复定时任务
function restoreScheduledTasks() {
    const files = fs.readdirSync(groupConfigsDir).filter(f => f.endsWith('.json'));
    
    files.forEach(file => {
        const groupId = file.replace('.json', '');
        const config = loadGroupConfig(groupId);
        
        if (config.scheduledMessage?.enabled) {
            const { interval, content } = config.scheduledMessage;
            if (interval > 0 && content) {
                setupScheduledTask(groupId, interval, content);
            }
        }
    });
}

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
        const { chatId: groupId } = chat;
        const { msgId, content } = message;
        const senderId = sender.senderId;
        const senderName = sender.senderNickname || sender.senderId;
        
        // 检查是否为验证命令
        if (content?.text?.trim() === VERIFICATION_COMMAND) {
            // 检查是否有待处理的验证请求
            const verification = pendingVerifications.get(groupId);
            if (verification) {
                // 检查发送者权限
                if (['owner', 'administrator'].includes(sender.senderUserLevel)) {
                    // 验证通过
                    verification.verified = true;
                    pendingVerifications.set(groupId, verification);
                    
                    // 通知双方群组
                    await openApi.sendMessage(
                        groupId,
                        'group',
                        'text',
                        `✅ 消息互通绑定已确认\n` +
                        `本群与群 ${verification.sourceGroupId} 的消息互通功能已启用`
                    );
                    
                    await openApi.sendMessage(
                        verification.sourceGroupId,
                        'group',
                        'text',
                        `✅ 消息互通绑定已确认\n` +
                        `群 ${groupId} 已确认与您的群建立消息互通关系`
                    );
                    
                    console.log(`群 ${groupId} 和群 ${verification.sourceGroupId} 的互通绑定已确认`);
                } else {
                    await openApi.sendMessage(
                        groupId,
                        'group',
                        'text',
                        `❌ 权限不足\n` +
                        `只有群主或管理员可以确认消息互通绑定`
                    );
                }
            }
            return;
        }
        
        // 检查黑名单和屏蔽词
        const shouldBlock = await checkAndHandleBlockedMessage(event);
        if (shouldBlock) return;
        
        // 加载群配置
        const config = loadGroupConfig(groupId);
        
        // 检查是否启用了多群互通
        if (config.crossGroupMessaging.enabled && config.crossGroupMessaging.linkedGroups.length > 0) {
            // 只转发给已验证的群组
            const verifiedGroups = config.crossGroupMessaging.linkedGroups.filter(targetGroupId => {
                // 检查是否在待验证列表中且已验证
                const verification = pendingVerifications.get(targetGroupId);
                return !verification || verification.verified === true;
            });
            
            if (verifiedGroups.length > 0) {
                // 获取消息文本
                let messageText = '';
                if (content && content.text) {
                    messageText = content.text;
                }
                
                if (messageText) {
                    // 构造转发消息格式
                    const forwardedMessage = `[群${groupId}]${senderName}(${senderId})：${messageText}`;
                    
                    // 发送到所有已验证的互通群组
                    for (const targetGroupId of verifiedGroups) {
                        try {
                            // 避免给自己发消息
                            if (targetGroupId === groupId) continue;
                            
                            const result = await openApi.sendMessage(
                                targetGroupId,
                                'group',
                                'text',
                                forwardedMessage
                            );
                            
                            if (result.success) {
                                console.log(`消息已转发到群 ${targetGroupId}`);
                            } else {
                                console.error(`转发消息到群 ${targetGroupId} 失败:`, result.msg);
                            }
                        } catch (error) {
                            console.error(`转发消息到群 ${targetGroupId} 时出错:`, error);
                        }
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('处理消息时发生错误:', error);
    }
});

// 处理机器人设置事件
subscription.onBotSetting(async (event) => {
    try {
        const { groupId: sourceGroupId, settingJson } = event;
        const settings = JSON.parse(settingJson);
        const config = loadGroupConfig(sourceGroupId);
        
        // 处理定时消息设置
        const isEnabled = settings[FORM_IDS.SCHEDULED_SWITCH]?.value === true;
        const interval = parseInt(settings[FORM_IDS.SCHEDULED_INTERVAL]?.value) || 0;
        const content = settings[FORM_IDS.SCHEDULED_CONTENT]?.value || '';
        
        if (isEnabled) {
            await setupScheduledTask(sourceGroupId, interval, content);
        } else {
            clearScheduledTask(sourceGroupId);
        }

        // 处理列表型输入
        const processListInput = (input) => 
            input ? input.split(/[,;\n]/).map(item => item.trim()).filter(item => item && item !== sourceGroupId) : [];

        // 更新配置 - 使用FORM_IDS常量
        config.usePublicBlacklist = settings[FORM_IDS.PUBLIC_BLACKLIST_SWITCH]?.value !== false;
        config.useSharedBlacklist = settings[FORM_IDS.SHARED_BLACKLIST_SWITCH]?.value === true;
        config.useGroupBlacklist = settings[FORM_IDS.GROUP_BLACKLIST_INPUT]?.value?.trim() !== '';
        
        config.boundGroups = processListInput(settings[FORM_IDS.BOUND_GROUPS_INPUT]?.value);
        
        config.blacklist = processListInput(settings[FORM_IDS.GROUP_BLACKLIST_INPUT]?.value);
        
        config.blockedWords.disabled = settings[FORM_IDS.WORD_FILTER_SWITCH]?.value === false;
        config.blockedWords.disabledWords = processListInput(settings[FORM_IDS.DISABLED_WORDS_INPUT]?.value);

        // 处理多群互通设置
        const newLinkedGroups = processListInput(settings[FORM_IDS.CROSS_GROUP_IDS]?.value);
        
        // 找出新增的群组ID
        const addedGroups = newLinkedGroups.filter(id => 
            !config.crossGroupMessaging.linkedGroups.includes(id)
        );
        
        // 向新增群组发送验证请求
        for (const targetGroupId of addedGroups) {
            try {
                // 发送验证请求
                const result = await openApi.sendMessage(
                    targetGroupId,
                    'group',
                    'text',
                    `[群消息互通请求]\n` +
                    `群 ${sourceGroupId} 请求与本群建立消息互通关系。\n` +
                    `请群主或管理员回复"${VERIFICATION_COMMAND}"以确认绑定。\n` +
                    `(此绑定需双方群都开启互通功能才能生效)`
                );
                
                if (result.success) {
                    // 保存待验证记录
                    pendingVerifications.set(targetGroupId, {
                        sourceGroupId,
                        timestamp: Date.now(),
                        verified: false
                    });
                    
                    console.log(`已向群 ${targetGroupId} 发送验证请求`);
                    
                    // 设置5分钟超时
                    setTimeout(() => {
                        if (pendingVerifications.get(targetGroupId)?.verified === false) {
                            pendingVerifications.delete(targetGroupId);
                            console.log(`群 ${targetGroupId} 的验证请求已超时`);
                        }
                    }, 5 * 60 * 1000);
                }
            } catch (error) {
                console.error(`向群 ${targetGroupId} 发送验证请求失败:`, error);
            }
        }
        
        // 更新配置
        config.crossGroupMessaging.enabled = settings[FORM_IDS.CROSS_GROUP_SWITCH]?.value === true;
        config.crossGroupMessaging.linkedGroups = newLinkedGroups;
        
        saveGroupConfig(sourceGroupId, config);
        console.log(`群 ${sourceGroupId} 配置已更新`);

    } catch (error) {
        console.error('处理设置事件时出错:', error);
    }
});

// 优雅退出处理
function setupProcessHandlers() {
    process.on('SIGINT', () => {
        console.log('\n正在停止定时消息服务...');
        scheduledMessages.forEach((task, groupId) => {
            clearInterval(task.timer);
            console.log(`已停止群 ${groupId} 的定时消息`);
        });
        process.exit();
    });
}

// 订阅地址
app.post('/sub', (req, res) => {
    subscription.listen(req.body);
    res.status(200).json({ code: 0, msg: 'success' });
});

// 启动服务
const PORT = process.env.PORT || 7889;
app.listen(PORT, () => {
    console.log(`机器人服务已启动，端口: ${PORT}`);
    initConfigWatchers();
    restoreScheduledTasks();
    setupProcessHandlers();
});