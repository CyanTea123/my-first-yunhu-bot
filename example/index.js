const express = require('express');
const OpenApi = require('../lib/OpenApi');
const Subscription = require('../lib/Subscription');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const axios = require('axios');

// ==================== 配置常量 ====================
const CONFIG = {
  TOKEN: '看什么看，你没有自己的token吗？',
  PORT: process.env.PORT || 7889,
  
  // 数据目录
  DATA_DIR: path.join(__dirname, 'data'),
  
  // 文件路径
  PATHS: {
    groupConfigs: path.join(__dirname, 'data', 'group_configs'),
    publicBlacklist: path.join(__dirname, 'data', 'blacklist.json'),
    groupsList: path.join(__dirname, 'data', 'groups.json'),
    publicBlacklists: path.join(__dirname, 'data', 'public_blacklists'),
    blockedWords: path.join(__dirname, 'data', 'blocked_words.json')
  },
  
  // 超时配置
  TIMEOUTS: {
    vote: 24 * 60 * 60 * 1000,      // 投票超时24小时
    verification: 5 * 60 * 1000,     // 验证超时5分钟
    submission: 2 * 60 * 1000,       // 提交超时2分钟
    api: 20000,                      // API超时20秒
    http: 5000                       // HTTP超时5秒
  }
};

// 命令常量
const COMMANDS = {
  VERIFICATION: '/确认消息互通绑定请求',
  NEWSPAPER: '/推送',
  VOTE_MUTE: '/投票禁言',
  UNMUTE: '/解除禁言',
  BLACKLIST: {
    CREATE: '/创建黑名单',
    ADD: '/添加用户',
    REMOVE: '/移除用户',
    RENAME: '/重命名黑名单',
    DELETE: '/删除黑名单'
  }
};

// 表单ID映射
const FORM_IDS = {
  PUBLIC_BLACKLIST_SWITCH: 'lehzep',          // 公共黑名单开关
  BOUND_GROUPS_INPUT: 'tttnss',               // 绑定群组输入
  GROUP_BLACKLIST_INPUT: 'jsgqio',            // 群独立黑名单输入
  WORD_FILTER_SWITCH: 'yezkdo',               // 屏蔽词判定开关
  DISABLED_WORDS_INPUT: 'pduhoq',             // 禁用屏蔽词输入
  SCHEDULED_SWITCH: 'xglhcu',                 // 定时消息开关
  SCHEDULED_INTERVAL: 'uzglls',               // 发送间隔(分钟)
  SCHEDULED_CONTENT: 'yukouf',                // 消息内容
  CROSS_GROUP_SWITCH: 'xewutp',               // 多群消息互通开关
  CROSS_GROUP_IDS: 'jyhfrr',                   // 互通消息的群ID
  WELCOME_MSG: 'zhkqxt',
  WELCOME_MSG_TYPE: 'rnyzen', // 欢迎消息格式单选框
  GOODBYE_MSG: 'qfprxc',
  GOODBYE_MSG_TYPE: 'csrepg',  // 告别消息格式单选框
  VOTE_MUTE_SWITCH: 'ivomqh',
  VOTE_ADMINS_INPUT: 'zpuzcf',
  VOTE_THRESHOLD_INPUT: 'xcipmx',
  BLACKLIST_SUBSCRIPTION_INPUT: 'wotmcg',
  BLACKLIST_MANAGE_SWITCH: 'wjjnqn'
};

const INSTRUCTION_IDS = {
  HELP: 1892
};

// 消息格式映射
const MESSAGE_FORMAT_MAP = {
  '文本': 'text',
  'Markdown': 'markdown',
  'HTML': 'html'
};

const getBlacklistPath = (name) => {
  const safeName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  return path.join(CONFIG.PATHS.publicBlacklists, `${safeName}.json`);
};

// ==================== 核心类定义 ====================
class BotService {
  constructor() {
    this.openApi = new OpenApi(CONFIG.TOKEN);
    this.subscription = new Subscription();

    this.logger = {
      debug: (msg, data) => console.log(`[DEBUG] ${msg}`, data),
      error: (msg, error) => console.error(`[ERROR] ${msg}`, error),
      incoming: (event) => {
        console.log('--- 收到原始消息 ---');
        console.log('发送者:', event.sender);
        console.log('聊天类型:', event.chat.chatType);
        console.log('消息类型:', event.message.contentType);
        console.log('内容:', JSON.stringify(event.message.content, null, 2));
      }
    };
    
    // 内存缓存
    this.cache = {
      groupConfigs: new Map(),  // 群组配置缓存
      publicBlacklist: null,    // 公共黑名单缓存
      blockedWords: null,       // 屏蔽词缓存
      newspaperTokens: null,     // 报刊token缓存
      lastCacheUpdate: new Map() // 最后更新时间
    };
    
    // 运行时状态
    this.state = {
      scheduledMessages: new Map(),
      activeVotes: new Map(),
      pendingVerifications: new Map(),
      pendingSubmissions: new Map()
    };

    this.timers = new Map(); 
    
    this.init();
  }

  /* ==================== 缓存管理方法 ==================== */
  getCachedGroupConfig(groupId) {
    // 如果缓存中没有或超过5分钟未更新，则从文件加载
    if (!this.cache.groupConfigs.has(groupId)) {
      this.cache.groupConfigs.set(groupId, this.loadGroupConfig(groupId));
    } else {
      const lastUpdate = this.cache.lastCacheUpdate.get(groupId) || 0;
      if (Date.now() - lastUpdate > 300000) { // 5分钟缓存
        this.cache.groupConfigs.set(groupId, this.loadGroupConfig(groupId));
      }
    }
    return this.cache.groupConfigs.get(groupId);
  }

  updateGroupConfigCache(groupId, config) {
    this.cache.groupConfigs.set(groupId, config);
    this.cache.lastCacheUpdate.set(groupId, Date.now());
  }
  
  /* ==================== 数据初始化 ==================== */
  async loadInitialData() {
    try {
      // 加载公共黑名单
      this.cache.publicBlacklist = this.loadPublicBlacklist();
      
      // 加载屏蔽词
      this.cache.blockedWords = this.loadBlockedWords();
      
      // 加载群组列表
      const groups = this.loadGroupsList();
      groups.forEach(groupId => {
        this.cache.groupConfigs.set(groupId, this.loadGroupConfig(groupId));
      });
      
      console.log('✅ 初始数据加载完成');
    } catch (error) {
      console.error('加载初始数据失败:', error);
      throw error;
    }
  }

  loadPublicBlacklist() {
  try {
    if (fs.existsSync(CONFIG.PATHS.publicBlacklist)) {
      const data = fs.readFileSync(CONFIG.PATHS.publicBlacklist, 'utf8');
      const list = JSON.parse(data);
      // 兼容两种格式：纯数组或对象数组
      return Array.isArray(list) ? 
        list.map(item => typeof item === 'object' ? item.userId : item) : 
        [];
    }
    return [];
  } catch (error) {
    console.error('加载公共黑名单失败:', error);
    return [];
  }
}

  loadBlockedWords() {
    try {
      if (fs.existsSync(CONFIG.PATHS.blockedWords)) {
        const data = fs.readFileSync(CONFIG.PATHS.blockedWords, 'utf8');
        return JSON.parse(data);
      }
      return { disabled: true, disabledWords: [] };
    } catch (error) {
      console.error('加载屏蔽词失败:', error);
      return { disabled: true, disabledWords: [] };
    }
  }

  loadGroupsList() {
    try {
      if (!fs.existsSync(CONFIG.PATHS.groupsList)) {
        fs.writeFileSync(CONFIG.PATHS.groupsList, '[]');
        return [];
      }
      const data = fs.readFileSync(CONFIG.PATHS.groupsList, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('加载群组列表失败:', error);
      return [];
    }
  }
  
  /* ==================== 初始化方法 ==================== */
  async init() {
    try {
      console.log('🔄 正在初始化服务...');
      this.initDirectories();
      this.setupEventHandlers();
      this.setupTimers(); // 初始化定时器系统
      await this.loadInitialData();
      this.restoreScheduledTasks();
      console.log('✅ 服务初始化完成');
    } catch (error) {
      console.error('初始化失败:', error);
      // 清理已创建的资源
      this.clearAllTimers();
      throw error;
    }
  }

  // 初始化新群组
  initNewGroup(groupId) {
    const configPath = path.join(CONFIG.PATHS.groupConfigs, `${groupId}.json`);
    
    if (!fs.existsSync(configPath)) {
      const config = this.getDefaultConfig();
      this.saveGroupConfig(groupId, config);
      
      // 更新群组列表
      const groups = this.loadGroupsList();
      if (!groups.includes(groupId)) {
        groups.push(groupId);
        fs.writeFileSync(CONFIG.PATHS.groupsList, JSON.stringify(groups));
      }
    }
  }

  // 消息变量替换
  replaceMessageVariables(message, event) {
    const now = new Date();
    const replacements = {
      '{userId}': event.sender?.senderId || '',
      '{nickname}': event.sender?.senderNickname || '',
      '{avatarUrl}': event.sender?.senderAvatarUrl || '',
      '{groupName}': event.chat?.chatName || '',
      '{groupId}': event.chat?.chatId || '',
      '{time}': now.toLocaleString('zh-CN'),
      '{date}': now.toLocaleDateString('zh-CN'),
      '{hour}': now.getHours().toString().padStart(2, '0'),
      '{shortTime}': `${now.getHours()}:${now.getMinutes()}`
    };
    
    return message.replace(/\{\w+\}/g, match => replacements[match] || '');
  }

  /* ==================== 文件系统管理 ==================== */
  initDirectories() {
    [CONFIG.DATA_DIR, CONFIG.PATHS.groupConfigs, CONFIG.PATHS.publicBlacklists].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
    if (!fs.existsSync(CONFIG.PATHS.groupsList)) {
      fs.writeFileSync(CONFIG.PATHS.groupsList, '[]');
    }
  }

  /* ==================== 配置管理 ==================== */
 loadGroupConfig(groupId) {
  const configPath = path.join(CONFIG.PATHS.groupConfigs, `${groupId}.json`);
  
  try {
    if (fs.existsSync(configPath)) {
      // 验证文件完整性
      const rawData = fs.readFileSync(configPath, 'utf8');
      if (!rawData.trim()) {
        throw new Error('空配置文件');
      }
      
      const config = JSON.parse(rawData);
      
      // 验证定时任务配置结构
      if (config.scheduledMessage && typeof config.scheduledMessage.enabled !== 'boolean') {
        config.scheduledMessage.enabled = false;
        this.saveGroupConfig(groupId, config); // 自动修复
      }
      
      return {
        ...this.getDefaultConfig(),
        ...config
      };
    }
  } catch (error) {
    console.error(`加载群 ${groupId} 配置失败，使用默认配置:`, error);
    
    // 备份损坏的配置文件
    if (fs.existsSync(configPath)) {
      const backupPath = `${configPath}.bak.${Date.now()}`;
      fs.renameSync(configPath, backupPath);
      console.log(`已备份损坏配置: ${backupPath}`);
    }
  }
  
  return this.getDefaultConfig();
}
  
  getDefaultConfig() {
    return {
      usePublicBlacklist: true,
      useGroupBlacklist: false,
      boundGroups: [],
      blacklist: [],
      blockedWords: { disabled: true, disabledWords: [] },
      crossGroupMessaging: { enabled: false, linkedGroups: [] },
      voteMute: {
        enabled: false,
        admins: [],
        mutedUsers: [],
        threshold: 50
      },
      scheduledMessage: {
        enabled: false,
        interval: 0,
        content: ''
      },
      groupMessages: {
        welcome: {
          content: '',
          type: 'text'
        },
        goodbye: {
          content: '',
          type: 'text'
        }
      },
      blacklistSubscription: {
        enabled: false,
        list: []
      }
    };
  }

async saveGroupConfig(groupId, config) {
  const configPath = path.join(CONFIG.PATHS.groupConfigs, `${groupId}.json`);
  
  try {
    // 1. 确保目录存在
    if (!fs.existsSync(CONFIG.PATHS.groupConfigs)) {
      fs.mkdirSync(CONFIG.PATHS.groupConfigs, { recursive: true });
    }

    // 2. 原子化写入操作
    const tempPath = `${configPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2));
    
    // 3. 确保文件完全写入
    fs.fsyncSync(fs.openSync(tempPath, 'r+'));
    
    // 4. 重命名操作（原子操作）
    fs.renameSync(tempPath, configPath);
    
    // 5. 更新内存缓存
    this.updateGroupConfigCache(groupId, config);
    
    console.log(`💾 [成功] 群 ${groupId} 配置已保存`, {
      scheduled: config.scheduledMessage?.enabled,
      path: configPath,
      size: fs.statSync(configPath).size + ' bytes'
    });
    return true;
  } catch (error) {
    console.error(`💾 [失败] 保存群 ${groupId} 配置出错:`, {
      error: error.message,
      stack: error.stack,
      config: JSON.stringify(config)
    });
    return false;
  }
}

  /* ==================== 事件处理核心 ==================== */
  async handleNormalMessage(event) {
    try {
      // 1. 记录原始消息
      this.logger.incoming(event);

      // 2. 强制类型检查
      if (!event || !event.message) {
        this.logger.debug('无效的消息结构', event);
        return;
      }

      // 3. 严格内容检查
      if (event.message.contentType !== 'text') {
        this.logger.debug('忽略非文本消息', event.message.contentType);
        return;
      }

      const rawText = event.message.content?.text;
      if (typeof rawText !== 'string') {
        this.logger.debug('消息无文本内容', event.message.content);
        return;
      }

      const text = rawText.trim();
      this.logger.debug('清理后文本', `"${text}"`);

      // 4. 终极指令检测
      const isCommand = this.isStrictCommand(text);
      this.logger.debug('指令检测结果', {
        text,
        isCommand,
        firstWord: text.split(/\s+/)[0]
      });

      if (!isCommand) {
        this.logger.debug('忽略非指令消息', text);
        return;
      }

      // 5. 指令路由
      const handler = this.getCommandHandler(text);
      if (!handler) {
        this.logger.error('未找到指令处理器', text);
        return;
      }

      await handler(event);
    } catch (error) {
      this.logger.error('处理消息时异常', {
        error: error.stack,
        rawEvent: JSON.stringify(event, null, 2)
      });
    }
  }

  // 严格指令检测（最终版）
  isStrictCommand(text) {
    const COMMAND_LIST = [
      COMMANDS.VERIFICATION,
      COMMANDS.VOTE_MUTE,
      COMMANDS.UNMUTE,
      ...Object.values(COMMANDS.BLACKLIST)
    ];

    return (
      text.startsWith('/') &&
      COMMAND_LIST.some(cmd => text === cmd || text.startsWith(`${cmd} `))
    );
  }

  // 安全的指令处理器获取
  getCommandHandler(text) {
    const commandMap = {
      [COMMANDS.VERIFICATION]: this.handleVerification,
      [COMMANDS.VOTE_MUTE]: this.handleVoteMuteCommand,
      [COMMANDS.UNMUTE]: this.handleUnmuteCommand,
      [COMMANDS.BLACKLIST.CREATE]: this.handleCreateBlacklist,
      [COMMANDS.BLACKLIST.ADD]: this.handleAddToBlacklist,
      [COMMANDS.BLACKLIST.REMOVE]: this.handleRemoveFromBlacklist,
      [COMMANDS.BLACKLIST.RENAME]: this.handleRenameBlacklist,
      [COMMANDS.BLACKLIST.DELETE]: this.handleDeleteBlacklist
    };

    const baseCmd = text.split(/\s+/)[0];
    return commandMap[baseCmd]?.bind(this);
  }

  /* ==================== 帮助 ==================== */
  // 处理帮助指令
  async handleHelpInstruction(event) {
    const helpMessage = `📚 可用指令帮助：

【群指令】
• /投票禁言 <用户ID> - 发起禁言投票
• /解除禁言 <用户ID> - (管理员专用)解除禁言

【私聊指令】
• /创建黑名单 <名称> - 创建公开黑名单
• /添加用户 <名单> <ID> - 添加用户到黑名单
• /移除用户 <名单> <ID> - 从黑名单移除用户
• /删除黑名单 <名称> - 删除公开黑名单`;

    await this.openApi.sendMessage(
      event.chat.chatType === 'group' ? event.chat.chatId : event.sender.senderId,
      event.chat.chatType,
      'text',
      helpMessage
    );
  }

  /* ==================== 黑名单管理系统 ==================== */
  async handleBlacklistCommands(event) {
    const { content } = event.message;
    if (!content?.text) return;

    const text = content.text.trim();
    
    if (text.startsWith(COMMANDS.BLACKLIST.CREATE)) {
      await this.handleCreateBlacklist(event);
    } else if (text.startsWith(COMMANDS.BLACKLIST.ADD)) {
      await this.handleAddToBlacklist(event);
    } else if (text.startsWith(COMMANDS.BLACKLIST.REMOVE)) {
      await this.handleRemoveFromBlacklist(event);
    } else if (text.startsWith(COMMANDS.BLACKLIST.RENAME)) {
      await this.handleRenameBlacklist(event);
    } else if (text.startsWith(COMMANDS.BLACKLIST.DELETE)) {
      await this.handleDeleteBlacklist(event);
    }
  }

  async handleCreateBlacklist(event) {
    const { sender, message } = event;
    const name = message.content.text.split(/\s+/)[1];
    const filePath = getBlacklistPath(name);

    if (!name) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 格式错误\n正确格式: ${COMMANDS.BLACKLIST.CREATE} <黑名单名称>`
      );
      return;
    }

    if (fs.existsSync(filePath)) {
      await this.openApi.sendMessage(
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

    fs.writeFileSync(filePath, JSON.stringify(blacklist, null, 2));
    await this.openApi.sendMessage(
      sender.senderId,
      'user',
      'text',
      `✅ 已创建黑名单 "${name}"\n` +
      `使用 ${COMMANDS.BLACKLIST.ADD} ${name} <用户ID> 添加用户`
    );
  }

  async handleAddToBlacklist(event) {
    const { sender, message } = event;
    const parts = message.content.text.trim().split(/\s+/);
    
    if (parts.length < 3) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 格式错误\n正确格式: ${COMMANDS.BLACKLIST.ADD} <黑名单名称> <用户ID>`
      );
      return;
    }

    const name = parts[1];
    const userId = parts[2];
    const blacklist = this.loadBlacklist(name);

    if (!blacklist.creator) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 黑名单 "${name}" 不存在`
      );
      return;
    }

    if (blacklist.creator !== sender.senderId) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 只有创建者可以管理黑名单 "${name}"`
      );
      return;
    }

    if (blacklist.users.includes(userId)) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `ℹ️ 用户 ${userId} 已在黑名单中`
      );
      return;
    }

    blacklist.users.push(userId);
    blacklist.updatedAt = new Date().toISOString();
    this.saveBlacklist(name, blacklist);

    await this.openApi.sendMessage(
      sender.senderId,
      'user',
      'text',
      `✅ 已将用户 ${userId} 添加到黑名单 "${name}"`
    );
  }

  async handleRemoveFromBlacklist(event) {
    const { sender, message } = event;
    const parts = message.content.text.trim().split(/\s+/);

    if (parts.length < 3) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 格式错误\n正确格式: ${COMMANDS.BLACKLIST.REMOVE} <黑名单名称> <用户ID>`
      );
      return;
    }

    const name = parts[1];
    const userId = parts[2];
    const blacklist = this.loadBlacklist(name);

    if (!blacklist.creator) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 黑名单 "${name}" 不存在`
      );
      return;
    }

    if (blacklist.creator !== sender.senderId) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 只有创建者可以管理黑名单 "${name}"`
      );
      return;
    }

    if (!blacklist.users.includes(userId)) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `ℹ️ 用户 ${userId} 不在黑名单中`
      );
      return;
    }

    blacklist.users = blacklist.users.filter(id => id !== userId);
    blacklist.updatedAt = new Date().toISOString();
    this.saveBlacklist(name, blacklist);

    await this.openApi.sendMessage(
      sender.senderId,
      'user',
      'text',
      `✅ 已从黑名单 "${name}" 移除用户 ${userId}`
    );
  }

  async handleRenameBlacklist(event) {
    const { sender, message } = event;
    const parts = message.content.text.trim().split(/\s+/);

    if (parts.length < 3) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 格式错误\n正确格式: ${COMMANDS.BLACKLIST.RENAME} <旧名称> <新名称>`
      );
      return;
    }

    const oldName = parts[1];
    const newName = parts.slice(2).join(' ');
    const blacklist = this.loadBlacklist(oldName);

    if (!blacklist.creator) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 黑名单 "${oldName}" 不存在`
      );
      return;
    }

    if (blacklist.creator !== sender.senderId) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 只有创建者可以重命名黑名单 "${oldName}"`
      );
      return;
    }

    if (fs.existsSync(getBlacklistPath(newName))) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 黑名单 "${newName}" 已存在`
      );
      return;
    }

    try {
      fs.renameSync(
        getBlacklistPath(oldName),
        getBlacklistPath(newName)
      );
      
      blacklist.name = newName;
      blacklist.updatedAt = new Date().toISOString();
      this.saveBlacklist(newName, blacklist);

      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `✅ 已重命名黑名单 "${oldName}" → "${newName}"`
      );
    } catch (error) {
      console.error(`重命名黑名单失败:`, error);
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        '❌ 重命名失败，请稍后再试'
      );
    }
  }

  async handleDeleteBlacklist(event) {
    const { sender, message } = event;
    const parts = message.content.text.trim().split(/\s+/);

    if (parts.length < 2) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 格式错误\n正确格式: ${COMMANDS.BLACKLIST.DELETE} <黑名单名称>`
      );
      return;
    }

    const name = parts[1];
    const blacklist = this.loadBlacklist(name);

    if (!blacklist.creator) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 黑名单 "${name}" 不存在`
      );
      return;
    }

    if (blacklist.creator !== sender.senderId) {
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `❌ 只有创建者可以删除黑名单 "${name}"`
      );
      return;
    }

    try {
      fs.unlinkSync(getBlacklistPath(name));
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        `✅ 已永久删除黑名单 "${name}"`
      );
    } catch (error) {
      console.error(`删除黑名单失败:`, error);
      await this.openApi.sendMessage(
        sender.senderId,
        'user',
        'text',
        '❌ 删除失败，请稍后再试'
      );
    }
  }

  async checkAndHandleBlockedMessage(event) {
    const { sender, chat, message } = event;
    const { chatId: groupId, chatType } = chat;
    const { msgId, content } = message;
    const senderId = sender.senderId;

    // 加载群配置
    const config = this.getCachedGroupConfig(groupId);

    // 检查订阅的黑名单
    if (config.blacklistSubscription?.enabled) {
      for (const blacklistName of config.blacklistSubscription.list) {
        const blacklist = this.loadBlacklist(blacklistName);
        if (blacklist.users.includes(senderId)) {
          console.log(`拦截来自订阅黑名单 ${blacklistName} 的用户 ${senderId}`);
          await this.openApi.recallMessage(msgId, groupId, chatType);
          await this.openApi.sendMessage(
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
      const recallResult = await this.openApi.recallMessage(msgId, groupId, chatType);
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
  const publicBlacklist = this.loadPublicBlacklist();
  if (publicBlacklist.includes(senderId)) {
    console.log(`🚫 拦截公共黑名单用户 ${senderId} 的消息`);
    const recallResult = await this.openApi.recallMessage(msgId, groupId, chatType);
    await this.openApi.sendMessage(
      groupId,
      'group',
      'text',
      `检测到公共黑名单用户 ${senderId} 的消息，已自动撤回`
    );
    return true;
  }
}

    if (config.useGroupBlacklist) {
    effectiveBlacklist = effectiveBlacklist.concat(config.blacklist);
  }

    
    // 去重
    effectiveBlacklist = [...new Set(effectiveBlacklist)];
    
    // 检查用户是否在黑名单中
    if (effectiveBlacklist.includes(senderId)) {
      console.log(`🚫 拦截黑名单用户 ${senderId} 的消息`);
      
      // 尝试撤回消息
      const recallResult = await this.openApi.recallMessage(msgId, groupId, chatType);
      if (recallResult.code !== 1) {
        console.error('撤回消息失败:', recallResult);
      }
      
      // 发送通知消息
      await this.openApi.sendMessage(
        groupId,
        'group',
        'text',
        `检测到黑名单用户 ${senderId} 的消息，已自动撤回`
      );
      
      return true;
    }

    // 检查屏蔽词
    if (!config.blockedWords.disabled && messageText) {
      const effectiveBlockedWords = this.loadBlockedWords().filter(
        word => !config.blockedWords.disabledWords.includes(word)
      );

      const foundWord = effectiveBlockedWords.find(word => 
        messageText.includes(word)
      );

      if (foundWord) {
        console.log(`🚫 拦截包含屏蔽词 "${foundWord}" 的消息`);
        const recallResult = await this.openApi.recallMessage(msgId, groupId, chatType);
        await this.openApi.sendMessage(
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

  /* ==================== 黑名单工具方法 ==================== */
  loadBlacklist(name) {
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

  saveBlacklist(name, data) {
    try {
      const filePath = getBlacklistPath(name);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error(`保存黑名单 ${name} 失败:`, error);
      return false;
    }
  }

  listPublicBlacklists() {
    try {
      return fs.readdirSync(CONFIG.PATHS.publicBlacklists)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch (error) {
      console.error('列出公共黑名单失败:', error);
      return [];
    }
  }

  /* ==================== 投票禁言系统 ==================== */
  async handleVoteMuteCommand(event) {
    const { sender, chat, message } = event;
    if (chat.chatType !== 'group') return;

    const parts = message.content.text.trim().split(/\s+/);
    if (parts.length < 2) {
      await this.openApi.sendMessage(
        chat.chatId,
        'group',
        'text',
        `❌ 格式错误\n正确格式: ${COMMANDS.VOTE_MUTE} <用户ID>`
      );
      return;
    }

    const config = this.getCachedGroupConfig(chat.chatId);
    if (!config.voteMute.enabled) {
      await this.openApi.sendMessage(chat.chatId, 'group', 'text', '❌ 本群未开启投票禁言功能');
      return;
    }

    // 检查发送者是否有投票权
    if (!config.voteMute.admins.includes(sender.senderId)) {
      await this.openApi.sendMessage(
        chat.chatId,
        'group',
        'text',
        '❌ 您没有投票禁言的权限'
      );
      return;
    }

    const targetUserId = parts[1];
    
    // 不能禁言自己
    if (targetUserId === sender.senderId) {
      await this.openApi.sendMessage(
        chat.chatId,
        'group',
        'text',
        '❌ 不能对自己发起禁言投票'
      );
      return;
    }

    // 检查目标用户是否已被禁言
    if (config.voteMute.mutedUsers.includes(targetUserId)) {
      await this.openApi.sendMessage(
        chat.chatId,
        'group',
        'text',
        `❌ 用户 ${targetUserId} 已被禁言`
      );
      return;
    }

    // 获取或初始化投票
    let vote = this.state.activeVotes.get(chat.chatId);
    if (!vote || vote.targetUserId !== targetUserId) {
      vote = {
        targetUserId,
        votes: new Set([sender.senderId]), // 发起人自动投票
        timestamp: Date.now()
      };
      this.state.activeVotes.set(chat.chatId, vote);
    } else {
      // 检查是否已投票
      if (vote.votes.has(sender.senderId)) {
        await this.openApi.sendMessage(
          chat.chatId,
          'group',
          'text',
          '❌ 您已经投过票了'
        );
        return;
      }
      vote.votes.add(sender.senderId);
    }

    // 计算投票结果
    const adminCount = config.voteMute.admins.length;
    const currentVotes = vote.votes.size;
    const requiredVotes = Math.ceil(adminCount * (config.voteMute.threshold / 100)); // 使用自定义百分比
    
    await this.openApi.sendMessage(
      chat.chatId,
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
      this.saveGroupConfig(chat.chatId, config);

      // 通知群组
      await this.openApi.sendMessage(
        chat.chatId,
        'group',
        'text',
        `⚠️ 投票通过\n` +
        `用户 ${targetUserId} 已被禁言\n` +
        `将自动撤回其发送的消息`
      );

      // 清除投票
      this.state.activeVotes.delete(chat.chatId);
    }
  }

   async handleUnmuteCommand(event) {
    const { sender, chat, message } = event;
    if (chat.chatType !== 'group') return;

    const parts = message.content.text.trim().split(/\s+/);
    if (parts.length < 2) {
      await this.openApi.sendMessage(
        chat.chatId,
        'group',
        'text',
        `❌ 格式错误\n正确格式: ${COMMANDS.UNMUTE} <用户ID>`
      );
      return;
    }

    const config = this.getCachedGroupConfig(chat.chatId);
    const userId = parts[1];

    // 检查是否是管理员或群主
    if (sender.senderUserLevel !== 'administrator' && sender.senderUserLevel !== 'owner') {
      await this.openApi.sendMessage(
        chat.chatId,
        'group',
        'text',
        '❌ 只有管理员或群主可以解除禁言'
      );
      return;
    }

    // 解除禁言逻辑
    const success = await this.openApi.unmuteUser(chat.chatId, userId);
    if (success) {
      await this.openApi.sendMessage(
        chat.chatId,
        'group',
        'text',
        `✅ 已解除用户 ${userId} 的禁言`
      );
    } else {
      await this.openApi.sendMessage(
        chat.chatId,
        'group',
        'text',
        `❌ 解除禁言失败，请检查用户 ${userId} 是否被禁言`
      );
    }
  }

  /* ==================== 消息互通验证 ==================== */
  async handleVerification(event) {
    const { sender, chat, message } = event;
    const { chatId: groupId, chatType } = chat;
    const { content } = message;

    // 只在群聊中处理
    if (chatType !== 'group') return;
    if (content?.text?.trim() !== COMMANDS.VERIFICATION) return;
    
    // 检查是否有待处理的验证请求
    const verification = this.state.pendingVerifications.get(groupId);
    if (!verification) return;

    // 检查发送者权限
    if (!['owner', 'administrator'].includes(sender.senderUserLevel)) {
      await this.openApi.sendMessage(
        groupId,
        'group',
        'text',
        `❌ 权限不足\n只有群主或管理员可以确认消息互通绑定`
      );
      return;
    }

    // 验证通过
    verification.verified = true;
    this.state.pendingVerifications.set(groupId, verification);
    
    // 通知双方群组
    await this.openApi.sendMessage(
      groupId,
      'group',
      'text',
      `✅ 消息互通绑定已确认\n本群与群 ${verification.sourceGroupId} 的消息互通功能已启用`
    );
    
    await this.openApi.sendMessage(
      verification.sourceGroupId,
      'group',
      'text',
      `✅ 消息互通绑定已确认\n群 ${groupId} 已确认与您的群建立消息互通关系`
    );
    
    console.log(`群 ${groupId} 和群 ${verification.sourceGroupId} 的互通绑定已确认`);

    // 更新群配置
    const sourceConfig = this.getCachedGroupConfig(verification.sourceGroupId);
    if (!sourceConfig.crossGroupMessaging.linkedGroups.includes(groupId)) {
      sourceConfig.crossGroupMessaging.linkedGroups.push(groupId);
      this.saveGroupConfig(verification.sourceGroupId, sourceConfig);
    }

    const targetConfig = this.getCachedGroupConfig(groupId);
    if (!targetConfig.crossGroupMessaging.linkedGroups.includes(verification.sourceGroupId)) {
      targetConfig.crossGroupMessaging.linkedGroups.push(verification.sourceGroupId);
      this.saveGroupConfig(groupId, targetConfig);
    }
  }

  /* ==================== 定时任务恢复 ==================== */
restoreScheduledTasks() {
  try {
    const groupsDir = CONFIG.PATHS.groupConfigs;
    if (!fs.existsSync(groupsDir)) {
      fs.mkdirSync(groupsDir, { recursive: true });
      return 0;
    }

    let restoredCount = 0;
    const files = fs.readdirSync(groupsDir).filter(f => f.endsWith('.json'));

    files.forEach(file => {
      try {
        const groupId = file.replace('.json', '');
        const config = this.getCachedGroupConfig(groupId);
        const scheduledConfig = config.scheduledMessage || {};
        
        // 调试日志
        console.log(`检查群 ${groupId} 定时任务配置:`, JSON.stringify({
          enabled: scheduledConfig.enabled,
          interval: scheduledConfig.interval,
          hasContent: !!scheduledConfig.content
        }));

        // 只有明确启用的任务才恢复
        if (scheduledConfig.enabled === true && 
            scheduledConfig.interval > 0 && 
            scheduledConfig.content) {
            
          // 初始化状态对象
          const taskState = {
            interval: scheduledConfig.interval,
            content: scheduledConfig.content,
            lastSent: null,
            timer: null
          };
          
          // 设置定时器
          taskState.timer = setInterval(async () => {
            await this.sendScheduledMessage(groupId, taskState.content);
          }, taskState.interval * 60 * 1000);

          this.state.scheduledMessages.set(groupId, taskState);
          restoredCount++;
          console.log(`↻ 恢复群 ${groupId} 的定时任务 (间隔: ${taskState.interval}分钟)`);
        } else {
          // 强制清理无效配置
          if (scheduledConfig.enabled !== false) {
            config.scheduledMessage = { 
              enabled: false, 
              interval: 0, 
              content: '' 
            };
            this.saveGroupConfig(groupId, config);
            console.log(`🛠 修复群 ${groupId} 的定时任务配置 (强制禁用)`);
          }
          this.clearScheduledTask(groupId);
        }
      } catch (error) {
        console.error(`恢复群 ${file} 定时任务失败:`, error);
      }
    });

    console.log(`✅ 已恢复 ${restoredCount} 个有效定时任务`);
    return restoredCount;
  } catch (error) {
    console.error('恢复定时任务失败:', error);
    return 0;
  }
}

  /* ==================== 定时任务设置 ==================== */
  async setupScheduledTask(groupId, intervalMinutes, content) {
  if (!groupId || intervalMinutes <= 0 || !content?.trim()) {
    // 参数无效时清除任务
    this.clearScheduledTask(groupId);
    return;
  }

  // 清除现有任务
  this.clearScheduledTask(groupId);

  // 初始化状态对象
  const taskState = {
    interval: intervalMinutes,
    content: content.trim(),
    lastSent: null,
    timer: null
  };
  
  this.state.scheduledMessages.set(groupId, taskState);

  // 设置定时器
  taskState.timer = setInterval(async () => {
    await this.sendScheduledMessage(groupId, content);
  }, intervalMinutes * 60 * 1000);

  // 更新群配置
  const config = this.getCachedGroupConfig(groupId);
  config.scheduledMessage = {
    enabled: true,
    interval: intervalMinutes,
    content: content.trim()
  };
  this.saveGroupConfig(groupId, config);

  console.log(`⏱ 群 ${groupId} 定时消息已设置 (间隔: ${intervalMinutes}分钟)`);
  
  // 立即发送一次
  try {
    await this.sendScheduledMessage(groupId, content);
  } catch (error) {
    console.error(`群 ${groupId} 初始定时消息发送失败:`, error);
  }
}

  /* ==================== 发送定时消息 ==================== */
  async sendScheduledMessage(groupId, content) {
  try {
    const messages = content.split('\n').filter(line => line.trim());
    
    for (const msg of messages) {
      const result = await this.openApi.sendMessage(
        groupId,
        'group',
        'text',
        msg.trim()
      );
      
      if (result.success) {
        console.log(`[定时消息] 成功发送到群 ${groupId}: ${msg.trim()}`);
        // 安全更新 lastSent
        const task = this.state.scheduledMessages.get(groupId);
        if (task) {
          task.lastSent = new Date();
        }
      } else {
        console.error(`[定时消息] 发送失败到群 ${groupId}:`, result.msg);
        
        if (result.code === 1002) {
          console.log('尝试使用替代格式发送...');
          const retryResult = await this.openApi.sendMessage(
            groupId,
            'group',
            'text',
            msg.trim(),
            null,
            []
          );
          
          if (retryResult.success) {
            console.log(`[重试成功] 群 ${groupId}: ${msg.trim()}`);
            const task = this.state.scheduledMessages.get(groupId);
            if (task) {
              task.lastSent = new Date();
            }
          } else {
            console.error(`[重试失败] 群 ${groupId}:`, retryResult.msg);
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error(`发送定时消息到群 ${groupId} 失败:`, error);
  }
}

  /* ==================== 清除定时任务 ==================== */
  clearScheduledTask(groupId) {
  if (!groupId) return;

  const task = this.state.scheduledMessages.get(groupId);
  if (task) {
    // 清除定时器
    if (task.timer) {
      clearInterval(task.timer);
      console.log(`⏹ 已停止群 ${groupId} 的定时消息任务`);
    }
    
    // 从状态中移除
    this.state.scheduledMessages.delete(groupId);
  }

  // 确保配置同步（可选）
  const config = this.getCachedGroupConfig(groupId);
  if (config.scheduledMessage?.enabled) {
    config.scheduledMessage.enabled = false;
    this.saveGroupConfig(groupId, config);
    console.log(`🛠 同步更新群 ${groupId} 定时任务配置为禁用状态`);
  }
}

  clearAllTimers() {
    // 清理消息定时器
    this.state.scheduledMessages.forEach((task, groupId) => {
      clearInterval(task.timer);
      console.log(`⏹ 停止群 ${groupId} 的定时消息`);
    });
    this.state.scheduledMessages.clear();

    // 清理系统定时器
    this.timers.forEach((timer, name) => {
      clearInterval(timer);
      console.log(`⏹ 停止系统定时器: ${name}`);
    });
    this.timers.clear();
  }

  /* ==================== 定时器管理系统 ==================== */
  setupTimers() {
    try {

      // 2. 投票过期检查定时器 (每小时检查)
      this.addTimer('voteExpire', 60 * 60 * 1000, () => {
        const now = Date.now();
        this.state.activeVotes.forEach((vote, groupId) => {
          if (now - vote.timestamp > CONFIG.TIMEOUTS.vote) {
            this.state.activeVotes.delete(groupId);
            console.log(`群 ${groupId} 的投票已过期`);
          }
        });
      });

      // 3. 投稿超时检查定时器 (每分钟检查)
      this.addTimer('submissionCheck', 60 * 1000, () => {
        const now = Date.now();
        this.state.pendingSubmissions.forEach((sub, userId) => {
          if (now - sub.timestamp > CONFIG.TIMEOUTS.submission) {
            this.state.pendingSubmissions.delete(userId);
          }
        });
      });

      // 4. 验证请求过期检查 (每分钟检查)
      this.addTimer('verificationCheck', 60 * 1000, () => {
        const now = Date.now();
        this.state.pendingVerifications.forEach((verification, groupId) => {
          if (now - verification.timestamp > CONFIG.TIMEOUTS.verification) {
            this.state.pendingVerifications.delete(groupId);
            console.log(`群 ${groupId} 的验证请求已超时`);
          }
        });
      });

      console.log('✅ 定时任务系统已初始化');
    } catch (error) {
      console.error('初始化定时任务失败:', error);
      throw error;
    }
  }

  addTimer(name, interval, callback) {
    // 先清除已有的同名定时器
    this.clearTimer(name);
    
    const timer = setInterval(() => {
      try {
        callback();
      } catch (err) {
        console.error(`定时任务 ${name} 执行出错:`, err);
      }
    }, interval);
    
    this.timers.set(name, timer);
  }

  clearTimer(name) {
    if (this.timers.has(name)) {
      clearInterval(this.timers.get(name));
      this.timers.delete(name);
    }
  }

  clearAllTimers() {
    this.timers.forEach((timer, name) => {
      clearInterval(timer);
      console.log(`已停止定时器: ${name}`);
    });
    this.timers.clear();
  }

  /* ==================== 事件处理器设置 ==================== */
  setupEventHandlers() {
    // 普通消息事件
    this.subscription.onMessageNormal(async (event) => {
      try {
        if (event.chat.chatType === 'group') {
          this.initNewGroup(event.chat.chatId);
        }

        // 检查并处理被拦截的消息
        const blocked = await this.checkAndHandleBlockedMessage(event);
        if (blocked) return;

        // 处理验证命令
        await this.handleVerification(event);

        // 处理其他命令
        if (event.message.content?.text) {
          const text = event.message.content.text.trim();
          
          // 处理黑名单相关命令
          await this.handleBlacklistCommands(event);
        }
      } catch (error) {
        console.error('处理普通消息时出错:', error);
      }
    });

    // 指令消息事件
    this.subscription.onMessageInstruction(async (event) => {
      try {
        switch(event.message.instructionId) {
          case INSTRUCTION_IDS.HELP:
            await this.handleHelpInstruction(event);
            break;
          case INSTRUCTION_IDS.WISDOM:
            await this.handleWisdomCommand(event);
            break;
          case INSTRUCTION_IDS.SUBMIT_WISDOM:
            await this.handleSubmitWisdomCommand(event);
            break;
          default:
            console.log('未知指令:', event.message.instructionId);
        }
      } catch (error) {
        console.error('处理指令消息时出错:', error);
      }
    });

    // 群成员加入事件
    this.subscription.onGroupJoin(async (event) => {
      try {
        const config = this.getCachedGroupConfig(event.chat.chatId);
        if (config.groupMessages?.welcome?.content) {
          const message = this.replaceMessageVariables(
            config.groupMessages.welcome.content,
            event
          );
          await this.openApi.sendMessage(
            event.chat.chatId,
            'group',
            config.groupMessages.welcome.type || 'text',
            message
          );
        }
      } catch (error) {
        console.error('处理入群事件时出错:', error);
      }
    });

    // 群成员离开事件
    this.subscription.onGroupLeave(async (event) => {
      try {
        const config = this.getCachedGroupConfig(event.chat.chatId);
        if (config.groupMessages?.goodbye?.content) {
          const message = this.replaceMessageVariables(
            config.groupMessages.goodbye.content,
            event
          );
          await this.openApi.sendMessage(
            event.chat.chatId,
            'group',
            config.groupMessages.goodbye.type || 'text',
            message
          );
        }
      } catch (error) {
        console.error('处理退群事件时出错:', error);
      }
    });

    // 机器人设置事件
    this.subscription.onBotSetting(async (event) => {
      try {
        const { groupId, settingJson } = event;
        const settings = JSON.parse(settingJson);
        const config = this.getCachedGroupConfig(groupId);
        
        // 处理定时消息设置
        const isScheduledEnabled = settings[FORM_IDS.SCHEDULED_SWITCH]?.value === true;
        const interval = parseInt(settings[FORM_IDS.SCHEDULED_INTERVAL]?.value) || 0;
        const content = settings[FORM_IDS.SCHEDULED_CONTENT]?.value || '';

        console.log('定时任务设置变更:', { 
  groupId, 
  enabled: isScheduledEnabled,
  interval,
  contentLength: content.length 
});
        // 获取当前配置（避免内存缓存问题）
// const config = JSON.parse(JSON.stringify(this.loadGroupConfig(groupId)));

        
        // 调试日志
console.log('收到定时任务设置:', { 
  isScheduledEnabled, 
  interval, 
  content: content ? '已设置' : '未设置' 
});

if (isScheduledEnabled && interval > 0 && content) {
  await this.setupScheduledTask(groupId, interval, content);
} else {
  // 完全清除定时任务
  this.clearScheduledTask(groupId);
  
  // 强制更新配置状态
  config.scheduledMessage = {
    enabled: false,
    interval: 0,
    content: ''
  };
  
  // 等待配置保存完成
  await this.saveGroupConfig(groupId, config);
  
  // 二次验证
  const savedConfig = this.loadGroupConfig(groupId);
  if (savedConfig.scheduledMessage.enabled) {
    console.error('配置状态同步失败，强制禁用定时任务');
    config.scheduledMessage.enabled = false;
    await this.saveGroupConfig(groupId, config);
  }
}
        
        // 处理公共黑名单开关
        config.usePublicBlacklist = settings[FORM_IDS.PUBLIC_BLACKLIST_SWITCH]?.value !== false;
        
        // 处理独立黑名单
        config.useGroupBlacklist = settings[FORM_IDS.GROUP_BLACKLIST_INPUT]?.value?.trim() !== '';
        if (settings[FORM_IDS.GROUP_BLACKLIST_INPUT]?.value) {
          config.blacklist = settings[FORM_IDS.GROUP_BLACKLIST_INPUT].value
            .split(/[,;\n]/)
            .map(id => id.trim())
            .filter(id => id);
        }
        
        // 处理绑定群组
        if (settings[FORM_IDS.BOUND_GROUPS_INPUT]?.value) {
          config.boundGroups = settings[FORM_IDS.BOUND_GROUPS_INPUT].value
            .split(/[,;\n]/)
            .map(id => id.trim())
            .filter(id => id && id !== groupId); // 排除自身群组
        }
        
        // 处理屏蔽词设置
        config.blockedWords.disabled = settings[FORM_IDS.WORD_FILTER_SWITCH]?.value === false;
        if (settings[FORM_IDS.DISABLED_WORDS_INPUT]?.value) {
          config.blockedWords.disabledWords = settings[FORM_IDS.DISABLED_WORDS_INPUT].value
            .split(/[,;\n]/)
            .map(word => word.trim())
            .filter(word => word);
        }
        
        // 处理多群互通设置
        config.crossGroupMessaging.enabled = settings[FORM_IDS.CROSS_GROUP_SWITCH]?.value === true;
        if (settings[FORM_IDS.CROSS_GROUP_IDS]?.value) {
          const newLinkedGroups = settings[FORM_IDS.CROSS_GROUP_IDS].value
            .split(/[,;\n]/)
            .map(id => id.trim())
            .filter(id => id && id !== groupId); // 排除自身群组
            
          // 找出新增的群组ID
          const addedGroups = newLinkedGroups.filter(id => 
            !config.crossGroupMessaging.linkedGroups.includes(id)
          );
          
          // 向新增群组发送验证请求
          for (const targetGroupId of addedGroups) {
            try {
              // 发送验证请求
              const result = await this.openApi.sendMessage(
                targetGroupId,
                'group',
                'text',
                `[群消息互通请求]\n` +
                `群 ${groupId} 请求与本群建立消息互通关系。\n` +
                `请群主或管理员回复"${COMMANDS.VERIFICATION}"以确认绑定。\n` +
                `(此绑定需双方群都开启互通功能才能生效)`
              );
              
              if (result.success) {
                // 保存待验证记录
                this.state.pendingVerifications.set(targetGroupId, {
                  sourceGroupId: groupId,
                  timestamp: Date.now(),
                  verified: false
                });
                
                console.log(`已向群 ${targetGroupId} 发送验证请求`);
              }
            } catch (error) {
              console.error(`向群 ${targetGroupId} 发送验证请求失败:`, error);
            }
          }
          
          config.crossGroupMessaging.linkedGroups = newLinkedGroups;
        }
        
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
          admins: settings[FORM_IDS.VOTE_ADMINS_INPUT]?.value
            ? settings[FORM_IDS.VOTE_ADMINS_INPUT].value
              .split(/[,;\n]/)
              .map(id => id.trim())
              .filter(id => id)
            : [],
          mutedUsers: config.voteMute?.mutedUsers || [], // 保留原有的禁言用户
          threshold: Math.min(100, Math.max(1, 
            parseInt(settings[FORM_IDS.VOTE_THRESHOLD_INPUT]?.value) || 50))
        };
        
        // 处理订阅的黑名单
        config.blacklistSubscription = {
          enabled: Boolean(settings[FORM_IDS.BLACKLIST_MANAGE_SWITCH]?.value),
          list: settings[FORM_IDS.BLACKLIST_SUBSCRIPTION_INPUT]?.value
            ? settings[FORM_IDS.BLACKLIST_SUBSCRIPTION_INPUT].value
              .split(',')
              .map(name => name.trim())
              .filter(name => name)
            : []
        };
        
        // 保存配置
        this.saveGroupConfig(groupId, config);
        
        console.log(`群 ${groupId} 配置已更新`, {
          newspaperPush: config.newspaperPush.enabled,
          welcomeMsg: config.groupMessages.welcome.content ? '已设置' : '未设置',
          goodbyeMsg: config.groupMessages.goodbye.content ? '已设置' : '未设置'
        });
      } catch (error) {
        console.error('处理设置事件时出错:', error);
      }
    });

    console.log('✅ 事件处理器已设置');
  }
}

// ==================== Express应用设置 ====================
class BotApp {
  constructor() {
    this.app = express();
    this.botService = new BotService();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupProcessHandlers();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupRoutes() {
    // 订阅地址
    this.app.post('/sub', (req, res) => {
      this.botService.subscription.listen(req.body);
      res.status(200).json({ code: 0, msg: 'success' });
    });

    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        activeVotes: this.botService.state.activeVotes.size,
        scheduledTasks: this.botService.state.scheduledMessages.size
      });
    });

    // 静态文件服务
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Vio',
        version: '1.0.0',
        status: 'running',
        port: CONFIG.PORT,
        features: [
          '黑名单管理',
          '投票禁言',
          '跨群消息',
          '定时消息',
          '屏蔽词过滤'
        ]
      });
    });

    // 获取群组配置
    this.app.get('/api/group/:groupId/config', (req, res) => {
      try {
        const groupId = req.params.groupId;
        const config = this.botService.getCachedGroupConfig(groupId);
        res.json({ code: 0, data: config });
      } catch (error) {
        res.status(500).json({ code: -1, msg: error.message });
      }
    });

    // 获取活跃投票信息
    this.app.get('/api/votes', (req, res) => {
      const votes = Array.from(this.botService.state.activeVotes.entries()).map(([groupId, vote]) => ({
        groupId,
        targetUserId: vote.targetUserId,
        timestamp: vote.timestamp,
        voters: vote.voters.length,
        threshold: vote.threshold
      }));
      res.json({ code: 0, data: votes });
    });

    // 获取定时任务信息
    this.app.get('/api/scheduled', (req, res) => {
      const tasks = Array.from(this.botService.state.scheduledMessages.entries()).map(([groupId, task]) => ({
        groupId,
        interval: task.interval,
        content: task.content.substring(0, 50) + '...',
        lastSent: task.lastSent
      }));
      res.json({ code: 0, data: tasks });
    });

    // 获取黑名单列表
    this.app.get('/api/blacklists', (req, res) => {
      try {
        const blacklists = fs.readdirSync(CONFIG.PATHS.publicBlacklists)
          .filter(f => f.endsWith('.json'))
          .map(f => f.replace('.json', ''));
        res.json({ code: 0, data: blacklists });
      } catch (error) {
        res.status(500).json({ code: -1, msg: error.message });
      }
    });

    // 获取黑名单详情
    this.app.get('/api/blacklists/:name', (req, res) => {
      try {
        const name = req.params.name;
        const blacklist = this.botService.loadBlacklist(name);
        res.json({ code: 0, data: blacklist });
      } catch (error) {
        res.status(500).json({ code: -1, msg: error.message });
      }
    });

    // 错误处理中间件
    this.app.use((err, req, res, next) => {
      console.error('Express错误:', err);
      res.status(500).json({ 
        code: -1, 
        msg: '服务器内部错误',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    });

    // 404处理
    this.app.use((req, res) => {
      res.status(404).json({
        code: -1,
        msg: '接口不存在',
        path: req.path
      });
    });
  }

  // ============== 进程处理 ==============
  setupProcessHandlers() {
    process.on('SIGTERM', this.shutdown.bind(this));
    process.on('SIGINT', this.shutdown.bind(this));
    
    process.on('uncaughtException', (err) => {
        console.error('未捕获的异常:', err);
        this.shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('未处理的Promise拒绝:', reason);
        console.error('Promise:', promise);
    });
}

async shutdown() {
    console.log('🛑 正在关闭服务...');
    try {
      // 清理所有定时任务
      this.botService.state.scheduledMessages.forEach((task, groupId) => {
        clearInterval(task.timer);
        console.log(`⏹ 已停止群 ${groupId} 的定时消息任务`);
      });

      // 清理所有定时器
      this.botService.timers.forEach((timer, name) => {
        clearInterval(timer);
        console.log(`⏹ 已停止定时器: ${name}`);
      });

      // 保存所有群组配置
      const groups = this.botService.loadGroupsList();
      groups.forEach(groupId => {
        const config = this.botService.getCachedGroupConfig(groupId);
        this.botService.saveGroupConfig(groupId, config);
      });

      process.exit(0);
    } catch (error) {
      console.error('关闭服务时出错:', error);
      process.exit(1);
    }
  }

  start() {
    this.app.listen(CONFIG.PORT, () => {
      console.log(`🚀 机器人服务已启动`);
      console.log(`📡 监听端口: ${CONFIG.PORT}`);
      console.log(`🌐 健康检查: http://localhost:${CONFIG.PORT}/health`);
      console.log(`📋 API文档: http://localhost:${CONFIG.PORT}/`);
      console.log(`📅 启动时间: ${new Date().toLocaleString('zh-CN')}`);
      
      // 显示服务状态
      setTimeout(() => {
        const groups = this.botService.loadGroupsList();
        const scheduledTasks = this.botService.state.scheduledMessages.size;
        console.log(`📊 服务状态: 已配置 ${groups.length} 个群组, ${scheduledTasks} 个定时任务正在运行`);
      }, 1000);
    });
  }
}

const botApp = new BotApp();
botApp.start();