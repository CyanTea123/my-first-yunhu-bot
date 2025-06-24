// my-first-yunhu-bot/lib/GroupConfigManager.js
const fs = require('fs');
const path = require('path');

class GroupConfigManager {
    constructor() {
        this.configDir = path.join(__dirname, '../groupConfigs');
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir);
        }
    }

    getConfigFilePath(groupId) {
        return path.join(this.configDir, `${groupId}.json`);
    }

    loadConfigs(groupId) {
        const filePath = this.getConfigFilePath(groupId);
        try {
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
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
        const filePath = this.getConfigFilePath(groupId);
        try {
            fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
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
