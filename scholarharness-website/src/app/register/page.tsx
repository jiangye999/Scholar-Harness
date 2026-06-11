'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { register, validateBetaCode, sendEmailVerificationCode, type CaptchaVerification } from '@/lib/auth';
import Link from 'next/link';

declare global {
  interface Window {
    TencentCaptcha?: new (
      appId: string,
      callback: (response: { ret: number; ticket?: string; randstr?: string }) => void
    ) => { show: () => void };
    __tencentCaptchaLoading?: Promise<void>;
  }
}

const CAPTCHA_APP_ID = process.env.NEXT_PUBLIC_TENCENT_CAPTCHA_APP_ID || '191310211';
const CAPTCHA_ENABLED = process.env.NEXT_PUBLIC_CAPTCHA_ENABLED !== 'false';
const TENCENT_CAPTCHA_SCRIPT_URL = 'https://turing.captcha.qcloud.com/TJCaptcha.js';

const licensePlans = [
  {
    name: '月度授权',
    duration: '30天',
    description: '适合短期体验、论文冲刺和阶段性文献整理',
    href: 'https://pay.ldxp.cn/item/2byspy',
  },
  {
    name: '季度授权',
    duration: '90天',
    description: '适合完整课题阶段写作、讨论式写作和文献管理',
    href: 'https://pay.ldxp.cn/item/o1uwbu',
  },
  {
    name: '年度授权',
    duration: '365天',
    description: '适合长期科研写作、文献计量和本地客户端持续使用',
    href: 'https://pay.ldxp.cn/item/k41h4o',
  },
] as const;

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getAuthorizationMessage(result: {
  access_type?: 'trial' | 'lifetime';
  validity_days?: number;
  message?: string;
}): string {
  if (result.access_type === 'lifetime') {
    return '有效 - 长期软件授权';
  }

  if (result.validity_days) {
    return `有效 - ${result.validity_days}天软件授权`;
  }

  return result.message || '授权码/内测码有效';
}

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [betaCode, setBetaCode] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [betaCodeValid, setBetaCodeValid] = useState<boolean | null>(null);
  const [betaCodeMessage, setBetaCodeMessage] = useState('');
  const [betaCodeLoading, setBetaCodeLoading] = useState(false);
  const [verificationCodeSending, setVerificationCodeSending] = useState(false);
  const [verificationCodeSent, setVerificationCodeSent] = useState(false);
  const [verificationCodeCountdown, setVerificationCodeCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  
  // 用户同意勾选框
  const [acceptPrivacyPolicy, setAcceptPrivacyPolicy] = useState(false);
  const [acceptUserAgreement, setAcceptUserAgreement] = useState(false);
  const [acceptCrossBorderTransfer, setAcceptCrossBorderTransfer] = useState(false);
  const [acceptWritingResponsibility, setAcceptWritingResponsibility] = useState(false);
  
  const router = useRouter();
  const verificationCodeCountdownTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const referral = params.get('ref') || params.get('invite') || params.get('referral_code');
    if (referral) {
      setReferralCode(referral.trim().toUpperCase());
    }

    return () => {
      if (verificationCodeCountdownTimerRef.current !== null) {
        window.clearInterval(verificationCodeCountdownTimerRef.current);
      }
    };
  }, []);

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const loadTencentCaptcha = (): Promise<void> => {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('当前环境无法加载人机验证'));
    }

    if (window.TencentCaptcha) {
      return Promise.resolve();
    }

    if (window.__tencentCaptchaLoading) {
      return window.__tencentCaptchaLoading;
    }

    window.__tencentCaptchaLoading = new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-tencent-captcha="true"]');
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(), { once: true });
        existingScript.addEventListener('error', () => {
          window.__tencentCaptchaLoading = undefined;
          reject(new Error('人机验证组件加载失败'));
        }, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = TENCENT_CAPTCHA_SCRIPT_URL;
      script.async = true;
      script.dataset.tencentCaptcha = 'true';
      script.onload = () => resolve();
      script.onerror = () => {
        window.__tencentCaptchaLoading = undefined;
        reject(new Error('人机验证组件加载失败，请检查网络后重试'));
      };
      document.head.appendChild(script);
    });

    return window.__tencentCaptchaLoading;
  };

  const runTencentCaptcha = async (
    onVerified: (captcha: CaptchaVerification) => Promise<void>
  ): Promise<void> => {
    if (!CAPTCHA_ENABLED || !CAPTCHA_APP_ID) {
      return;
    }

    await loadTencentCaptcha();

    if (!window.TencentCaptcha) {
      throw new Error('人机验证组件未就绪，请刷新页面后重试');
    }

    const CaptchaCtor = window.TencentCaptcha;

    await new Promise<void>((resolve, reject) => {
      try {
        const captcha = new CaptchaCtor(CAPTCHA_APP_ID, (response) => {
          if (response.ret === 0 && response.ticket && response.randstr) {
            void onVerified({
              ticket: response.ticket,
              randstr: response.randstr,
            }).then(resolve).catch(reject);
            return;
          }

          if (response.ret === 2) {
            reject(new Error('已取消人机验证'));
            return;
          }

          reject(new Error(`人机验证失败，请重试（${response.ret}）`));
        });

        captcha.show();
      } catch {
        reject(new Error('人机验证弹出失败，请刷新页面后重试'));
      }
    });
  };

  const startVerificationCodeCountdown = () => {
    if (verificationCodeCountdownTimerRef.current !== null) {
      window.clearInterval(verificationCodeCountdownTimerRef.current);
    }

    setVerificationCodeCountdown(60);
    verificationCodeCountdownTimerRef.current = window.setInterval(() => {
      setVerificationCodeCountdown((prev) => {
        if (prev <= 1) {
          if (verificationCodeCountdownTimerRef.current !== null) {
            window.clearInterval(verificationCodeCountdownTimerRef.current);
            verificationCodeCountdownTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const stopVerificationCodeCountdown = () => {
    if (verificationCodeCountdownTimerRef.current !== null) {
      window.clearInterval(verificationCodeCountdownTimerRef.current);
      verificationCodeCountdownTimerRef.current = null;
    }
    setVerificationCodeCountdown(0);
  };

  const sendVerificationCodeAfterCaptcha = async (captcha?: CaptchaVerification) => {
    const shouldStartCountdownImmediately = Boolean(captcha);
    setSuccessMessage(captcha ? '人机验证通过，正在自动发送邮箱验证码...' : '正在发送邮箱验证码...');

    if (shouldStartCountdownImmediately) {
      startVerificationCodeCountdown();
    }

    let result;
    try {
      result = await sendEmailVerificationCode(email, 'register', captcha);
    } catch (error) {
      if (shouldStartCountdownImmediately) {
        stopVerificationCodeCountdown();
      }
      throw error;
    }

    if (result.success) {
      setVerificationCodeSent(true);

      const codeMatch = result.message.match(/验证码:\s*(\d+)/);
      if (codeMatch) {
        const code = codeMatch[1];
        setVerificationCode(code);
        setSuccessMessage(`测试模式验证码：${code}`);
      } else {
        setSuccessMessage(result.message);
      }

      if (!shouldStartCountdownImmediately) {
        startVerificationCodeCountdown();
      }
      return;
    }

    if (shouldStartCountdownImmediately) {
      stopVerificationCodeCountdown();
    }
    throw new Error(result.message);
  };

  // 发送邮箱验证码
  const handleSendVerificationCode = async () => {
    if (!email) {
      setError('请先输入邮箱地址');
      return;
    }

    if (!validateEmail(email)) {
      setError('邮箱格式不正确');
      return;
    }

    setVerificationCodeSending(true);
    setError('');
    setSuccessMessage('');

    try {
      if (CAPTCHA_ENABLED) {
        setSuccessMessage('请完成人机验证，验证通过后会自动发送邮箱验证码');
        await runTencentCaptcha(sendVerificationCodeAfterCaptcha);
      } else {
        await sendVerificationCodeAfterCaptcha();
      }
    } catch (err) {
      setSuccessMessage('');
      setError(getErrorMessage(err, '验证码发送失败，请稍后重试'));
    } finally {
      setVerificationCodeSending(false);
    }
  };

  // 验证授权码/内测码
  const handleBetaCodeValidation = async () => {
    if (!betaCode.trim()) {
      setBetaCodeValid(null);
      setBetaCodeMessage('');
      return;
    }

    setBetaCodeLoading(true);
    try {
      const result = await validateBetaCode(betaCode.trim().toUpperCase());
      setBetaCodeValid(result.valid);
      if (result.valid) {
        setBetaCodeMessage(getAuthorizationMessage(result));
      } else {
        setBetaCodeMessage(result.reason || '授权码/内测码无效');
      }
    } catch {
      setBetaCodeValid(false);
      setBetaCodeMessage('验证失败，请稍后重试');
    } finally {
      setBetaCodeLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    // Validation
    if (!email) {
      setError('请输入邮箱地址');
      return;
    }
    if (!validateEmail(email)) {
      setError('邮箱格式不正确');
      return;
    }
    if (!verificationCode) {
      setError('请输入邮箱验证码');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }
    if (password.length < 8) {
      setError('密码至少需要8位');
      return;
    }
    if (!confirmPassword) {
      setError('请确认密码');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    const normalizedBetaCode = betaCode.trim().toUpperCase();
    const normalizedReferralCode = referralCode.trim().toUpperCase();
    if (!normalizedBetaCode && !normalizedReferralCode) {
      setError('注册必须填写授权码/内测码或好友邀请码');
      return;
    }
    if (normalizedBetaCode && betaCodeValid === false) {
      setError(betaCodeMessage || '授权码/内测码无效，请检查后重试');
      return;
    }
    
    // 合规验证：必须同意隐私政策和用户协议
    if (!acceptPrivacyPolicy) {
      setError('请阅读并同意隐私政策');
      return;
    }
    if (!acceptUserAgreement) {
      setError('请阅读并同意用户协议');
      return;
    }
    if (!acceptWritingResponsibility) {
      setError('请确认本工具为辅助写作工具，不能代替写作');
      return;
    }

    setLoading(true);
    try {
      if (normalizedBetaCode && betaCodeValid !== true) {
        const betaValidation = await validateBetaCode(normalizedBetaCode);
        setBetaCodeValid(betaValidation.valid);
        setBetaCodeMessage(betaValidation.valid
          ? getAuthorizationMessage(betaValidation)
          : betaValidation.reason || '授权码/内测码无效');

        if (!betaValidation.valid) {
          throw new Error(betaValidation.reason || '授权码/内测码无效，请检查后重试');
        }
      }

      const result = await register(
        email,
        password,
        verificationCode.trim(),
        username || undefined,
        {
          accept_privacy_policy: acceptPrivacyPolicy,
          accept_user_agreement: acceptUserAgreement,
          accept_cross_border_transfer: acceptCrossBorderTransfer,
        },
        normalizedBetaCode || undefined,
        normalizedReferralCode || undefined
      );
      
      // 如果有试用期信息，显示成功消息
      if (result.trial_info) {
        setSuccessMessage(result.trial_info.trial_days
          ? `已激活${result.trial_info.trial_days}天软件授权`
          : result.trial_info.message);
      }
      
      // 跳转到仪表盘
      router.push('/dashboard');
    } catch (err) {
      setError(getErrorMessage(err, '注册失败，请重试'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl items-start gap-10 lg:grid-cols-[0.95fr_1.05fr]">
        <aside className="space-y-6 lg:sticky lg:top-10">
          <div className="space-y-3">
            <p className="text-sm font-medium text-emerald-700">ScholarHarness 本地客户端授权</p>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              联系获取软件授权码/内测码
            </h1>
            <p className="max-w-xl text-sm leading-6 text-gray-600">
              ScholarHarness 主要在本地客户端使用，用户自行配置第三方 LLM API。选择授权周期，获取授权码后在右侧注册表单中填写并验证。
            </p>
          </div>

          <div className="grid gap-3">
            {licensePlans.map((plan) => (
              <div key={plan.name} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-semibold text-gray-900">{plan.name}</div>
                    <div className="mt-1 text-sm font-medium text-emerald-700">{plan.duration}</div>
                    <div className="mt-2 text-sm leading-6 text-gray-600">{plan.description}</div>
                  </div>
                  <a
                    href={plan.href}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800"
                  >
                    去购买
                  </a>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="shrink-0 overflow-hidden rounded-md border border-white bg-white p-2 shadow-sm">
                <Image
                  src="/beta-group-qr.png"
                  alt="Scholar Harness 内测群二维码"
                  width={132}
                  height={144}
                  unoptimized
                  className="h-32 w-32 object-contain"
                />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-900">Scholar Harness 内测群</div>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  购买后如需获取卡密、确认授权或咨询注册问题，可以扫码加入内测群。
                </p>
              </div>
            </div>
          </div>

        </aside>

        <div className="w-full max-w-md justify-self-center space-y-8 lg:justify-self-end">
          {/* Header */}
          <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900">创建账号</h2>
          <p className="mt-2 text-sm text-gray-600">
            开始使用 ScholarHarness 论文写作助手
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-lg shadow-[0_10px_32px_rgba(17,24,39,0.08)] border border-gray-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                邮箱地址 <span className="text-red-500">*</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-700/15 focus:border-emerald-700 transition"
                placeholder="your@email.com"
                required
              />
            </div>

            {/* Email Verification Code */}
            <div>
              <label htmlFor="verificationCode" className="block text-sm font-medium text-gray-700 mb-2">
                邮箱验证码 <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  id="verificationCode"
                  type="text"
                  inputMode="numeric"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="flex-1 px-4 py-3 bg-gray-50 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-700/15 focus:border-emerald-700 transition"
                  placeholder="输入6位验证码"
                  maxLength={6}
                  required
                />
                <button
                  type="button"
                  onClick={handleSendVerificationCode}
                  disabled={!email || !validateEmail(email) || verificationCodeSending || verificationCodeCountdown > 0}
                  className="px-4 py-3 bg-gray-100 hover:bg-white border border-gray-300 hover:border-emerald-700 disabled:bg-gray-50 text-gray-700 hover:text-emerald-700 disabled:text-gray-400 rounded-md transition text-sm font-medium whitespace-nowrap"
                >
                  {verificationCodeCountdown > 0
                      ? `${verificationCodeCountdown}s`
                      : verificationCodeSending
                        ? '发送中...'
                        : verificationCodeSent
                          ? '重新发送'
                          : '发送验证码'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                验证码将发送至您的邮箱，有效期5分钟
              </p>
            </div>

            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                用户名 <span className="text-gray-400">(可选)</span>
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-700/15 focus:border-emerald-700 transition"
                placeholder="输入用户名"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                密码 <span className="text-red-500">*</span>
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-700/15 focus:border-emerald-700 transition"
                placeholder="至少8位字符"
                required
              />
              <p className="mt-1 text-xs text-gray-500">密码至少需要8个字符</p>
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                确认密码 <span className="text-red-500">*</span>
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-700/15 focus:border-emerald-700 transition"
                placeholder="再次输入密码"
                required
              />
            </div>

            {/* Beta Code */}
            <div>
              <label htmlFor="betaCode" className="block text-sm font-medium text-gray-700 mb-2">
                授权码/内测码 <span className="text-gray-400">(与邀请码二选一)</span>
              </label>
              <div className="flex gap-2">
                <input
                  id="betaCode"
                  type="text"
                  value={betaCode}
                  onChange={(e) => {
                    setBetaCode(e.target.value.toUpperCase());
                    setBetaCodeValid(null);
                    setBetaCodeMessage('');
                  }}
                  className="flex-1 px-4 py-3 bg-gray-50 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-700/15 focus:border-emerald-700 transition font-mono uppercase"
                  placeholder="请输入授权码/内测码"
                  maxLength={20}
                  required={!referralCode.trim()}
                />
                <button
                  type="button"
                  onClick={handleBetaCodeValidation}
                  disabled={!betaCode.trim() || betaCodeLoading}
                  className="px-4 py-3 bg-gray-100 hover:bg-white border border-gray-300 hover:border-emerald-700 disabled:bg-gray-50 text-gray-700 hover:text-emerald-700 rounded-md transition text-sm font-medium"
                >
                  {betaCodeLoading ? '验证中...' : '验证'}
                </button>
              </div>
              {/* Beta Code Validation Result */}
              {betaCodeMessage && (
                <p className={`mt-2 text-sm ${betaCodeValid ? 'text-green-600' : 'text-red-600'}`}>
                  {betaCodeValid ? '✓ ' : '✗ '}{betaCodeMessage}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                授权码/内测码和好友邀请码至少填写一个；已有账号登录时可选填授权码激活使用权限
              </p>
            </div>

            {/* Referral Code */}
            <div>
              <label htmlFor="referralCode" className="block text-sm font-medium text-gray-700 mb-2">
                邀请码 <span className="text-gray-400">(与授权码二选一)</span>
              </label>
              <input
                id="referralCode"
                type="text"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-700/15 focus:border-emerald-700 transition font-mono uppercase"
                placeholder="好友邀请码"
                maxLength={20}
              />
              <p className="mt-1 text-xs text-gray-500">
                通过好友邀请链接进入时会自动填写；使用邀请码注册可获得10天免费试用，并计入好友邀请进度
              </p>
            </div>

            {/* 用户同意勾选框 - 合规要求 */}
            <div className="space-y-3 pt-4 border-t border-gray-200">
              <p className="text-sm font-medium text-gray-700">用户协议、隐私政策、免责声明与辅助写作提示</p>
              
              {/* 隐私政策同意 */}
              <div className="flex items-start">
                <input
                  id="acceptPrivacyPolicy"
                  type="checkbox"
                  checked={acceptPrivacyPolicy}
                  onChange={(e) => setAcceptPrivacyPolicy(e.target.checked)}
                  className="h-4 w-4 text-emerald-700 focus:ring-emerald-700 border-gray-300 rounded mt-1"
                />
                <label htmlFor="acceptPrivacyPolicy" className="ml-3 text-sm text-gray-600">
                  我已阅读并同意{' '}
                  <Link href="/privacy" className="text-emerald-700 hover:text-emerald-800 font-medium underline" target="_blank">
                    隐私政策
                  </Link>
                  <span className="text-red-500 ml-1">*</span>
                </label>
              </div>
              
              {/* 用户协议同意 */}
              <div className="flex items-start">
                <input
                  id="acceptUserAgreement"
                  type="checkbox"
                  checked={acceptUserAgreement}
                  onChange={(e) => setAcceptUserAgreement(e.target.checked)}
                  className="h-4 w-4 text-emerald-700 focus:ring-emerald-700 border-gray-300 rounded mt-1"
                />
                <label htmlFor="acceptUserAgreement" className="ml-3 text-sm text-gray-600">
                  我已阅读并同意{' '}
                  <Link href="/terms" className="text-emerald-700 hover:text-emerald-800 font-medium underline" target="_blank">
                    用户协议
                  </Link>
                  {' '}及其组成部分{' '}
                  <Link href="/disclaimer" className="text-emerald-700 hover:text-emerald-800 font-medium underline" target="_blank">
                    免责声明
                  </Link>
                  <span className="text-red-500 ml-1">*</span>
                </label>
              </div>
              
              {/* 辅助写作责任确认 */}
              <div className="flex items-start">
                <input
                  id="acceptWritingResponsibility"
                  type="checkbox"
                  checked={acceptWritingResponsibility}
                  onChange={(e) => setAcceptWritingResponsibility(e.target.checked)}
                  className="h-4 w-4 text-emerald-700 focus:ring-emerald-700 border-gray-300 rounded mt-1"
                />
                <label htmlFor="acceptWritingResponsibility" className="ml-3 text-sm text-gray-600">
                  我已知悉：本工具为辅助写作工具，不能代替写作；请认真、严格修改 AI 生成的文字
                  <span className="text-red-500 ml-1">*</span>
                </label>
              </div>
              
              {/* 数据跨境传输同意 */}
              <div className="flex items-start">
                <input
                  id="acceptCrossBorderTransfer"
                  type="checkbox"
                  checked={acceptCrossBorderTransfer}
                  onChange={(e) => setAcceptCrossBorderTransfer(e.target.checked)}
                  className="h-4 w-4 text-emerald-700 focus:ring-emerald-700 border-gray-300 rounded mt-1"
                />
                <label htmlFor="acceptCrossBorderTransfer" className="ml-3 text-sm text-gray-600">
                  我理解并同意：
                  <Link href="/privacy#cross-border" className="text-emerald-700 hover:text-emerald-800 font-medium underline" target="_blank">
                    使用第三方 AI 服务时，我的输入内容可能传输至境外服务器进行处理
                  </Link>
                  <span className="text-gray-400 ml-1">(可选)</span>
                </label>
              </div>
              
              <p className="text-xs text-gray-500">
                * 必须同意隐私政策、用户协议、免责声明和辅助写作提示才能注册使用服务
              </p>
            </div>

            {/* Success Message */}
            {successMessage && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm">
                {successMessage}
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || betaCodeLoading}
              className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-md font-medium transition flex items-center justify-center shadow-[0_8px_18px_rgba(0,136,110,0.16)] disabled:shadow-none"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  注册中...
                </>
              ) : (
                '注册'
              )}
            </button>
          </form>

          {/* Footer Link */}
          <div className="mt-6 text-center text-sm text-gray-600">
            已有账号？{' '}
            <Link href="/login" className="text-emerald-700 hover:text-emerald-800 font-medium">
              立即登录
            </Link>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
