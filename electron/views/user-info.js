/**
 * 用户中心界面逻辑
 * 个人中心功能：用户信息、订阅状态、快捷操作
 */

// DOM 元素
const userEmail = document.getElementById('user-email');
const userName = document.getElementById('user-name');
const userRole = document.getElementById('user-role');
const logoutBtn = document.getElementById('logout-btn');
const backLink = document.getElementById('back-link');
const referralCodeEl = document.getElementById('referral-code');
const referralLinkEl = document.getElementById('referral-link');
const referralStatus = document.getElementById('referral-status');
const copyReferralCodeBtn = document.getElementById('copy-referral-code');
const copyReferralLinkBtn = document.getElementById('copy-referral-link');

// 套餐状态
const subscriptionActive = document.getElementById('subscription-active');
const subscriptionNone = document.getElementById('subscription-none');
const planType = document.getElementById('plan-type');
const planStatus = document.getElementById('plan-status');
const endDate = document.getElementById('end-date');
const remainingDays = document.getElementById('remaining-days');
const purchaseLink = document.getElementById('purchase-link');

// 快捷操作
const PURCHASE_URL = 'https://scholarharness.com/register/';
const actionPurchase = document.getElementById('action-purchase');
const actionSettings = document.getElementById('action-settings');

// 错误和加载
const errorMessage = document.getElementById('error-message');
const loadingOverlay = document.getElementById('loading-overlay');

// 检查是否在 Electron 环境
const isElectron = window.electronAPI && window.electronAPI.getUserInfo;

/**
 * 显示错误消息
 */
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  setTimeout(() => {
    errorMessage.style.display = 'none';
  }, 5000);
}

/**
 * 显示加载状态
 */
function showLoading() {
  loadingOverlay.style.display = 'flex';
}

/**
 * 隐藏加载状态
 */
function hideLoading() {
  loadingOverlay.style.display = 'none';
}

/**
 * 套餐类型名称映射
 */
function getPlanName(planType) {
  const names = {
    'monthly': '月度套餐',
    'quarterly': '季度套餐',
    'yearly': '年度套餐',
    'lifetime': '永久套餐',
    'trial': '试用套餐'
  };
  return names[planType] || planType;
}

/**
 * 计算剩余天数
 */
function getDaysRemaining(endDateStr) {
  if (!endDateStr) return 0;
  const end = new Date(endDateStr);
  const now = new Date();
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

/**
 * 格式化日期
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function getInviteLink(referralCode) {
  if (!referralCode) return '';
  return `https://scholarharness.com/register?ref=${encodeURIComponent(referralCode)}`;
}

async function copyText(text, successMessage) {
  if (!text) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }

    referralStatus.textContent = successMessage;
    referralStatus.className = 'referral-status success';
  } catch (error) {
    referralStatus.textContent = text;
    referralStatus.className = 'referral-status warning';
  }
}

function renderReferralInfo(user) {
  const referralCode = user && user.referral_code ? user.referral_code : '';
  const inviteLink = getInviteLink(referralCode);

  referralCodeEl.textContent = referralCode || '登录后自动生成';
  referralLinkEl.textContent = inviteLink || '-';
  referralStatus.textContent = '';
  referralStatus.className = 'referral-status';
  copyReferralCodeBtn.disabled = !referralCode;
  copyReferralLinkBtn.disabled = !inviteLink;
}

/**
 * 加载用户信息
 */
async function loadUserInfo() {
  showLoading();
  
  try {
    let userInfoResult;
    
    if (isElectron) {
      userInfoResult = await window.electronAPI.getUserInfo();
    } else {
      const userInfoResponse = await fetch('http://127.0.0.1:18789/api/auth/me');
      userInfoResult = await userInfoResponse.json();
    }
    
    // 处理用户信息
    if (userInfoResult.error) {
      showError(userInfoResult.error);
      hideLoading();
      return;
    }
    
    if (userInfoResult.user) {
      userEmail.textContent = userInfoResult.user.email || '-';
      userName.textContent = userInfoResult.user.username || '未设置';
      userRole.textContent = userInfoResult.user.role === 'admin' ? '管理员' : '普通用户';
      renderReferralInfo(userInfoResult.user);
    }
    
    // 处理套餐状态
    if (userInfoResult.subscription && userInfoResult.subscription.status === 'active') {
      subscriptionActive.style.display = 'block';
      subscriptionNone.style.display = 'none';
      
      planType.textContent = getPlanName(userInfoResult.subscription.plan_type);
      const isLifetime = userInfoResult.subscription.plan_type === 'lifetime';

      if (isLifetime) {
        endDate.textContent = '永久';
        remainingDays.textContent = '永久';
        remainingDays.style.color = '#16a34a';
      } else {
        endDate.textContent = formatDate(userInfoResult.subscription.end_date);

        const days = getDaysRemaining(userInfoResult.subscription.end_date);
        remainingDays.textContent = days + ' 天';

        if (days < 7) {
          remainingDays.style.color = '#ef4444';
        }
      }
    } else {
      subscriptionActive.style.display = 'none';
      subscriptionNone.style.display = 'block';
    }
    
  } catch (error) {
    console.error('[UserInfo] Load failed:', error);
    showError('加载失败：' + (error.message || String(error)));
  }
  
  hideLoading();
}

/**
 * 打开外部链接
 */
function openExternal(url) {
  if (isElectron && window.electronAPI && window.electronAPI.openExternal) {
    window.electronAPI.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

/**
 * 处理快捷操作点击
 */
function handleActionClick(url) {
  return function(event) {
    event.preventDefault();
    openExternal(url);
  };
}

/**
 * 退出登录
 */
async function handleLogout() {
  try {
    if (isElectron && window.electronAPI && window.electronAPI.logout) {
      await window.electronAPI.logout();
    } else {
      await fetch('http://127.0.0.1:18789/api/auth/logout', { method: 'POST' });
      window.location.reload();
    }
  } catch (error) {
    showError('退出登录失败');
  }
}

/**
 * 初始化
 */
function init() {
  console.log('[UserInfo] Initializing...');
  console.log('[UserInfo] Is Electron:', isElectron);
  
  // 加载用户信息
  loadUserInfo();
  
  // 绑定退出登录
  logoutBtn.addEventListener('click', handleLogout);
  
  // 绑定返回主页
  backLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (isElectron) {
      window.close();
    }
  });
  
  // 绑定购买链接
  purchaseLink.addEventListener('click', handleActionClick(PURCHASE_URL));
  
  // 绑定快捷操作
  actionPurchase.addEventListener('click', handleActionClick(PURCHASE_URL));
  actionSettings.addEventListener('click', handleActionClick('https://scholarharness.com/dashboard/settings'));
  copyReferralCodeBtn.addEventListener('click', () => {
    copyText(referralCodeEl.textContent === '登录后自动生成' ? '' : referralCodeEl.textContent, '邀请码已复制');
  });
  copyReferralLinkBtn.addEventListener('click', () => {
    copyText(referralLinkEl.textContent === '-' ? '' : referralLinkEl.textContent, '邀请链接已复制');
  });
  
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
