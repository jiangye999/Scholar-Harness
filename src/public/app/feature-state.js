    var pdfWikiViewerData = null;
    var pdfWikiViewerCacheScope = '';
    var pdfWikiViewerCachedAt = 0;
    var pdfWikiViewerFullRefreshPromise = null;
    var pdfWikiViewerReturnTarget = '';
    var pdfWikiViewerReturnState = null;
    var pdfWikiWorkspaceMode = 'claims';
    var pdfWikiSelectedEntryIds = {};
    var pdfWikiActiveEntryId = null;
    var pdfWikiSelectedSentencePointIds = {};
    var pdfWikiActiveSentencePointId = null;
    var pdfWikiSentenceViewMode = 'list';
    var pdfWikiNetworkRuntime = null;
    var PDF_WIKI_PDF_FAVORITES_GROUP_ID = '__favorites__';
    var pdfWikiPdfManagerData = null;
    var pdfWikiPdfManagerCacheScope = '';
    var pdfWikiPdfManagerSelectedGroupId = 'all';
    var pdfWikiPdfManagerSearchTerm = '';
    var pdfWikiPdfManagerSearchInputValue = '';
    var pdfWikiPdfManagerSearchComposing = false;
    var pdfWikiPdfManagerSearchTimer = null;
    var PDF_WIKI_PDF_MANAGER_SEARCH_DELAY_MS = 1200;
    var pdfWikiPdfManagerAutoGroupNotice = '';
    var pdfWikiPdfManagerAutoGroupNoticeTimer = null;
    var pdfWikiPendingRenameGroupId = '';
    var pdfWikiDeepAnalysisResults = {};
    var pdfWikiSelectedPdfIds = {};
    var pdfWikiBatchReidentifyRunning = false;
    var pdfWikiRecognitionQueueSnapshot = null;
    var pdfWikiRecognitionQueuePollTimer = null;
    var pdfWikiRecognitionQueueTrackedJobIds = [];
    var pdfWikiRecognitionQueueCompletionLabel = '';
    var pdfWikiRecognitionQueueLastCompletionKey = '';
    var pdfWikiManagerUploadRunning = false;
    var pdfWikiManagerUploadProgress = null;
    var pdfWikiManagerUploadClearTimer = null;
    var pdfWikiDeepAnalysisCollapsed = {};
    var pdfWikiInlineSvgRenderSeq = 0;
    var pdfWikiOriginalReaderPdfId = null;
    var pdfWikiOriginalReaderPdfDoc = null;
    var pdfWikiOriginalReaderPdfViewer = null;
    var pdfWikiOriginalReaderEventBus = null;
    var pdfWikiOriginalReaderRenderToken = 0;
    var pdfWikiOriginalReaderCurrentPage = 1;
    var pdfWikiOriginalReaderScale = 1;
    var pdfWikiReaderAiEnabled = false;
    var pdfWikiReaderAiTimer = null;
    var pdfWikiReaderLastAiText = '';
    var pdfWikiReaderSelectionHandler = null;
    var pdfWikiReaderPendingSelectionTimer = null;
    var pdfWikiReaderPendingSelectionTimers = [];
    var pdfWikiReaderSentenceSelectEnabled = true;
    var pdfWikiReaderSentenceListRenderedPage = 0;
    var pdfWikiReaderSelectedSentenceId = '';
    var pdfWikiReaderSidebarWidth = 360;
    var pdfWikiReaderLayoutResizeHandler = null;
    var pdfWikiReaderFitWidthTimer = null;
    var pdfWikiReaderFitWidthInFlight = false;
    var pdfWikiReaderFitWidthPending = false;
    var pdfWikiReaderItemFilter = 'all';
    var pdfWikiReaderItemSearchTerm = '';
    var pdfWikiReaderChatHistory = [];
    var pdfWikiReaderChatSending = false;
    var pdfWikiReaderChatExpanded = false;
    var pdfWikiReaderChatLoadToken = 0;
    var pdfWikiReaderExternalChatPdfId = null;
    var pdfWikiReaderChatProvider = 'secondary';
    var pdfWikiReaderChatPendingLog = null;
    var pdfWikiReaderChatPendingTimer = null;
    var pdfWikiReaderChatScrollAnchor = null;
    var activePdfPaperChatContext = null;
    var pdfPaperChatReturnContext = null;
    var pdfPaperChatContextCache = Object.create(null);
    var pdfWikiReaderToolPanels = {
      settings: false,
      source: true,
      selection: true,
      save: false,
      ai: false,
      notes: false
    };
    var pdfWikiReaderMentionState = {
      inputId: '',
      source: '',
      startPos: -1,
      activeIndex: 0,
      items: []
    };
    var pdfWikiReaderSectionByPage = {};
    var pdfWikiReaderLastKnownSection = '';
    var pdfWikiBatchDeepAnalysisRunning = false;
    var pdfWikiMetaDatabaseData = null;
    var pdfWikiMetaDatabaseCacheByScope = {};
    var pdfWikiMetaDetailCacheByScope = {};
    var pdfWikiMetaDetailRequests = {};
    var pdfWikiMetaTemplateStatusCacheByScope = {};
    var pdfWikiMetaTemplateStatusRequests = {};
    var pdfWikiMetaSelectedPdfId = null;
    var pdfWikiMetaRenderedSelectedPdfId = null;
    var pdfWikiMetaSearchTerm = '';
    var pdfWikiMetaListScrollTop = 0;
    var pdfWikiMetaSelectedDataPdfIds = {};
    var pdfWikiMetaSelectedCodingRows = {};
    var pdfWikiMetaSelectedCodingColumns = {};
    var pdfWikiMetaCodingTableEditMode = {};
    var pdfWikiMetaCodingTableSaving = false;
    var pdfWikiMetaDigitizationPanelExpanded = {};
    var pdfWikiMetaExtractionRunning = false;
    var pdfWikiMetaExtractionProgress = null;
    var pdfWikiMetaWorkerTypewriterState = {};
    var pdfWikiMetaWorkerTypewriterTimer = null;
    var pdfWikiMetaElapsedTimer = null;
    var pdfWikiMetaAnalysisInspectData = null;
    var pdfWikiMetaAnalysisTargetPdfIds = [];
    var pdfWikiMetaAnalysisLastRun = null;
    var pdfWikiMetaAnalysisAiPlanLast = null;
    var pdfWikiMetaAnalysisConversationId = '';
    var pdfWikiMetaAnalysisChatHistory = [];
    var pdfWikiMetaAnalysisRecentQueries = [];
    var pdfWikiMetaAnalysisAiAbortController = null;
    var pdfWikiMetaPiQueueBehavior = localStorage.getItem('scholarharness_meta_pi_queue_behavior') === 'steer' ? 'steer' : 'follow_up';
    var pdfWikiMetaPiState = null;
    var pdfWikiMetaPiPollTimer = null;
    var pdfWikiMetaPiSyncInFlight = false;
    var pdfWikiMetaPiClaimInFlight = false;
    var pdfWikiMetaPiContinuationStarting = false;
    var pdfWikiMetaPiQueueHostMessage = null;
    var pdfWikiMetaAnalysisManualModeOpen = false;
    var pdfWikiMetaAnalysisTypeTimer = null;
    var pdfWikiMetaAnalysisTypeQueue = [];
    var pdfWikiMetaAiPendingLogTimer = null;
    var pdfWikiMetaAiPendingElapsedTimer = null;
    var pdfWikiMetaAiPendingTypeTimer = null;
    var pdfWikiMetaAiPendingStartedAt = 0;
    var pdfWikiMetaAiPendingSteps = [];
    var pdfWikiMetaSharedComposerBorrowedNodes = [];
    var PDF_WIKI_META_AI_HISTORY_KEY = 'pdfWikiMetaAnalysisAiConversationHistory';
    var PDF_WIKI_META_REQUIREMENTS_KEY = 'pdfWikiMetaAnalysisUserRequirements';
    var PDF_WIKI_META_TEMPLATE_COLLAPSED_KEY = 'pdfWikiMetaTemplatePanelCollapsed';
    var pendingPdfWikiDigitizationImport = null;
    var pendingPdfWikiDigitizationFile = null;
    var pdfWikiDigitizationEvidenceSaved = false;
    var pdfWikiDigitizationCurrentPdfId = '';
    var pdfWikiDigitizationPendingValues = [];
    var pdfWikiDigitizationPendingValueSelection = {};
    var pdfWikiDigitizationTargetCell = null;
    var pdfWikiDigitizationFrozenColumns = {};
    var pdfWikiDigitizationHiddenColumns = {};
    var pdfWikiDigitizationHideColumnSelection = {};
    var pdfWikiGetDataAutoDetectTimer = null;
    var pdfWikiInternalDigitizerState = null;
    var autoResearchData = null;
    var autoResearchRunState = null;
    var autoResearchProgressPoller = null;
    var autoResearchTypewriterQueue = [];
    var autoResearchTypewriterTimer = null;
    var autoResearchCompletedTasksCollapsed = false;
    var autoResearchCompletedTaskSelection = {};
    var autoResearchCompletedTaskDeleting = false;
    var academicWorkflowOpenedFromOverview = false;
    var overviewData = null;
    var overviewChatHistory = [];
    var overviewChatBusy = false;
    var overviewChatScrollAnchor = null;

if (window.ScholarHarnessModules) {
  window.ScholarHarnessModules.register('feature-state', { source: '/app/feature-state.js' });
}
