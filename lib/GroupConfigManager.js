const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../groupConfigs.json');

class GroupConfigManager {
    constructor() {
        this.configs = this.loadConfigs();
    }

    loadConfigs() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const data = fs.readFileSync(CONFIG_FILE, 'utf8');
                return JSON.parse(data);
            }
            return {};
        } catch (error) {
            console.error('Error loading configs:', error);
            return {};
        }
    }

    saveConfigs() {
        try {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.configs, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving configs:', error);
        }
    }

    getConfig(groupId) {
        return this.configs[groupId] || {
            board: '',
            joinMessage: '欢迎用户 {userId} 加入本群！',
            leaveMessage: '用户 {userId} 已离开本群。',
            blacklist: []
        };
    }

    setConfig(groupId, config) {
        this.configs[groupId] = config;
        this.saveConfigs();
    }
}

module.exports = GroupConfigManager;
