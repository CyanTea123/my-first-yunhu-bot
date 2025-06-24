const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../groupConfigs.json');
const USER_GROUP_MAP_FILE = path.join(__dirname, '../userGroupMap.json');

class GroupConfigManager {
    constructor() {
        this.configs = this.loadConfigs();
        this.userGroupMap = this.loadUserGroupMap();
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

    loadUserGroupMap() {
        try {
            if (fs.existsSync(USER_GROUP_MAP_FILE)) {
                const data = fs.readFileSync(USER_GROUP_MAP_FILE, 'utf8');
                return JSON.parse(data);
            }
            return {};
        } catch (error) {
            console.error('Error loading user group map:', error);
            return {};
        }
    }

    saveUserGroupMap() {
        try {
            fs.writeFileSync(USER_GROUP_MAP_FILE, JSON.stringify(this.userGroupMap, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving user group map:', error);
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

    bindGroupToUser(userId, groupId) {
        if (!this.userGroupMap[userId]) {
            this.userGroupMap[userId] = [];
        }
        if (!this.userGroupMap[userId].includes(groupId)) {
            this.userGroupMap[userId].push(groupId);
            this.saveUserGroupMap();
            return true;
        }
        return false;
    }

    getUserGroups(userId) {
        return this.userGroupMap[userId] || [];
    }
}

module.exports = GroupConfigManager;
