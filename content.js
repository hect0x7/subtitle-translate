/**
 * YouTube 双语字幕 Content Script
 * 拦截 YouTube 原生字幕，叠加中文翻译，实现双语显示
 */

(function () {
    'use strict';

    // ============ 配置 ============
    const CONFIG = {
        enabled: true,
        sourceLang: 'en',
        targetLang: 'zh-CN',
        fontSize: 'medium',     // small, medium, large
        opacity: 0.9,
        position: 'bottom',     // bottom, top
        style: 'immersive',     // immersive, classic
        translatedColor: '#ffffff',
        bgOpacity: 0.78,
        transFontFamily: '',       // 留空 = 跟随默认
        transFontSize: 0,          // 0 = 跟随预设档位
        transFontWeight: '400',    // 100-900
    };

    // ============ 状态 ============
    let isInitialized = false;
    let subtitleContainer = null;
    let observer = null;
    let currentVideoId = null;
    let lastOriginalText = '';
    let translationInProgress = false;
    let debounceTimer = null;
    const DEBOUNCE_MS = 100; // 防抖间隔（增加至100ms抵消原生字幕短时闪烁）
    let isSelfMutation = false; // 标记是否是自身触发的 DOM 变更

    // ============ 翻译预热缓存 ============
    // 当前正在翻译的文本，用于去重
    let pendingTranslation = null;

    // ============ 初始化 ============

    /**
     * 从 storage 加载用户设置
     */
    async function loadSettings() {
        try {
            const result = await chrome.storage.sync.get(CONFIG);
            Object.assign(CONFIG, result);
        } catch (e) {
            console.log('[BiSub] Using default settings');
        }
    }

    /**
     * 监听设置变更
     */
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') {
            for (const [key, { newValue }] of Object.entries(changes)) {
                if (key in CONFIG) {
                    CONFIG[key] = newValue;
                }
            }
            if (changes.enabled) {
                if (CONFIG.enabled) {
                    init();
                } else {
                    destroy();
                }
                // enabled 变更时不需要 applyStyles（init/destroy 会处理）
                return;
            }
            // 实时更新样式变量（仅非 enabled 变更时）
            applyStyles();
        }
    });

    /**
     * 主入口 - 初始化插件
     */
    async function init() {
        if (isInitialized) return;

        await loadSettings();
        if (!CONFIG.enabled) return;

        console.log('[BiSub] YouTube Bilingual Subtitles initializing...');

        // 等待 YouTube 播放器加载
        waitForPlayer().then((player) => {
            createSubtitleContainer();
            startSubtitleObserver();
            // 立即隐藏原始字幕（通过在播放器级别添加 class，防止新字幕出现时闪现）
            showOriginalSubtitles(false);
            // 监听全屏变化，重新应用字体缩放
            document.addEventListener('fullscreenchange', applyStyles);
            isInitialized = true;
            console.log('[BiSub] Initialized successfully!');
        });
    }

    /**
     * 销毁插件
     */
    function destroy() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (subtitleContainer) {
            subtitleContainer.remove();
            subtitleContainer = null;
        }
        document.removeEventListener('fullscreenchange', applyStyles);
        // 恢复原始字幕的可见性
        showOriginalSubtitles(true);
        isInitialized = false;
        console.log('[BiSub] Destroyed');
    }

    // ============ DOM 操作 ============

    /**
     * 等待 YouTube 播放器加载完成
     */
    function waitForPlayer() {
        return new Promise((resolve) => {
            const check = () => {
                const player = document.querySelector('#movie_player');
                if (player) {
                    resolve(player);
                } else {
                    setTimeout(check, 500);
                }
            };
            check();
        });
    }

    /**
     * 创建双语字幕容器
     */
    function createSubtitleContainer() {
        // 移除旧容器
        const existing = document.querySelector('#bisub-container');
        if (existing) existing.remove();

        subtitleContainer = document.createElement('div');
        subtitleContainer.id = 'bisub-container';
        subtitleContainer.className = `bisub-${CONFIG.style} bisub-size-${CONFIG.fontSize}`;

        subtitleContainer.innerHTML = `
      <div class="bisub-original"></div>
      <div class="bisub-translated"></div>
    `;

        // 插入到播放器的字幕层
        const player = document.querySelector('#movie_player');
        if (player) {
            player.appendChild(subtitleContainer);
        }

        // 应用所有样式变量
        applyStyles();
    }

    /**
     * 统一应用所有 CSS 变量样式
     */
    function applyStyles() {
        if (!subtitleContainer) return;

        // 检测是否全屏
        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        const FULLSCREEN_SCALE = 1.35;

        // 更新 class
        subtitleContainer.className = `bisub-${CONFIG.style} bisub-size-${CONFIG.fontSize}`;

        // CSS 变量
        const s = subtitleContainer.style;
        s.setProperty('--bisub-translated-color', CONFIG.translatedColor);
        s.setProperty('--bisub-bg-opacity', CONFIG.bgOpacity);

        // 背景透明度
        s.background = `rgba(0, 0, 0, ${CONFIG.bgOpacity})`;

        // 译文自定义字体
        const transEl = subtitleContainer.querySelector('.bisub-translated');
        if (transEl) {
            transEl.style.fontFamily = CONFIG.transFontFamily || '';
            transEl.style.fontWeight = CONFIG.transFontWeight || '';

            // 字号：全屏时自动缩放
            if (CONFIG.transFontSize > 0) {
                const size = isFullscreen
                    ? Math.round(CONFIG.transFontSize * FULLSCREEN_SCALE)
                    : CONFIG.transFontSize;
                transEl.style.fontSize = `${size}px`;
            } else {
                transEl.style.fontSize = '';
            }
        }
    }

    /**
     * 控制原始字幕的显示/隐藏
     * 通过添加/移除 CSS class 来控制（配合 !important 规则）
     */
    function showOriginalSubtitles(show) {
        const player = document.querySelector('#movie_player');
        if (!player) return;

        if (show) {
            player.classList.remove('bisub-hide-original');
        } else {
            player.classList.add('bisub-hide-original');
        }
    }

    // ============ 语言检测 ============

    /**
     * 检测文本是否已经是目标语言
     * 根据 CONFIG.targetLang 动态匹配对应语言的 Unicode 字符范围
     * 对于共用拉丁字母的语言（英/法/德/西等）无法检测，返回 false
     */
    function isTargetLanguage(text) {
        // 各语言对应的独立文字 Unicode 范围
        const SCRIPT_PATTERNS = {
            'zh': /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g,  // CJK 汉字
            'ja': /[\u3040-\u309f\u30a0-\u30ff]/g,                // 平假名 + 片假名
            'ko': /[\uac00-\ud7af\u1100-\u11ff]/g,                // 韩文
            'ar': /[\u0600-\u06ff]/g,                              // 阿拉伯文
            'he': /[\u0590-\u05ff]/g,                              // 希伯来文
            'th': /[\u0e00-\u0e7f]/g,                              // 泰文
            'hi': /[\u0900-\u097f]/g,                              // 印地文 (天城文)
            'ru': /[\u0400-\u04ff]/g,                              // 俄文 (西里尔)
            'uk': /[\u0400-\u04ff]/g,                              // 乌克兰文 (西里尔)
            'el': /[\u0370-\u03ff]/g,                              // 希腊文
        };

        // 取语言代码的基础部分 (如 zh-CN → zh)
        const langBase = CONFIG.targetLang.toLowerCase().split('-')[0];
        const pattern = SCRIPT_PATTERNS[langBase];

        // 拉丁字母语言无法通过字符检测，直接跳过
        if (!pattern) return false;

        // 去除空格、标点和数字后检测
        const cleaned = text.replace(/[\s\p{P}\d]/gu, '');
        if (cleaned.length === 0) return false;

        const matches = cleaned.match(pattern);
        const matchCount = matches ? matches.length : 0;
        const ratio = matchCount / cleaned.length;

        // 目标语言字符占比 >= 30% 则判定字幕已经是目标语言
        return ratio >= 0.3;
    }

    // ============ 字幕监听 ============

    /**
     * 启动字幕 MutationObserver，监听 YouTube 原生字幕变化
     */
    function startSubtitleObserver() {
        // 监听字幕容器的变化
        const targetNode = document.querySelector('#movie_player');
        if (!targetNode) return;

        observer = new MutationObserver((mutations) => {
            // 跳过自身触发的 DOM 变更
            if (isSelfMutation) return;

            // 只关心字幕相关的变化，忽略其他（如进度条等）
            const isSubtitleRelated = mutations.some(m => {
                const target = m.target;
                if (!target) return false;
                const el = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
                if (!el) return false;
                // 只关心字幕容器内的变化
                return el.closest('.captions-text') ||
                    el.classList?.contains('captions-text') ||
                    el.closest('.caption-window');
            });

            if (!isSubtitleRelated) return;

            // 防抖：合并短时间内的多次变化
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(handleSubtitleChange, DEBOUNCE_MS);
        });

        observer.observe(targetNode, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        // 同时监听 URL 变化（切换视频）
        monitorVideoChange();

        // 初始检查一次
        handleSubtitleChange();
    }

    /**
     * 监控视频切换
     */
    function monitorVideoChange() {
        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                onVideoChange();
            }
        });
        urlObserver.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * 视频切换时重置状态
     */
    function onVideoChange() {
        lastOriginalText = '';
        translationInProgress = false;
        pendingTranslation = null;
        TranslateService.clearCache();
        // 重新创建容器（因为播放器可能重建了）
        setTimeout(() => {
            createSubtitleContainer();
        }, 1000);
    }

    /**
     * 处理字幕变化
     */
    function handleSubtitleChange() {
        if (!CONFIG.enabled || !subtitleContainer) return;

        // 获取 YouTube 原生字幕文本
        const captionSegments = document.querySelectorAll(
            '.captions-text .caption-visual-line .ytp-caption-segment'
        );

        if (captionSegments.length === 0) {
            // 没有字幕显示时，隐藏我们的容器，并清空旧文本防止残影
            isSelfMutation = true;
            subtitleContainer.classList.remove('bisub-active');
            const translatedEl = subtitleContainer.querySelector('.bisub-translated');
            if (translatedEl) {
                translatedEl.textContent = '\u00A0'; // 用透明空格占位，防止容器高度跳闪
                translatedEl.classList.remove('bisub-loading');
            }
            lastOriginalText = '';
            isSelfMutation = false;
            return;
        }

        // 提取原始字幕文本
        const originalText = Array.from(captionSegments)
            .map(seg => seg.textContent)
            .join(' ')
            .trim();

        if (!originalText || originalText === lastOriginalText) return;
        lastOriginalText = originalText;

        // 检测字幕是否已经是目标语言（中文），如果是则跳过翻译
        if (isTargetLanguage(originalText)) {
            // 字幕已经是中文，显示原始字幕，隐藏翻译容器
            showOriginalSubtitles(true);
            isSelfMutation = true;
            subtitleContainer.classList.remove('bisub-active');
            isSelfMutation = false;
            return;
        }

        // 确保原始字幕已隐藏
        showOriginalSubtitles(false);

        // 标记自身变更，避免 observer 循环
        isSelfMutation = true;

        // 显示我们的容器
        subtitleContainer.classList.add('bisub-active');

        // 更新原文
        const originalEl = subtitleContainer.querySelector('.bisub-original');
        originalEl.textContent = originalText;

        // 翻译并显示（立即开始，不等待）
        translateAndShow(originalText);

        isSelfMutation = false;
    }

    /**
     * 翻译文本并显示
     */
    async function translateAndShow(text) {
        const translatedEl = subtitleContainer.querySelector('.bisub-translated');

        // 记录当前正在翻译的文本，用于取消过期请求
        pendingTranslation = text;

        // 如果缓存中有，直接显示（0 延迟）
        const cached = TranslateService.getFromCache(text, CONFIG.sourceLang, CONFIG.targetLang);
        if (cached) {
            isSelfMutation = true;
            translatedEl.textContent = cached;
            translatedEl.classList.remove('bisub-loading');
            isSelfMutation = false;
            return;
        }

        // 没有缓存 → 保留上次译文，或用全角空格占位维持高度
        isSelfMutation = true;
        if (!translatedEl.textContent || translatedEl.textContent.trim() === '' || translatedEl.textContent === '翻译失败') {
            translatedEl.textContent = '...';
        }
        isSelfMutation = false;

        try {
            const translated = await TranslateService.translate(
                text,
                CONFIG.sourceLang,
                CONFIG.targetLang
            );

            // 确保这仍然是当前的字幕（避免异步竞争）
            if (text === pendingTranslation) {
                isSelfMutation = true;
                translatedEl.textContent = translated || '...';
                translatedEl.classList.remove('bisub-loading');
                isSelfMutation = false;
            }
        } catch (error) {
            console.error('[BiSub] Translation failed:', error);
            if (text === pendingTranslation) {
                isSelfMutation = true;
                translatedEl.textContent = '翻译失败';
                translatedEl.classList.remove('bisub-loading');
                isSelfMutation = false;
            }
        }
    }

    // ============ 启动 ============

    // YouTube 是 SPA，需要在页面导航时重新初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 监听来自 popup 的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'TOGGLE') {
            CONFIG.enabled = message.enabled;
            if (CONFIG.enabled) {
                init();
            } else {
                destroy();
            }
            sendResponse({ success: true });
        } else if (message.type === 'GET_STATUS') {
            sendResponse({
                enabled: CONFIG.enabled,
                initialized: isInitialized,
            });
        } else if (message.type === 'PREVIEW_STYLE') {
            // 实时预览样式（不保存到 storage）
            Object.assign(CONFIG, message.style);
            applyStyles();
            sendResponse({ success: true });
        }
        return true;
    });
})();
