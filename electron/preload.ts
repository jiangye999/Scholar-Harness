/**
 * Electron Preload Script
 * 在渲染进程和主进程之间建立安全的通信桥梁
 */

import { contextBridge, ipcRenderer, shell, webUtils } from 'electron';

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  // 登录相关
  login: (credentials: { email: string; password: string; beta_code?: string }) => 
    ipcRenderer.invoke('login', credentials),
  
  // 打开外部链接 (通过 IPC 用主进程，更可靠)
  openExternal: (url: string) => 
    ipcRenderer.invoke('open-external', url),

  // 在主窗口右侧的隔离网页视图中打开受信任的模型厂商配置页。
  openVendorConfigBrowser: (providerId: string, bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('vendor-config-browser-open', providerId, bounds),

  setVendorConfigBrowserBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('vendor-config-browser-bounds', bounds),

  hideVendorConfigBrowser: () =>
    ipcRenderer.invoke('vendor-config-browser-hide'),

  vendorConfigBrowserCommand: (command: 'back' | 'reload' | 'external' | 'close') =>
    ipcRenderer.invoke('vendor-config-browser-command', command),

  onVendorConfigBrowserState: (callback: (state: {
    providerId?: string;
    name?: string;
    url?: string;
    canGoBack?: boolean;
    loading?: boolean;
    hidden?: boolean;
    error?: string;
  }) => void) =>
    ipcRenderer.on('vendor-config-browser-state', (_event, state) => callback(state)),

  removeVendorConfigBrowserStateListener: () =>
    ipcRenderer.removeAllListeners('vendor-config-browser-state'),

  // 用系统默认程序打开本地文件
  openPath: (targetPath: string) =>
    ipcRenderer.invoke('open-path', targetPath),

  // 在系统文件管理器中定位本地文件
  openContainingFolder: (targetPath: string) =>
    ipcRenderer.invoke('open-containing-folder', targetPath),

  // 主窗口处于 sandbox 模式时，通过主进程可靠写入系统剪贴板。
  writeClipboardText: (text: string) =>
    ipcRenderer.invoke('clipboard-write-text', text),

  // Electron 32+ 不再可靠地暴露 File.path；通过 webUtils 获取拖拽/选择文件的真实本地路径。
  getPathForFile: (file: Parameters<typeof webUtils.getPathForFile>[0]) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  
  // 监听登录错误
  onLoginError: (callback: (error: string) => void) => {
    ipcRenderer.on('login-error', (_event, error) => callback(error));
  },
  
  // 移除登录错误监听
  removeLoginErrorListener: () => {
    ipcRenderer.removeAllListeners('login-error');
  },
  
  // 检查激活状态
  checkActivation: () => 
    ipcRenderer.invoke('check-activation'),
  
  // 获取设备ID
  getDeviceId: () => 
    ipcRenderer.invoke('get-device-id'),
  
  // 激活完成
  activationComplete: () => 
    ipcRenderer.invoke('activation-complete'),
  
  // === 套餐验证相关（新增）===
  
  // 刷新验证套餐状态
  refreshSubscription: () => 
    ipcRenderer.invoke('refresh-subscription'),
  
  // 套餐验证成功后启动主窗口
  subscriptionValidated: () => 
    ipcRenderer.invoke('subscription-validated'),
  
  // 退出登录
  logout: () => 
    ipcRenderer.invoke('logout'),
  
  // 监听购买原因
  onPurchaseReason: (callback: (reason: string) => void) => {
    ipcRenderer.on('purchase-reason', (_event, reason) => callback(reason));
  },
  
  // === 用户信息相关 ===
  
  // 获取用户信息
  getUserInfo: () => 
    ipcRenderer.invoke('get-user-info'),
  
  // 获取用量统计（用于柱状图）
  getDailyStats: () => 
    ipcRenderer.invoke('get-daily-stats'),
  
  // 获取充值链接
  getPurchaseUrl: (amountCNY: number) => 
    ipcRenderer.invoke('get-purchase-url', amountCNY),
  
  // 打开充值网页
  openPurchasePage: (amountCNY: number) => 
    ipcRenderer.invoke('open-purchase-page', amountCNY),
  
  // 打开用户信息窗口
  openUserInfoWindow: () => 
    ipcRenderer.invoke('open-user-info-window'),

  // 顶部应用菜单命令
  appMenuCommand: (command: string) =>
    ipcRenderer.invoke('app-menu-command', command),

  // 应用更新检查
  checkAppUpdate: () =>
    ipcRenderer.invoke('app-update-check'),

  // 打开最新版本下载地址
  openAppUpdateDownload: (downloadUrl?: string) =>
    ipcRenderer.invoke('app-update-open-download', downloadUrl),

  // 自定义窗口控制
  windowControl: (action: 'minimize' | 'maximize' | 'close') =>
    ipcRenderer.invoke('window-control', action),
  
  // === R 代码文件保存相关 ===
  
  // 保存文件到桌面
  saveFileToDesktop: (filename: string, content: string) => 
    ipcRenderer.invoke('save-file-to-desktop', filename, content),
  
  // 获取桌面路径
  getDesktopPath: () => 
    ipcRenderer.invoke('get-desktop-path'),
  
  // === 内测码激活（已登录用户）===
  
  // 激活内测码（通过云服务器 API）
  activateBetaCode: (code: string) => 
    ipcRenderer.invoke('activate-beta-code', code),
});

// 类型声明（供 TypeScript 使用）
export interface ElectronAPI {
  login: (credentials: { email: string; password: string; beta_code?: string }) => Promise<{
    success: boolean;
    user?: {
      id: string;
      email: string;
      username?: string;
      avatar_url?: string;
      referral_code?: string;
    };
    error?: string;
    needPurchase?: boolean;
    subscription?: { plan_type: string; status: string; end_date: string };
    trial_info?: {
      success: boolean;
      trial_days?: number;
      access_type?: string;
      message: string;
    };
    referral_trial_info?: {
      success: boolean;
      code?: string;
      trial_days?: number;
      access_type?: string;
      message: string;
      referral_count?: number;
      required_referrals?: number;
      remaining_referrals?: number;
    };
  }>;
  openExternal: (url: string) => Promise<void>;
  openVendorConfigBrowser: (
    providerId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ) => Promise<{ success: boolean; providerId?: string; name?: string; url?: string; error?: string }>;
  setVendorConfigBrowserBounds: (
    bounds: { x: number; y: number; width: number; height: number },
  ) => Promise<{ success: boolean; error?: string }>;
  hideVendorConfigBrowser: () => Promise<{ success: boolean; error?: string }>;
  vendorConfigBrowserCommand: (
    command: 'back' | 'reload' | 'external' | 'close',
  ) => Promise<{ success: boolean; error?: string }>;
  onVendorConfigBrowserState: (callback: (state: {
    providerId?: string;
    name?: string;
    url?: string;
    canGoBack?: boolean;
    loading?: boolean;
    hidden?: boolean;
    error?: string;
  }) => void) => void;
  removeVendorConfigBrowserStateListener: () => void;
  openPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
  openContainingFolder: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
  writeClipboardText: (text: string) => Promise<{ success: boolean; error?: string }>;
  getPathForFile: (file: Parameters<typeof webUtils.getPathForFile>[0]) => string;
  onLoginError: (callback: (error: string) => void) => void;
  removeLoginErrorListener: () => void;
  checkActivation: () => Promise<{ valid: boolean; message: string }>;
  getDeviceId: () => Promise<string>;
  activationComplete: () => Promise<{ success: boolean }>;
  // 套餐验证相关
  refreshSubscription: () => Promise<{ valid: boolean; reason?: string; subscription?: any }>;
  subscriptionValidated: () => Promise<{ success: boolean }>;
  logout: () => Promise<{ success: boolean }>;
  onPurchaseReason: (callback: (reason: string) => void) => void;
  // 用户信息
  getUserInfo: () => Promise<{
    user?: {
      id: string;
      email: string;
      username?: string;
      avatar_url?: string;
    };
    subscription?: {
      plan_type: string;
      status: string;
      quota_remaining: number;
      quota_total: number;
    };
    error?: string;
  }>;
  getDailyStats: () => Promise<{
    daily_stats?: Array<{ date: string; word_count: number; file_count: number }>;
    subscription?: {
      plan_type: string;
      quota_remaining: number;
      quota_total: number;
    };
    error?: string;
  }>;
  getPurchaseUrl: (amountCNY: number) => Promise<{
    pay_url?: string;
    credits?: number;
    error?: string;
  }>;
  openPurchasePage: (amountCNY: number) => Promise<{ success: boolean; error?: string }>;
  openUserInfoWindow: () => Promise<{ success: boolean }>;
  appMenuCommand: (command: string) => Promise<{ success: boolean; error?: string }>;
  checkAppUpdate: () => Promise<{
    success: boolean;
    updateAvailable: boolean;
    currentVersion: string;
    latestVersion?: string;
    downloadUrl?: string;
    releaseNotes?: string;
    publishedAt?: string;
    error?: string;
  }>;
  openAppUpdateDownload: (downloadUrl?: string) => Promise<{ success: boolean; error?: string }>;
  windowControl: (action: 'minimize' | 'maximize' | 'close') => Promise<{
    success: boolean;
    maximized?: boolean;
    error?: string;
  }>;
  // R 代码文件保存
  saveFileToDesktop: (filename: string, content: string) => Promise<{
    success: boolean;
    filepath?: string;
    error?: string;
  }>;
  getDesktopPath: () => Promise<{ path: string }>;
  // 内测码激活
  activateBetaCode: (code: string) => Promise<{
    success: boolean;
    trial_days?: number;
    access_type?: string;
    message?: string;
    reason?: string;
  }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
