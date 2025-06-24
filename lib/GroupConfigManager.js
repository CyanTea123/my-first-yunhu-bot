const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '../groupConfigs');

// 如果配置目录不存在，则创建它
if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR);
}

class GroupConfigManager {
    constructor() {
        // nothing here,maybe later...?
    }

    getConfigFilePath(groupId) {
        return path.join(CONFIG_DIR, `${groupId}.json`);
    }

    loadConfigs(groupId) {
        const configFilePath = this.getConfigFilePath(groupId);
        try {
            if (fs.existsSync(configFilePath)) {
                const data = fs.readFileSync(configFilePath, 'utf8');
                return JSON.parse(data);
            }
            return {
                board: '',
                joinMessage: '欢迎用户 {userId} 加入本群！',
                leaveMessage: '用户 {userId} 已离开本群。',
                blacklist: []
            };
        } catch (error) {
            console.error('Error loading configs:', error);
            return {
                board: '',
                joinMessage: '欢迎用户 {userId} 加入本群！',
                leaveMessage: '用户 {userId} 已离开本群。',
                blacklist: []
            };
        }
    }

    saveConfigs(groupId, config) {
        const configFilePath = this.getConfigFilePath(groupId);
        try {
            fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving configs:', error);
        }
    }

    getConfig(groupId) {
        return this.loadConfigs(groupId);
    }

    setConfig(groupId, config) {
        this.saveConfigs(groupId, config);
    }
}

module.exports = GroupConfigManager;
