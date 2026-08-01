var UI_ICON_PATHS = {
      user: '<circle cx="12" cy="8" r="4"></circle><path d="M20 21a8 8 0 0 0-16 0"></path>',
      chevronRight: '<polyline points="9 18 15 12 9 6"></polyline>',
      plusSquare: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M12 8v8"></path><path d="M8 12h8"></path>',
      folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
      fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="14" y2="17"></line>',
      flask: '<path d="M10 2v6l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V2"></path><path d="M8 2h8"></path><path d="M7 16h10"></path>',
      barChart: '<line x1="4" y1="20" x2="20" y2="20"></line><rect x="6" y="11" width="3" height="7"></rect><rect x="11" y="7" width="3" height="11"></rect><rect x="16" y="4" width="3" height="14"></rect>',
      newspaper: '<path d="M4 19a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 0 2 2H4z"></path><path d="M6 7h8"></path><path d="M6 11h8"></path><path d="M6 15h5"></path>',
      lineChart: '<path d="M3 3v18h18"></path><path d="m7 15 4-4 3 3 5-7"></path>',
      trash: '<polyline points="3 6 5 6 21 6"></polyline><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
      bookOpen: '<path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H11v18H4.5A2.5 2.5 0 0 0 2 22z"></path><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H13v18h6.5A2.5 2.5 0 0 1 22 22z"></path>',
      globe: '<circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15.3 15.3 0 0 1 0 20"></path><path d="M12 2a15.3 15.3 0 0 0 0 20"></path>',
      settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 0 1 7.1 4.3l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.32.23.66.26 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>',
      network: '<circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="6" r="2.5"></circle><circle cx="18" cy="18" r="2.5"></circle><path d="M8.2 10.8 15.8 7.2"></path><path d="M8.2 13.2 15.8 16.8"></path>',
      pin: '<path d="M12 17v5"></path><path d="M5 17h14"></path><path d="M7 3h10l-2 7 3 4H6l3-4z"></path>',
      clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>',
      edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
      wrench: '<path d="M14.7 6.3a4 4 0 0 0-5 5L3 18v3h3l6.7-6.7a4 4 0 0 0 5-5l-2.8 2.8-2-2z"></path>',
      messageCircle: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"></path>',
      checkCircle: '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
      image: '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path>',
      table: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18"></path><path d="M9 4v16"></path><path d="M15 4v16"></path>',
      paperclip: '<path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l8.5-8.5a4 4 0 0 1 5.7 5.7l-8.5 8.5a2 2 0 0 1-2.8-2.8l8.5-8.5"></path>',
      x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
      library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"></path><path d="M8 7h8"></path><path d="M8 11h6"></path>'
    };

    function uiIcon(name, extraClass) {
      var path = UI_ICON_PATHS[name] || UI_ICON_PATHS.paperclip;
      return '<svg class="ui-icon ' + (extraClass || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
    }
    
    var STORAGE_KEY = 'scholarclaw_history';
    var MSG_KEY = 'scholarclaw_msgs_';
    var LIT_KEY = 'scholarclaw_lit_';
    var API_KEY = 'scholarclaw_api';
    var SECONDARY_VISION_API_KEY = 'scholarclaw_api_secondary_vision';
    var MODEL_KEY = 'scholarclaw_model';
    var USER_ID_KEY = 'scholarclaw_userid';
    var WEB_SEARCH_KEY = 'scholarclaw_websearch';
    var EMBEDDING_KEY = 'scholarclaw_embedding';
    var PDF_WIKI_LLM_KEY = 'scholarclaw_pdf_wiki_llm';
    var PDF_WIKI_TASK_OPTIONS_KEY = 'scholarclaw_pdf_wiki_task_options';
    var PDF_WIKI_TASK_OPTIONS_VERSION = 4;
    var THEME_KEY = 'scholarclaw_theme';
    var BRAND_TITLE_HTML = '<h1 class="brand-title">Scholar Harness</h1>';
    var GREETING_HTML = '<p class="typing-greeting"><span>你好！我是学术论文写作助手！</span></p>';
var CHAT_BRIDGE_KEY = 'scholarclaw_chat_bridge';
var OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';
var OPENROUTER_KEYS_URL = 'https://openrouter.ai/keys';
var QWEN_API_KEY_URL = 'https://bailian.console.aliyun.com/?apiKey=1#/api-key';
var QWEN_STANDARD_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
var QWEN_TOKEN_PLAN_API_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
var DEFAULT_EMBEDDING_API_URL = QWEN_STANDARD_API_URL;
var DEFAULT_EMBEDDING_MODEL = 'text-embedding-v4';
var DEFAULT_EMBEDDING_DIMENSIONS = 1024;
var DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL = 'qwen-long';
var DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL = 'qwen-max';
var DEFAULT_PDF_WIKI_QWEN_OCR_MODEL = 'qwen-vl-ocr';
var DEFAULT_PDF_WIKI_QWEN_VISION_MODEL = 'qwen-vl-max';
var DEFAULT_PDF_WIKI_QWEN_MODEL = DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL;
var AUTO_LITERATURE_CONTEXT_ENABLED = true;
var AUTO_RETRIEVAL_DETECTION_ENABLED = true;
var CHINA_AI_API_PROVIDERS = [
  {
    id: 'dashscope',
    name: '阿里云百炼/通义千问',
    apiUrl: QWEN_STANDARD_API_URL,
    applyUrl: QWEN_API_KEY_URL,
    docUrl: 'https://help.aliyun.com/zh/model-studio/get-api-key',
    modelHint: 'qwen-plus / qwen-max'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com',
    applyUrl: 'https://platform.deepseek.com/api_keys',
    docUrl: 'https://api-docs.deepseek.com/',
    modelHint: 'deepseek-v4-flash / deepseek-v4-pro'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4',
    applyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    docUrl: 'https://docs.bigmodel.cn/cn/guide/start/api-key',
    modelHint: 'glm-4.7 / glm-4-flash'
  },
  {
    id: 'moonshot',
    name: 'Kimi / Moonshot',
    apiUrl: 'https://api.moonshot.cn/v1',
    applyUrl: 'https://platform.moonshot.cn/console/api-keys',
    docUrl: 'https://platform.moonshot.cn/docs/introduction',
    modelHint: 'kimi-k2-0905-preview'
  },
  {
    id: 'volcengine',
    name: '火山方舟',
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    applyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    docUrl: 'https://www.volcengine.com/docs/82379',
    modelHint: 'doubao-*'
  },
  {
    id: 'baidu',
    name: '百度千帆',
    apiUrl: 'https://qianfan.baidubce.com/v2',
    applyUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application',
    docUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/index.html',
    modelHint: 'ernie-*'
  },
  {
    id: 'tencent',
    name: '腾讯混元',
    apiUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    applyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    docUrl: 'https://cloud.tencent.com/document/product/1729',
    modelHint: 'hunyuan-*'
  }
];
var SECONDARY_AI_API_PROVIDERS = CHINA_AI_API_PROVIDERS.reduce(function(providers, provider) {
  providers.push(provider);
  if (provider.id === 'dashscope') {
    providers.push({
      id: 'dashscope-token-plan',
      vendorId: 'dashscope',
      name: '阿里云百炼 Token Plan',
      apiUrl: QWEN_TOKEN_PLAN_API_URL,
      applyUrl: QWEN_API_KEY_URL,
      docUrl: 'https://help.aliyun.com/zh/model-studio/get-api-key',
      modelHint: 'Token Plan 套餐支持的模型',
      note: '已购买 Token Plan 套餐时使用；与普通百炼按量 API 地址并列保存。'
    });
  }
  return providers;
}, []);
function getDefaultEmbeddingConfig() {
  return {
    url: DEFAULT_EMBEDDING_API_URL,
    key: '',
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    enabled: true
  };
}
function normalizeEmbeddingConfig(config) {
  var defaults = getDefaultEmbeddingConfig();
  var normalized = Object.assign({}, defaults, config || {});
  if (typeof normalized.url === 'string') {
    normalized.url = normalized.url.trim();
  }
  if (!normalized.url || normalized.url === 'https://scholarharness.com/api/v1' || normalized.url === 'https://scholarharness.com/api/v1/') {
    normalized.url = DEFAULT_EMBEDDING_API_URL;
  }
  if (!normalized.model || normalized.model === 'text-embedding-3-small') {
    normalized.model = DEFAULT_EMBEDDING_MODEL;
  }
  normalized.dimensions = Number(normalized.dimensions) || DEFAULT_EMBEDDING_DIMENSIONS;
  normalized.enabled = normalized.enabled !== false;
  return normalized;
}
var chatBridgeConfig = { 
  enabled: false, 
  mode: 'api',
  // 大牛马配置（规划、Skill生成、质量检查）
  primary: {
    apiUrl: '',
    hasApiKey: false,
    model: 'claude-sonnet-4-5',
    description: '大牛马 - 规划、Skill生成、质量检查'
  },
  // 小牛马配置（执行写作、引用验证）
  secondary: {
    apiUrl: '',
    hasApiKey: false,
    model: 'gpt-4o',
    description: '小牛马 - 执行写作、引用验证'
  },
  secondaryVision: {
    apiUrl: '',
    hasApiKey: false,
    model: 'gpt-4o',
    description: '小牛马视觉 - 图片、图表截图、多模态输入'
  },
  codex: {
    enabled: false,
    prefer: false,
    command: '',
    model: 'gpt-5.5',
    reasoning_effort: 'xhigh',
    sandbox: 'workspace-write',
    pdf_wiki_sandbox: 'danger-full-access',
    timeout_ms: 300000,
    pdf_wiki_concurrency: 1
  },
  // 旧字段（向后兼容）
  chatUrl: '',
  apiUrl: '',
  hasApiKey: false,
  useForChat: false,
  credentials: { email: '', has_password: false }
};
var chatBridgeState = { paused: false, currentUrl: null, hasActivePage: false, serviceRunning: false };
    var contextEstablished = false;

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('app-core', { source: '/app/app-core.js' });
}
