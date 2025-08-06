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
const TOKEN = '看什么看,你没有自己的token啊?';
const openApi = new OpenApi(TOKEN);
const subscription = new Subscription();
const groupConfigsDir = path.join(__dirname, 'group_configs');
fs.mkdirSync(groupConfigsDir, { recursive: true });

// 群配置文件路径处理
const getGroupConfigPath = (groupId) => path.join(groupConfigsDir, `${groupId}.json`);
const PUBLIC_BLACKLIST_PATH = path.join(__dirname, 'blacklist.json');
const NEWSPAPER_TOKENS_PATH = path.join(__dirname, 'tokens.json');
const GROUPS_LIST_PATH = path.join(__dirname, 'groups.json');

// 验证相关常量
const VERIFICATION_COMMAND = '/确认消息互通绑定请求';
const NEWSPAPER_COMMAND = '/推送';
const VOTE_MUTE_COMMAND = '/投票禁言';
const UNMUTE_COMMAND = '/解除禁言';
const BLACKLIST_CREATE_COMMAND = '/创建黑名单';
const BLACKLIST_ADD_COMMAND = '/添加用户';
const BLACKLIST_REMOVE_COMMAND = '/移除用户';
const BLACKLIST_RENAME_COMMAND = '/重命名黑名单';
const BLACKLIST_DELETE_COMMAND = '/删除黑名单';
const PUBLIC_BLACKLISTS_DIR = path.join(__dirname, 'public_blacklists');
const activeVotes = new Map(); // groupId -> { targetUserId: { votes: Set<userId>, timestamp } }
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
  CROSS_GROUP_IDS: 'qjmliy',                   // 互通消息的群ID
  NEWSPAPER_SWITCH: 'ypaqby',                  // 报刊推送开关
  WELCOME_MSG_TYPE: 'oqookf', // 欢迎消息格式单选框
  WELCOME_MSG: 'iqovmc',     // 进群欢迎消息
  GOODBYE_MSG_TYPE: 'fncewa',  // 告别消息格式单选框
  GOODBYE_MSG: 'yyjocm',     // 退群告别消息
  VOTE_MUTE_SWITCH: 'mfvvqv',          // 投票禁言功能开关
  VOTE_ADMINS_INPUT: 'ssvcsp',          // 有投票权的用户ID输入
  VOTE_THRESHOLD_INPUT: 'zblqqi',       // 投票触发百分比输入
  BLACKLIST_SUBSCRIPTION_INPUT: 'mbaote',  // 订阅黑名单输入框
  BLACKLIST_MANAGE_SWITCH: 'xrdymm'       // 订阅黑名单开关
};

const INSTRUCTION_IDS = {
  HELP: 1842
};

// 定时任务存储
const scheduledMessages = new Map(); // groupId -> { interval, content, timer }

// 消息类型常量
const MESSAGE_FORMAT_MAP = {
  '文本': 'text',
  'Markdown': 'markdown',
  'HTML': 'html'
};

// 支持的变量列表
const MESSAGE_VARIABLES = {
  '{userId}': '用户ID',
  '{nickname}': '用户昵称',
  '{avatarUrl}': '用户头像链接',
  '{groupName}': '群组名称',
  '{groupId}': '群组ID',
  '{time}': '当前时间(YYYY-MM-DD HH:mm:ss)',
  '{date}': '当前日期(YYYY-MM-DD)',
  '{hour}': '当前小时(HH)',
  '{shortTime}': '当前时间(HH:mm)'
};

// 辅助函数
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 初始化全局配置
function initGlobalResources() {
    try {
        if (!fs.existsSync(PUBLIC_BLACKLISTS_DIR)) {
            fs.mkdirSync(PUBLIC_BLACKLISTS_DIR, { recursive: true });
        }
    } catch (error) {
        console.error('全局资源初始化失败:', error);
        process.exit(1); // 关键资源初始化失败时终止应用
    }

    if (!fs.existsSync(GROUPS_LIST_PATH)) {
    fs.writeFileSync(GROUPS_LIST_PATH, '[]'); // 空数组
    console.log('已初始化 groups.json');
    }
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
            },
            groupMessages: {
            welcome: {
                content: '',  // 默认空内容
                type: 'text'  // 默认文本格式
            },
            goodbye: {
                content: '',  // 默认空内容
                type: 'text'  // 默认文本格式
            }
            }
        };
        if (!fs.existsSync(configPath)) {
        const defaultConfig = getDefaultConfig();
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
        console.log(`已为群 ${groupId} 创建默认配置`);
        const groups = JSON.parse(fs.readFileSync(GROUPS_LIST_PATH));
        if (!groups.includes(groupId)) {
           fs.writeFileSync(
           GROUPS_LIST_PATH, 
           JSON.stringify([...groups, groupId], null, 2)
        );
        console.log(`新群组登记: ${groupId}`);
    }
        }
    }
}

if (!fs.existsSync(PUBLIC_BLACKLISTS_DIR)) {
    fs.mkdirSync(PUBLIC_BLACKLISTS_DIR, { recursive: true });
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
            },
          newspaperPush: {
            enabled: config.newspaperPush?.enabled === true
        },
          groupMessages: {
                welcome: {
                    content: config.groupMessages?.welcome?.content || '',
                    type: config.groupMessages?.welcome?.type || 'text'
                },
                goodbye: {
                    content: config.groupMessages?.goodbye?.content || '',
                    type: config.groupMessages?.goodbye?.type || 'text'
                }
            },
         voteMute: {
            enabled: config.voteMute?.enabled === true,
            admins: Array.isArray(config.voteMute?.admins) ? config.voteMute.admins : [],
            mutedUsers: Array.isArray(config.voteMute?.mutedUsers) ? config.voteMute.mutedUsers : [],
            threshold: typeof config.voteMute?.threshold === 'number' ? 
                      Math.min(100, Math.max(1, config.voteMute.threshold)) : 50
        },
          blacklistSubscription: {
      enabled: config.blacklistSubscription?.enabled ?? false,
      list: config.blacklistSubscription?.list || 
            config.subscribedBlacklists || []  // 兼容旧字段
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
        },
        newspaperPush: {
            enabled: false
        },
        voteMute: {
            enabled: false,
            admins: [],
            mutedUsers: [],
            threshold: 50
        },
        blacklistSubscription: {
        enabled: false,
        list: []
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

// 加载公共黑名单
function loadPublicBlacklist() {
    try {
        if (fs.existsSync(PUBLIC_BLACKLIST_PATH)) {
            const data = fs.readFileSync(PUBLIC_BLACKLIST_PATH, 'utf8');
            return JSON.parse(data).map(item => item.userId);
        }
        return [];
    } catch (error) {
        console.error('加载公共黑名单失败:', error);
        return [];
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

// 加载token和报刊数据
function loadNewspaperTokens() {
    try {
        if (fs.existsSync(NEWSPAPER_TOKENS_PATH)) {
            const data = fs.readFileSync(NEWSPAPER_TOKENS_PATH, 'utf8');
            return JSON.parse(data);
        }
        console.warn('未找到tokens.json文件，报刊推送功能将不可用');
        return {};
    } catch (error) {
        console.error('加载报刊token失败:', error);
        return {};
    }
}

// 验证token并获取报刊信息
function validateNewspaperToken(token) {
    const tokens = loadNewspaperTokens();
    return tokens[token] || null;
}

// 处理变量替换
function replaceMessageVariables(message, event) {
  const now = new Date();
  const timeVars = {
    '{time}': now.toLocaleString('zh-CN'),
    '{date}': now.toLocaleDateString('zh-CN'),
    '{hour}': now.getHours().toString().padStart(2, '0'),
    '{shortTime}': `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
  };
  
  return message
    .replace('{userId}', event.userId || '')
    .replace('{nickname}', event.nickname || '')
    .replace('{avatarUrl}', event.avatarUrl || '')
    .replace('{groupName}', event.groupName || '')
    .replace('{groupId}', event.chatId || '')
    .replace(/{time}|{date}|{hour}|{shortTime}/g, match => timeVars[match] || '');
}


// 获取用户创建黑名单
function getBlacklistPath(name) {
    const safeName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
    return path.join(PUBLIC_BLACKLISTS_DIR, `${safeName}.json`);
}

// 加载用户创建黑名单
function loadBlacklist(name) {
    try {
        const filePath = getBlacklistPath(name);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        return { name, creator: null, users: [] };
    } catch (error) {
        console.error(`加载黑名单 ${name} 失败:`, error);
        return { name, creator: null, users: [] };
    }
}

// 保存用户创建黑名单
function saveBlacklist(name, data) {
    try {
        const filePath = getBlacklistPath(name);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`保存黑名单 ${name} 失败:`, error);
        return false;
    }
}

// 列出所有用户创建黑名单
function listPublicBlacklists() {
    try {
        return fs.readdirSync(PUBLIC_BLACKLISTS_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace('.json', ''));
    } catch (error) {
        console.error('列出公共黑名单失败:', error);
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

    // 检查订阅的黑名单
  if (config.blacklistSubscription.enabled) {
    for (const blacklistName of config.blacklistSubscription.list) {
      const blacklist = loadBlacklist(blacklistName);
      if (blacklist.users.includes(senderId)) {
        console.log(`拦截来自订阅黑名单 ${blacklistName} 的用户 ${senderId}`);
        await openApi.recallMessage(message.msgId, groupId, chat.chatType);
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            `检测到黑名单 ${blacklistName} 中用户 ${senderId} 的消息，已自动撤回`
        );
        return true;
      }
    }
  }
    
    // 检查用户是否被禁言（仅在该群）
    if (config.voteMute?.enabled && config.voteMute.mutedUsers.includes(senderId)) {
        console.log(`🚫 拦截被禁言用户 ${senderId} 的消息`);
        
        // 尝试撤回消息
        const recallResult = await openApi.recallMessage(msgId, groupId, chatType);
        if (recallResult.code !== 1) {
            console.error('撤回消息失败:', recallResult);
        }
        
        return true;
    }
    
    // 获取消息文本
    let messageText = '';
    if (content && content.text) {
        messageText = content.text;
    }
    
    // 检查黑名单（包括公共黑名单）
    let effectiveBlacklist = [];
    
    // 如果开启了公共黑名单，加入公共黑名单用户
    if (config.usePublicBlacklist) {
        const publicBlacklist = loadPublicBlacklist();
        effectiveBlacklist = effectiveBlacklist.concat(publicBlacklist);
    }
    
    // 加入共享黑名单或独立黑名单
    if (config.useSharedBlacklist) {
        effectiveBlacklist = effectiveBlacklist.concat(loadSharedBlacklist(groupId));
    } else if (config.useGroupBlacklist) {
        effectiveBlacklist = effectiveBlacklist.concat(config.blacklist);
    }
    
    // 去重
    effectiveBlacklist = [...new Set(effectiveBlacklist)];
    
    // 检查用户是否在黑名单中
    if (effectiveBlacklist.includes(senderId)) {
        console.log(`🚫 拦截黑名单用户 ${senderId} 的消息`);
        
        // 尝试撤回消息
        const recallResult = await openApi.recallMessage(msgId, groupId, chatType);
        if (recallResult.code !== 1) {
            console.error('撤回消息失败:', recallResult);
        }
        
        // 发送通知消息
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            `检测到黑名单用户 ${senderId} 的消息，已自动撤回`
        );
        
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
            await openApi.sendMessage(
            groupId,
            'group',
            'text',
            `🚫 拦截包含屏蔽词 "${foundWord}" 的消息`
            );
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

// 报刊推送函数
async function pushNewspaper(articleId, articleName, newspaperName) {
    try {
        // 获取所有开启了报刊推送的群组
        const files = fs.readdirSync(groupConfigsDir).filter(f => f.endsWith('.json'));
        
        let successCount = 0;
        let failCount = 0;
        
        for (const file of files) {
            const groupId = file.replace('.json', '');
            const config = loadGroupConfig(groupId);
            
            if (config.newspaperPush.enabled) {
                try {
                    // 创建带链接的文章名
                    const linkedArticleName = `[${articleName}](yunhu://post-detail?id=${articleId})`;
                    
                    const markdownContent = `📰 报刊又上新啦！来看看今天的新鲜事吧~\n${linkedArticleName}\n来源：${newspaperName}`;
                    
                    const result = await openApi.sendMessage(
                        groupId,
                        'group',
                        'markdown',
                        markdownContent
                    );
                    
                    if (result.success) {
                        successCount++;
                        console.log(`报刊内容已推送到群 ${groupId} (文章ID: ${articleId})`);
                    } else {
                        failCount++;
                        console.error(`报刊内容推送到群 ${groupId} 失败:`, result.msg);
                    }
                } catch (error) {
                    failCount++;
                    console.error(`推送到群 ${groupId} 时出错:`, error);
                }
                
                await delay(1000); // 群组间发送间隔
            }
        }
        
        console.log(`报刊推送完成: 成功 ${successCount} 个群组, 失败 ${failCount} 个群组`);
        return { success: true, successCount, failCount };
    } catch (error) {
        console.error('推送报刊时发生错误:', error);
        return { success: false, error: error.message };
    }
}

// 配置热加载
function initConfigWatchers() {
    const watcher = chokidar.watch(groupConfigsDir, { persistent: true, ignoreInitial: true });
    watcher.on('change', (filePath) => {
        const groupId = path.basename(filePath, '.json');
        console.log(`群 ${groupId} 配置已更新`);
    });
}

// 报刊推送函数
async function pushNewspaperToGroups(content) {
    try {
        // 获取所有开启了报刊推送的群组
        const files = fs.readdirSync(groupConfigsDir).filter(f => f.endsWith('.json'));
        
        for (const file of files) {
            const groupId = file.replace('.json', '');
            const config = loadGroupConfig(groupId);
            
            if (config.newspaperPush.enabled) {
                try {
                    const result = await openApi.sendMessage(
                        groupId,
                        'group',
                        'text',
                        content
                    );
                    
                    if (result.success) {
                        console.log(`报刊内容已推送到群 ${groupId}`);
                    } else {
                        console.error(`报刊内容推送到群 ${groupId} 失败:`, result.msg);
                    }
                } catch (error) {
                    console.error(`推送到群 ${groupId} 时出错:`, error);
                }
                
                await delay(1000); // 群组间发送间隔
            }
        }
    } catch (error) {
        console.error('推送报刊时发生错误:', error);
    }
}

// 处理投票禁言命令
async function handleVoteMuteCommand(event) {
    const { sender, chat, message } = event;
    const { chatId: groupId, chatType } = chat;
    const { content } = message;
    const senderId = sender.senderId;

    // 只在群聊中处理
    if (chatType !== 'group') return;

    // 检查是否为投票禁言命令
    if (!content?.text?.startsWith(VOTE_MUTE_COMMAND)) return;

    // 加载群配置
    const config = loadGroupConfig(groupId);
    
    // 检查是否开启投票禁言功能
    if (!config.voteMute?.enabled) {
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            '❌ 本群未开启投票禁言功能'
        );
        return;
    }

    // 检查发送者是否有投票权
    if (!config.voteMute.admins.includes(senderId)) {
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            '❌ 您没有投票禁言的权限'
        );
        return;
    }

    // 解析命令
    const parts = content.text.trim().split(/\s+/);
    if (parts.length < 2) {
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            `❌ 命令格式错误\n正确格式: ${VOTE_MUTE_COMMAND} <用户ID>`
        );
        return;
    }

    const targetUserId = parts[1];
    
    // 不能禁言自己
    if (targetUserId === senderId) {
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            '❌ 不能对自己发起禁言投票'
        );
        return;
    }

    // 检查目标用户是否已被禁言
    if (config.voteMute.mutedUsers.includes(targetUserId)) {
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            `❌ 用户 ${targetUserId} 已被禁言`
        );
        return;
    }

    // 获取或初始化投票
    let vote = activeVotes.get(groupId);
    if (!vote || vote.targetUserId !== targetUserId) {
        vote = {
            targetUserId,
            votes: new Set([senderId]), // 发起人自动投票
            timestamp: Date.now()
        };
        activeVotes.set(groupId, vote);
    } else {
        // 检查是否已投票
        if (vote.votes.has(senderId)) {
            await openApi.sendMessage(
                groupId,
                'group',
                'text',
                '❌ 您已经投过票了'
            );
            return;
        }
        vote.votes.add(senderId);
    }

    // 计算投票结果
    const adminCount = config.voteMute.admins.length;
    const currentVotes = vote.votes.size;
    const requiredVotes = Math.ceil(adminCount * (config.voteMute.threshold / 100)); // 使用自定义百分比
    
    await openApi.sendMessage(
        groupId,
        'group',
        'text',
        `✅ 投票已记录\n` +
        `当前禁言 ${targetUserId} 的投票: ${currentVotes}/${requiredVotes} (需${config.voteMute.threshold}%)\n` +
        `还需 ${requiredVotes - currentVotes} 票`
    );

    // 检查是否通过
    if (currentVotes >= requiredVotes) {
        // 禁言用户
        config.voteMute.mutedUsers.push(targetUserId);
        saveGroupConfig(groupId, config);

        // 通知群组
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            `⚠️ 投票通过\n` +
            `用户 ${targetUserId} 已被禁言\n` +
            `将自动撤回其发送的消息`
        );

        // 清除投票
        activeVotes.delete(groupId);
    }
}

// 处理解除禁言命令
async function handleUnmuteCommand(event) {
    const { sender, chat, message } = event;
    const { chatId: groupId, chatType } = chat;
    const { content } = message;
    const senderId = sender.senderId;

    // 只在群聊中处理
    if (chatType !== 'group') return;

    // 检查是否为解除禁言命令
    if (!content?.text?.startsWith(UNMUTE_COMMAND)) return;

    // 检查发送者权限（仅群主或管理员）
    if (!['owner', 'administrator'].includes(sender.senderUserLevel)) {
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            '❌ 只有群主或管理员可以解除禁言'
        );
        return;
    }

    // 加载群配置
    const config = loadGroupConfig(groupId);

    // 检查是否开启投票禁言功能
    if (!config.voteMute?.enabled) {
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            '❌ 本群未开启投票禁言功能'
        );
        return;
    }

    // 解析命令
    const parts = content.text.trim().split(/\s+/);
    if (parts.length < 2) {
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            `❌ 命令格式错误\n正确格式: ${UNMUTE_COMMAND} <用户ID>`
        );
        return;
    }

    const targetUserId = parts[1];

    // 检查目标用户是否被禁言
    if (!config.voteMute.mutedUsers.includes(targetUserId)) {
        await openApi.sendMessage(
            groupId,
            'group',
            'text',
            `❌ 用户 ${targetUserId} 未被禁言`
        );
        return;
    }

    // 解除禁言
    config.voteMute.mutedUsers = config.voteMute.mutedUsers.filter(id => id !== targetUserId);
    saveGroupConfig(groupId, config);

    await openApi.sendMessage(
        groupId,
        'group',
        'text',
        `✅ 用户 ${targetUserId} 已被解除禁言`
    );
}

setInterval(() => {
    const now = Date.now();
    const expiredVotes = [];
    
    activeVotes.forEach((vote, groupId) => {
        if (now - vote.timestamp > 24 * 60 * 60 * 1000) { // 24小时过期
            expiredVotes.push(groupId);
        }
    });
    
    expiredVotes.forEach(groupId => {
        activeVotes.delete(groupId);
        console.log(`群 ${groupId} 的投票已过期`);
    });
}, 60 * 60 * 1000); // 每小时检查一次

// 处理黑名单创建命令
async function handleCreateBlacklist(event) {
    const { sender, chat, message } = event;
    const { content } = message;
    
    if (chat.chatType !== 'bot') return;
    if (!content?.text?.startsWith(BLACKLIST_CREATE_COMMAND)) return;
    
    const parts = content.text.trim().split(/\s+/);
    if (parts.length < 2) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 格式错误\n正确格式: ${BLACKLIST_CREATE_COMMAND} <黑名单名称>`
        );
        return;
    }
    
    const name = parts.slice(1).join(' ');
    const filePath = getBlacklistPath(name);
    
    if (fs.existsSync(filePath)) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 黑名单 "${name}" 已存在`
        );
        return;
    }
    
    const blacklist = {
        name,
        creator: sender.senderId,
        users: [],
        createdAt: new Date().toISOString()
    };
    
    if (saveBlacklist(name, blacklist)) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `✅ 已创建黑名单 "${name}"\n` +
            `使用 ${BLACKLIST_ADD_COMMAND} ${name} <用户ID> 添加用户`
        );
    } else {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            '❌ 创建黑名单失败，请稍后再试'
        );
    }
}

// 处理用户黑名单添加用户命令
async function handleAddToBlacklist(event) {
    const { sender, chat, message } = event;
    const { content } = message;
    
    if (chat.chatType !== 'bot') return;
    if (!content?.text?.startsWith(BLACKLIST_ADD_COMMAND)) return;
    
    const parts = content.text.trim().split(/\s+/);
    if (parts.length < 3) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 格式错误\n正确格式: ${BLACKLIST_ADD_COMMAND} <黑名单名称> <用户ID>`
        );
        return;
    }
    
    const name = parts[1];
    const userId = parts[2];
    const blacklist = loadBlacklist(name);
    
    if (!blacklist.creator) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 黑名单 "${name}" 不存在`
        );
        return;
    }
    
    if (blacklist.creator !== sender.senderId) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 只有创建者可以管理黑名单 "${name}"`
        );
        return;
    }
    
    if (blacklist.users.includes(userId)) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `ℹ️ 用户 ${userId} 已在黑名单中`
        );
        return;
    }
    
    blacklist.users.push(userId);
    blacklist.updatedAt = new Date().toISOString();
    
    if (saveBlacklist(name, blacklist)) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `✅ 已将用户 ${userId} 添加到黑名单 "${name}"`
        );
    } else {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            '❌ 添加用户失败，请稍后再试'
        );
    }
}


// 处理用户黑名单移除用户命令
async function handleRemoveFromBlacklist(event) {
    const { sender, chat, message } = event;
    const { content } = message;

    // 只在私聊中处理
    if (chat.chatType !== 'bot') return;
    if (!content?.text?.startsWith(BLACKLIST_REMOVE_COMMAND)) return;

    const parts = content.text.trim().split(/\s+/);
    if (parts.length < 3) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 格式错误\n正确格式: ${BLACKLIST_REMOVE_COMMAND} <黑名单名称> <用户ID>`
        );
        return;
    }

    const name = parts[1];
    const userId = parts[2];
    const blacklist = loadBlacklist(name);

    // 检查黑名单是否存在
    if (!blacklist.creator) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 黑名单 "${name}" 不存在`
        );
        return;
    }

    // 检查操作权限（仅创建者可管理）
    if (blacklist.creator !== sender.senderId) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 只有创建者可以管理黑名单 "${name}"`
        );
        return;
    }

    // 检查用户是否在黑名单中
    if (!blacklist.users.includes(userId)) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `ℹ️ 用户 ${userId} 不在黑名单中`
        );
        return;
    }

    // 移除用户并保存
    blacklist.users = blacklist.users.filter(id => id !== userId);
    blacklist.updatedAt = new Date().toISOString();

    if (saveBlacklist(name, blacklist)) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `✅ 已从黑名单 "${name}" 移除用户 ${userId}`
        );
    } else {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            '❌ 移除用户失败，请稍后再试'
        );
    }
}

// 处理用户黑名单重命名命令
async function handleRenameBlacklist(event) {
    const { sender, chat, message } = event;
    const { content } = message;

    if (chat.chatType !== 'bot') return;
    if (!content?.text?.startsWith(BLACKLIST_RENAME_COMMAND)) return;

    const parts = content.text.trim().split(/\s+/);
    if (parts.length < 3) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 格式错误\n正确格式: ${BLACKLIST_RENAME_COMMAND} <旧名称> <新名称>`
        );
        return;
    }

    const oldName = parts[1];
    const newName = parts.slice(2).join(' ');
    const blacklist = loadBlacklist(oldName);

    // 检查旧黑名单是否存在
    if (!blacklist.creator) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 黑名单 "${oldName}" 不存在`
        );
        return;
    }

    // 检查操作权限
    if (blacklist.creator !== sender.senderId) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 只有创建者可以重命名黑名单 "${oldName}"`
        );
        return;
    }

    // 检查新名称是否已存在
    if (fs.existsSync(getBlacklistPath(newName))) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 黑名单 "${newName}" 已存在`
        );
        return;
    }

    // 重命名文件
    try {
        fs.renameSync(
            getBlacklistPath(oldName),
            getBlacklistPath(newName)
        );
        
        // 更新黑名单名称字段
        blacklist.name = newName;
        blacklist.updatedAt = new Date().toISOString();
        saveBlacklist(newName, blacklist);

        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `✅ 已重命名黑名单 "${oldName}" → "${newName}"`
        );
    } catch (error) {
        console.error(`重命名黑名单失败:`, error);
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            '❌ 重命名失败，请稍后再试'
        );
    }
}

// 处理用户黑名单删除命令
async function handleDeleteBlacklist(event) {
    const { sender, chat, message } = event;
    const { content } = message;

    if (chat.chatType !== 'bot') return;
    if (!content?.text?.startsWith(BLACKLIST_DELETE_COMMAND)) return;

    const parts = content.text.trim().split(/\s+/);
    if (parts.length < 2) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 格式错误\n正确格式: ${BLACKLIST_DELETE_COMMAND} <黑名单名称>`
        );
        return;
    }

    const name = parts[1];
    const blacklist = loadBlacklist(name);

    // 检查黑名单是否存在
    if (!blacklist.creator) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 黑名单 "${name}" 不存在`
        );
        return;
    }

    // 检查操作权限
    if (blacklist.creator !== sender.senderId) {
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `❌ 只有创建者可以删除黑名单 "${name}"`
        );
        return;
    }

    // 删除文件
    try {
        fs.unlinkSync(getBlacklistPath(name));
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            `✅ 已永久删除黑名单 "${name}"`
        );
    } catch (error) {
        console.error(`删除黑名单失败:`, error);
        await openApi.sendMessage(
            sender.senderId,
            'user',
            'text',
            '❌ 删除失败，请稍后再试'
        );
    }
}

async function handleHelpInstruction(event) {
  const { sender, chat, message } = event;
  
  // 只处理指令消息且是指定的帮助指令ID
  if (message.instructionId !== INSTRUCTION_IDS.HELP) return;

  const helpMessage = `📚 可用指令帮助：

【群指令】（发送到群内使用）
• /投票禁言 <用户ID> - 发起禁言投票
• /解除禁言 <用户ID> - (管理员专用)直接解除禁言

【私聊指令】（私聊发送给机器人使用）
• /创建黑名单 <黑名单名称> - 创建公开黑名单
• /添加用户 <黑名单名称> <用户ID> - 添加用户到黑名单
• /移除用户 <黑名单名称> <用户ID> - 将用户从黑名单内移除
• /重命名黑名单 <黑名单名称> - 重命名公开黑名单
• /删除黑名单 <黑名单名称> - 删除公开黑名单`;

  await openApi.sendMessage(
    chat.chatType === 'group' ? chat.chatId : sender.senderId,
    chat.chatType,
    'text',
    helpMessage
  );
}

// 处理普通消息事件
subscription.onMessageNormal(async (event) => {
if (event.chat.chatType === 'group') {
    const groupId = event.chat.chatId;
    initNewGroup(groupId); // 自动创建配置+登记群组
  }
  
    try {
        const { sender, chat, message } = event;
        const { chatId, chatType } = chat;
        const { content } = message;

        // 处理投票禁言相关命令
        await handleVoteMuteCommand(event);
        await handleUnmuteCommand(event);

        // 处理订阅黑名单命令
        await handleCreateBlacklist(event);
        await handleAddToBlacklist(event);
        await handleRemoveFromBlacklist(event);
        await handleRenameBlacklist(event);
        await handleDeleteBlacklist(event);
        
        // 处理私聊消息 - 报刊推送指令
        if (chatType === 'bot') {
            // 检查是否为报刊推送指令
            if (content?.text?.startsWith(NEWSPAPER_COMMAND)) {
                const commandParts = content.text.trim().split(/\s+/);
                
                // 验证指令格式
                if (commandParts.length < 4) {
                    await openApi.sendMessage(
                        chatId,
                        'user',
                        'text',
                        '❌ 指令格式错误\n正确格式：/推送 <文章ID> <文章名称> <token>'
                    );
                    return;
                }
                
                const [, articleId, articleName, token] = commandParts;
                const newspaperInfo = validateNewspaperToken(token);
                
                if (!newspaperInfo) {
                    await openApi.sendMessage(
                        chatId,
                        'user',
                        'text',
                        '❌ 无效的token\n请检查token是否正确'
                    );
                    return;
                }
                
                // 验证通过，开始推送
                await pushNewspaper(articleId, articleName, newspaperInfo.name);
                
                await openApi.sendMessage(
                    chatId,
                    'user',
                    'text',
                    `✅ 报刊推送已开始\n文章"${articleName}"将推送到所有订阅群组`
                );
                return;
            }
        }
        
        // 群聊消息处理
        const groupId = chatId; // 群聊中chatId就是群ID
        
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
                    const forwardedMessage = `[群${groupId}]${sender.senderNickname || sender.senderId}(${sender.senderId})：${messageText}`;
                    
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
        console.error('处理设置事件时出错:', error);
    }
});

subscription.onMessageInstruction(handleHelpInstruction);

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

        // 使用FORM_IDS常量
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

        // 处理报刊推送开关
        config.newspaperPush.enabled = settings[FORM_IDS.NEWSPAPER_SWITCH]?.value === true;
        
        // 处理进退群消息设置
        config.groupMessages = {
            welcome: {
                content: settings[FORM_IDS.WELCOME_MSG]?.value || '',
                type: MESSAGE_FORMAT_MAP[settings[FORM_IDS.WELCOME_MSG_TYPE]?.selectValue] || 'text'
            },
            goodbye: {
                content: settings[FORM_IDS.GOODBYE_MSG]?.value || '',
                type: MESSAGE_FORMAT_MAP[settings[FORM_IDS.GOODBYE_MSG_TYPE]?.selectValue] || 'text'
            }
        };

       // 处理投票禁言设置
        config.voteMute = {
            enabled: settings[FORM_IDS.VOTE_MUTE_SWITCH]?.value === true,
            admins: processListInput(settings[FORM_IDS.VOTE_ADMINS_INPUT]?.value),
            mutedUsers: config.voteMute?.mutedUsers || [], // 保留原有的禁言用户
            threshold: parseInt(settings[FORM_IDS.VOTE_THRESHOLD_INPUT]?.value) || 50
        };
        
        // 确保百分比在1-100之间
        config.voteMute.threshold = Math.min(100, Math.max(1, config.voteMute.threshold));

        // 处理订阅的黑名单
        config.blacklistSubscription = {
         enabled: Boolean(settings[FORM_IDS.BLACKLIST_MANAGE_SWITCH]?.value),
        list: []
         };
        if (settings[FORM_IDS.BLACKLIST_SUBSCRIPTION_INPUT]?.value) {
            config.blacklistSubscription.list = settings[FORM_IDS.BLACKLIST_SUBSCRIPTION_INPUT].value
                .split(',')
                .map(name => name.trim())
                .filter(name => name);
        } else {
            config.blacklistSubscription.list = [];
        }

        
        // 保存配置
        saveGroupConfig(sourceGroupId, config);
        
        // 确保保存完整的配置结构
        const configToSave = {
            ...config,
            newspaperPush: {
                enabled: config.newspaperPush.enabled
            },
            groupMessages: config.groupMessages,
            usePublicBlacklist: config.usePublicBlacklist,
            useGroupBlacklist: config.useGroupBlacklist,
            useSharedBlacklist: config.useSharedBlacklist,
            boundGroups: config.boundGroups,
            blacklist: config.blacklist,
            blockedWords: config.blockedWords,
            crossGroupMessaging: config.crossGroupMessaging
        };
        
        fs.writeFileSync(getGroupConfigPath(sourceGroupId), JSON.stringify(configToSave, null, 2));
        console.log(`群 ${sourceGroupId} 配置已更新`, {
            newspaperPush: configToSave.newspaperPush.enabled,
            welcomeMsg: configToSave.groupMessages.welcome.content ? '已设置' : '未设置',
            goodbyeMsg: configToSave.groupMessages.goodbye.content ? '已设置' : '未设置'
        });

    } catch (error) {
        console.error('处理设置事件时出错:', error);
    }
});

// 处理群成员加入事件
subscription.onGroupJoin(async (event) => {
    try {
        const config = loadGroupConfig(event.chatId);
        
        if (config.groupMessages.welcome?.content?.trim()) {
            const message = replaceMessageVariables(
                config.groupMessages.welcome.content,
                event
            );
            
            await openApi.sendMessage(
                event.chatId,
                'group',
                config.groupMessages.welcome.type || 'text',
                message
            );
        }
    } catch (error) {
        console.error('处理群成员加入事件时出错:', error);
    }
});

// 群成员离开事件处理
subscription.onGroupLeave(async (event) => {
    try {
        const config = loadGroupConfig(event.chatId);
        
        if (config.groupMessages.goodbye?.content?.trim()) {
            const message = replaceMessageVariables(
                config.groupMessages.goodbye.content,
                event
            );
            
            await openApi.sendMessage(
                event.chatId,
                'group',
                config.groupMessages.goodbye.type || 'text',
                message
            );
        }
    } catch (error) {
        console.error('处理群成员离开事件时出错:', error);
    }
});


function migrateBlacklistConfigs() {
  const files = fs.readdirSync(groupConfigsDir);
  files.forEach(file => {
    const config = JSON.parse(fs.readFileSync(path.join(groupConfigsDir, file)));
    if (Array.isArray(config.subscribedBlacklists)) {
      config.blacklistSubscription = {
        enabled: true,
        list: config.subscribedBlacklists
      };
      delete config.subscribedBlacklists;
      fs.writeFileSync(path.join(groupConfigsDir, file), JSON.stringify(config));
    }
  });
}

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
    initGlobalResources();
    console.log(`机器人服务已启动，端口: ${PORT}`);
    initConfigWatchers();
    restoreScheduledTasks();
    setupProcessHandlers();
});
