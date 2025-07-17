function initLoginPage(groupId) {
    const codeDisplay = document.getElementById('verification-code');
    const generateBtn = document.getElementById('generate-code-btn');
    const checkBtn = document.getElementById('check-verification-btn');
    const statusMessage = document.getElementById('status-message');
    
    // 显示群信息
    document.getElementById('group-info').innerHTML = `<p>群ID: <strong>${groupId}</strong></p>`;
    
}

// 生成验证码
function generateCode() {
    const urlParams = new URLSearchParams(window.location.search);
    const groupId = urlParams.get('groupId');
    const codeDisplay = document.getElementById('verification-code');
    const statusMessage = document.getElementById('status-message');

    if (!groupId) {
        statusMessage.textContent = '错误：缺少群ID参数';
        statusMessage.className = 'status-message error';
        return;
    }

    fetch(`/api/generate-code?groupId=${groupId}`)
        .then(response => {
            if (!response.ok) throw new Error('网络响应不正常');
            return response.json();
        })
        .then(data => {
            if (data.code === 1) {
                codeDisplay.textContent = data.data.code;
                statusMessage.textContent = '验证码已生成，5分钟内有效';
                statusMessage.className = 'status-message success';
            } else {
                statusMessage.textContent = `生成失败: ${data.msg || '未知错误'}`;
                statusMessage.className = 'status-message error';
            }
        })
        .catch(error => {
            statusMessage.textContent = `生成失败: ${error.message}`;
            statusMessage.className = 'status-message error';
            console.error('生成验证码失败:', error);
        });
}

document.addEventListener('DOMContentLoaded', function() {
    const checkBtn = document.getElementById('check-verification-btn');
    const generateBtn = document.getElementById('generate-code-btn');
    
    // 阻止按钮默认行为
    if (checkBtn) {
        checkBtn.addEventListener('click', function(e) {
            e.preventDefault(); // 阻止表单提交
            checkVerification();
        });
    }
    
    if (generateBtn) {
        generateBtn.addEventListener('click', function(e) {
            e.preventDefault();
            generateCode();
        });
    }
});
    
// 检查验证状态
function checkVerification() {
    const urlParams = new URLSearchParams(window.location.search);
    const groupId = urlParams.get('groupId');
    const statusMessage = document.getElementById('status-message');
    
    statusMessage.textContent = '正在验证...';
    statusMessage.className = 'status-message info';
    
    fetch(`/api/check-session?groupId=${groupId}&t=${Date.now()}`)
        .then(response => {
            if (!response.ok) throw new Error('网络响应不正常');
            return response.json();
        })
        .then(data => {
            console.log('验证响应:', data);
            if (data.code === 1) {
                statusMessage.textContent = '验证成功，正在跳转...';
                statusMessage.className = 'status-message success';
                // 使用location.replace避免后退按钮问题
                setTimeout(() => {
                    window.location.replace(`/manage?groupId=${groupId}`);
                }, 1000);
            } else {
                statusMessage.textContent = data.msg || '验证未完成';
                statusMessage.className = 'status-message error';
            }
        })
        .catch(error => {
            console.error('验证失败:', error);
            statusMessage.textContent = `验证失败: ${error.message}`;
            statusMessage.className = 'status-message error';
        });
}

function initManagementPage(groupId) {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const saveWordsBtn = document.getElementById('save-words-btn');
    const saveBlacklistBtn = document.getElementById('save-blacklist-btn');
    
    // 切换标签页
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const target = tab.getAttribute('data-target');
            document.getElementById(target).classList.add('active');
        });
    });
    
    // 加载屏蔽词数据
    function loadBlockedWordsData() {
        fetch(`/api/group-blocked-words?groupId=${groupId}`)
            .then(response => response.json())
            .then(data => {
                const wordsList = document.getElementById('words-list');
                wordsList.innerHTML = '';
                
                data.allBlockedWords.forEach(word => {
                    const isDisabled = data.disabledWords.includes(word);
                    const wordItem = document.createElement('div');
                    wordItem.className = 'word-item';
                    wordItem.innerHTML = `
                        <span>${word}</span>
                        <label>
                            <input type="checkbox" ${isDisabled ? 'checked' : ''} data-word="${word}">
                            禁用
                        </label>
                    `;
                    wordsList.appendChild(wordItem);
                });
                
                document.getElementById('disable-all-checkbox').checked = data.isDisabled;
            });
    }
    
    // 加载黑名单数据
    function loadBlacklistData() {
        fetch(`/api/group-blacklist?groupId=${groupId}`)
            .then(response => response.json())
            .then(data => {
                document.getElementById('use-blacklist-checkbox').checked = data.useGroupBlacklist;
                
                const blacklistContainer = document.getElementById('blacklist-container');
                blacklistContainer.innerHTML = '';
                
                data.blacklist.forEach(user => {
                    const userItem = document.createElement('div');
                    userItem.className = 'blacklist-item';
                    userItem.innerHTML = `
                        <div>
                            <strong>用户ID:</strong> ${user.userId}<br>
                            <strong>原因:</strong> ${user.reason}
                        </div>
                        <button class="remove-user-btn" data-userid="${user.userId}">移除</button>
                    `;
                    blacklistContainer.appendChild(userItem);
                });
                
                // 添加新用户表单
                const addForm = document.createElement('div');
                addForm.className = 'add-blacklist-form';
                addForm.innerHTML = `
                    <h3>添加用户到黑名单</h3>
                    <div class="form-group">
                        <label for="new-user-id">用户ID</label>
                        <input type="text" id="new-user-id" placeholder="输入用户ID">
                    </div>
                    <div class="form-group">
                        <label for="new-user-reason">原因</label>
                        <input type="text" id="new-user-reason" placeholder="输入原因">
                    </div>
                    <button id="add-user-btn">添加用户</button>
                `;
                blacklistContainer.appendChild(addForm);
                
                // 添加事件监听器
                document.querySelectorAll('.remove-user-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const userId = this.getAttribute('data-userid');
                        removeUserFromBlacklist(userId);
                    });
                });
                
                document.getElementById('add-user-btn').addEventListener('click', addUserToBlacklist);
            });
    }
    
    // 保存屏蔽词设置
    function saveBlockedWordsSettings() {
        const disabledWords = [];
        document.querySelectorAll('#words-list input[type="checkbox"]:checked').forEach(checkbox => {
            if (checkbox.id !== 'disable-all-checkbox') {
                disabledWords.push(checkbox.getAttribute('data-word'));
            }
        });
        
        const isDisabled = document.getElementById('disable-all-checkbox').checked;
        
        fetch('/api/update-group-blocked-words', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                groupId,
                disabledWords,
                isDisabled
            })
        })
        .then(response => response.json())
        .then(data => {
            alert('屏蔽词设置已保存');
        })
        .catch(error => {
            alert('保存失败: ' + error.message);
        });
    }
    
    // 保存黑名单设置
    function saveBlacklistSettings() {
        fetch(`/api/group-blacklist?groupId=${groupId}`)
            .then(response => response.json())
            .then(currentData => {
                const useGroupBlacklist = document.getElementById('use-blacklist-checkbox').checked;
                
                fetch('/api/update-group-blacklist', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        groupId,
                        blacklist: currentData.blacklist,
                        useGroupBlacklist
                    })
                })
                .then(response => response.json())
                .then(data => {
                    alert('黑名单设置已保存');
                })
                .catch(error => {
                    alert('保存失败: ' + error.message);
                });
            });
    }
    
    // 从黑名单移除用户
    function removeUserFromBlacklist(userId) {
        fetch(`/api/group-blacklist?groupId=${groupId}`)
            .then(response => response.json())
            .then(data => {
                const newBlacklist = data.blacklist.filter(user => user.userId !== userId);
                
                fetch('/api/update-group-blacklist', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        groupId,
                        blacklist: newBlacklist,
                        useGroupBlacklist: data.useGroupBlacklist
                    })
                })
                .then(response => response.json())
                .then(data => {
                    loadBlacklistData();
                    alert('用户已从黑名单移除');
                })
                .catch(error => {
                    alert('移除失败: ' + error.message);
                });
            });
    }
    
    // 添加用户到黑名单
    function addUserToBlacklist() {
        const userId = document.getElementById('new-user-id').value;
        const reason = document.getElementById('new-user-reason').value;
        
        if (!userId || !reason) {
            alert('请填写用户ID和原因');
            return;
        }
        
        fetch(`/api/group-blacklist?groupId=${groupId}`)
            .then(response => response.json())
            .then(data => {
                const newBlacklist = [...data.blacklist, { userId, reason }];
                
                fetch('/api/update-group-blacklist', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        groupId,
                        blacklist: newBlacklist,
                        useGroupBlacklist: data.useGroupBlacklist
                    })
                })
                .then(response => response.json())
                .then(data => {
                    document.getElementById('new-user-id').value = '';
                    document.getElementById('new-user-reason').value = '';
                    loadBlacklistData();
                    alert('用户已添加到黑名单');
                })
                .catch(error => {
                    alert('添加失败: ' + error.message);
                });
            });
    }
    
    // 初始化页面
    loadBlockedWordsData();
    loadBlacklistData();
    
    // 事件监听
    saveWordsBtn.addEventListener('click', saveBlockedWordsSettings);
    saveBlacklistBtn.addEventListener('click', saveBlacklistSettings);
    
    // 自动切换到第一个标签页
    tabs[0].click();
}