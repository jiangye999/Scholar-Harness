/**
 * 登录界面逻辑
 * 负责处理用户登录、授权码验证、与Electron主进程通信
 */

// DOM元素
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const betaCodeInput = document.getElementById('beta-code');
const validateBetaBtn = document.getElementById('validate-beta-btn');
const betaCodeResult = document.getElementById('beta-code-result');
const loginBtn = document.getElementById('login-btn');
const btnText = loginBtn.querySelector('.btn-text');
const btnLoading = loginBtn.querySelector('.btn-loading');
const errorMessage = document.getElementById('error-message');
const successMessage = document.getElementById('success-message');
const offlineNotice = document.getElementById('offline-notice');
const registerLink = document.getElementById('register-link');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const purchaseLink = document.getElementById('purchase-link');

// 授权码验证状态
let betaCodeValidationResult = null;

// 检查是否在 Electron 环境中
const isElectron = window.electronAPI && window.electronAPI.login;

/**
 * 显示错误消息
 */
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  successMessage.style.display = 'none';
  
  // 5秒后自动隐藏
  setTimeout(() => {
    errorMessage.style.display = 'none';
  }, 5000);
}

/**
 * 隐藏错误消息
 */
function hideError() {
  errorMessage.style.display = 'none';
}

/**
 * 显示成功消息
 */
function showSuccess(message) {
  successMessage.textContent = message;
  successMessage.style.display = 'block';
  errorMessage.style.display = 'none';
}

/**
 * 隐藏成功消息
 */
function hideSuccess() {
  successMessage.style.display = 'none';
}

/**
 * 显示加载状态
 */
function showLoading() {
  btnText.style.display = 'none';
  btnLoading.style.display = 'flex';
  loginBtn.disabled = true;
  emailInput.disabled = true;
  passwordInput.disabled = true;
  betaCodeInput.disabled = true;
  validateBetaBtn.disabled = true;
}

/**
 * 隐藏加载状态
 */
function hideLoading() {
  btnText.style.display = 'inline';
  btnLoading.style.display = 'none';
  loginBtn.disabled = false;
  emailInput.disabled = false;
  passwordInput.disabled = false;
  betaCodeInput.disabled = false;
  validateBetaBtn.disabled = false;
}

/**
 * 显示离线提示
 */
function showOfflineNotice() {
  offlineNotice.style.display = 'block';
}

/**
 * 隐藏离线提示
 */
function hideOfflineNotice() {
  offlineNotice.style.display = 'none';
}

/**
 * 验证邮箱格式
 */
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * 验证授权码/内测码
 */
async function handleBetaCodeValidation() {
  const code = betaCodeInput.value.trim().toUpperCase();
  
  if (!code) {
    betaCodeResult.style.display = 'none';
    betaCodeValidationResult = null;
    return;
  }
  
  // 显示验证中状态
  validateBetaBtn.textContent = '验证中...';
  validateBetaBtn.disabled = true;
  
  try {
    // 调用授权码验证 API
    const apiUrl = 'http://127.0.0.1:18789/api/beta-codes/validate';
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });
    
    const data = await response.json();
    
    betaCodeValidationResult = data;
    
    // 显示验证结果
    betaCodeResult.style.display = 'block';
    
    if (data.valid) {
      betaCodeResult.className = 'beta-code-result valid';
      const message = data.message || (data.access_type === 'lifetime'
        ? '有效 - 限时永久内测码'
        : `有效 - ${data.validity_days}天免费试用`);
      betaCodeResult.innerHTML = `<span class="result-icon">✓</span> ${message}`;
    } else {
      betaCodeResult.className = 'beta-code-result invalid';
      betaCodeResult.innerHTML = `<span class="result-icon">✗</span> ${data.reason || '授权码/内测码无效'}`;
    }
    
  } catch (error) {
    console.error('[BetaCode] Validation error:', error);
    betaCodeResult.style.display = 'block';
    betaCodeResult.className = 'beta-code-result invalid';
    betaCodeResult.innerHTML = `<span class="result-icon">✗</span> 验证失败，请稍后重试`;
    betaCodeValidationResult = { valid: false };
  } finally {
    validateBetaBtn.textContent = '验证';
    validateBetaBtn.disabled = false;
  }
}

/**
 * 处理登录表单提交
 */
async function handleLogin(event) {
  event.preventDefault();
  
  hideError();
  hideSuccess();
  hideOfflineNotice();
  
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const betaCode = betaCodeInput.value.trim().toUpperCase();
  
  // 前端验证
  if (!email) {
    showError('请输入邮箱');
    return;
  }
  
  if (!validateEmail(email)) {
    showError('邮箱格式不正确');
    return;
  }
  
  if (!password) {
    showError('请输入密码');
    return;
  }
  
  if (password.length < 8) {
    showError('密码长度至少8位');
    return;
  }
  
  // 显示加载状态
  showLoading();
  
  try {
    let result;
    
    if (isElectron) {
      // Electron 环境：通过 IPC 与主进程通信
      console.log('[Login] Using Electron IPC');
      result = await window.electronAPI.login({ email, password, beta_code: betaCode || undefined });
    } else {
      // 开发模式 / Web 环境：直接调用本地服务器 API
      console.log('[Login] Using HTTP API');
      const response = await fetch('http://127.0.0.1:18789/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, beta_code: betaCode || undefined }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        result = {
          success: true,
          user: data.user,
          trial_info: data.trial_info,
          referral_trial_info: data.referral_trial_info,
        };
        
        // 如果有试用期激活信息，显示成功消息
        if (data.trial_info && data.trial_info.success) {
          showSuccess(data.trial_info.message);
          // 延迟跳转让用户看到成功消息
          setTimeout(() => {
            window.location.href = '/';
          }, 1500);
        } else if (data.trial_info && !data.trial_info.success) {
          // 授权码激活失败，但登录成功
          showError(data.trial_info.message);
          setTimeout(() => {
            window.location.href = '/';
          }, 2000);
        } else if (data.referral_trial_info && data.referral_trial_info.success && data.referral_trial_info.code === 'CLAIMED') {
          showSuccess(data.referral_trial_info.message);
          setTimeout(() => {
            window.location.href = '/';
          }, 1500);
        } else {
          window.location.href = '/';
        }
      } else {
        result = {
          success: false,
          error: data.message || '登录失败',
        };
      }
    }
    
    if (result.success) {
      // 登录成功
      console.log('[Login] Success:', result.user?.email);
      
      // 显示试用期激活信息 (Electron 环境)
      if (result.trial_info) {
        if (result.trial_info.success) {
          showSuccess(result.trial_info.message);
        } else {
          showError(result.trial_info.message);
        }
      } else if (result.referral_trial_info?.success && result.referral_trial_info.code === 'CLAIMED') {
        showSuccess(result.referral_trial_info.message);
      }
      
      // Electron 环境下，主进程会自动关闭登录窗口并打开主窗口
      // Web 环境下，已经跳转到主页
    } else {
      // 登录失败
      hideLoading();
      
      if (result.error === 'NETWORK_ERROR' || result.error?.includes('网络')) {
        showOfflineNotice();
      } else {
        showError(result.error || '登录失败，请重试');
      }
    }
  } catch (error) {
    hideLoading();
    console.error('[Login] Error:', error);
    
    const errorMsg = error.message || String(error);
    if (errorMsg.includes('network') || errorMsg.includes('网络') || errorMsg.includes('fetch')) {
      showOfflineNotice();
    } else {
      showError('登录失败：' + errorMsg);
    }
  }
}

/**
 * 如果本地已有有效 session，登录页自动进入主界面。
 * 主要用于启动时后端初始化较慢导致第一次 session 校验超时的场景。
 */
async function enterMainWindowIfExistingSession() {
  if (!isElectron || !window.electronAPI.refreshSubscription || !window.electronAPI.subscriptionValidated) {
    return false;
  }

  try {
    const result = await window.electronAPI.refreshSubscription();
    if (result && result.valid) {
      showSuccess('已检测到登录状态，正在进入主界面...');
      showLoading();
      await window.electronAPI.subscriptionValidated();
      return true;
    }
  } catch (error) {
    console.warn('[Login] Existing session check failed:', error);
  }

  return false;
}

/**
 * 处理注册链接点击
 */
function handleRegisterClick(event) {
  event.preventDefault();
  console.log('[Login] Register link clicked');
  
  // 打开网站注册页面
  const registerUrl = 'https://scholarharness.com/register';
  
  console.log('[Login] isElectron:', isElectron);
  console.log('[Login] electronAPI:', window.electronAPI);
  
  if (isElectron && window.electronAPI && window.electronAPI.openExternal) {
    console.log('[Login] Using electronAPI.openExternal');
    window.electronAPI.openExternal(registerUrl).then(() => {
      console.log('[Login] openExternal success');
    }).catch((err) => {
      console.error('[Login] openExternal error:', err);
      // fallback
      window.open(registerUrl, '_blank');
    });
  } else {
    console.log('[Login] Using window.open');
    window.open(registerUrl, '_blank');
  }
}

/**
 * 处理忘记密码链接点击
 */
function handleForgotPasswordClick(event) {
  event.preventDefault();
  
  // 打开网站忘记密码页面
  const forgotUrl = 'https://scholarharness.com/forgot-password';
  
  if (isElectron && window.electronAPI.openExternal) {
    window.electronAPI.openExternal(forgotUrl);
  } else {
    window.open(forgotUrl, '_blank');
  }
}

/**
 * 处理授权码获取链接点击
 */
function handlePurchaseClick(event) {
  event.preventDefault();
  console.log('[Login] Purchase link clicked');
  
  // 打开网站注册/授权码获取页面
  const purchaseUrl = 'https://scholarharness.com/register';
  
  if (isElectron && window.electronAPI && window.electronAPI.openExternal) {
    window.electronAPI.openExternal(purchaseUrl);
  } else {
    window.open(purchaseUrl, '_blank');
  }
}

/**
 * 检查网络连接
 */
async function checkNetworkConnection() {
  try {
    // 尝试访问本地服务器健康检查
    const response = await fetch('http://127.0.0.1:18789/health', {
      method: 'GET',
      cache: 'no-cache',
    });
    
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * 初始化
 */
function init() {
  console.log('[Login] Initializing...');
  console.log('[Login] Is Electron:', isElectron);
  
  // 绑定表单提交事件
  loginForm.addEventListener('submit', handleLogin);
  
  // 绑定授权码验证按钮
  if (validateBetaBtn) {
    validateBetaBtn.addEventListener('click', handleBetaCodeValidation);
  }
  
  // 授权码输入框自动转大写
  if (betaCodeInput) {
    betaCodeInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
      // 清除之前的验证结果
      betaCodeResult.style.display = 'none';
      betaCodeValidationResult = null;
    });
  }
  
  // 绑定链接点击事件
  registerLink.addEventListener('click', handleRegisterClick);
  forgotPasswordLink.addEventListener('click', handleForgotPasswordClick);
  
  // 绑定授权码获取链接点击事件
  if (purchaseLink) {
    purchaseLink.addEventListener('click', handlePurchaseClick);
  }
  
  // 已有有效 session 时自动进入主界面；否则聚焦到邮箱输入框
  enterMainWindowIfExistingSession().then((entered) => {
    if (!entered) emailInput.focus();
  });
  
  // 检查网络连接
  checkNetworkConnection().then((online) => {
    console.log('[Login] Network online:', online);
    if (!online) {
      showOfflineNotice();
    }
  });
  
  // 监听网络状态变化
  window.addEventListener('online', () => {
    hideOfflineNotice();
  });
  
  window.addEventListener('offline', () => {
    showOfflineNotice();
  });
  
  // Electron 环境：监听登录错误消息
  if (isElectron && window.electronAPI.onLoginError) {
    window.electronAPI.onLoginError((error) => {
      showError(error);
    });
  }
  
  console.log('[Login] Page initialized');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
