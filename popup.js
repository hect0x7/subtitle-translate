/**
 * YouTube 双语字幕 - Popup 逻辑
 */

document.addEventListener('DOMContentLoaded', async () => {
    // ============ 元素引用 ============
    const toggleEnabled = document.getElementById('toggle-enabled');
    const statusBar = document.getElementById('status-bar');
    const fontSizeGroup = document.getElementById('font-size-group');
    const styleGroup = document.getElementById('style-group');
    const sourceLang = document.getElementById('source-lang');
    const targetLang = document.getElementById('target-lang');
    const colorPresets = document.getElementById('color-presets');
    const customColor = document.getElementById('custom-color');
    const bgOpacity = document.getElementById('bg-opacity');
    const opacityValue = document.getElementById('opacity-value');
    const transFontFamily = document.getElementById('trans-font-family');
    const transFontSize = document.getElementById('trans-font-size');
    const transSizeValue = document.getElementById('trans-size-value');
    const fontWeightGroup = document.getElementById('font-weight-group');

    // ============ 加载保存的设置 ============
    const settings = await chrome.storage.sync.get({
        enabled: true,
        fontSize: 'medium',
        style: 'immersive',
        sourceLang: 'en',
        targetLang: 'zh-CN',
        translatedColor: '#ffffff',
        bgOpacity: 0.78,
        transFontFamily: '',
        transFontSize: 0,
        transFontWeight: '400',
    });

    // 应用设置到 UI
    toggleEnabled.checked = settings.enabled;
    updateStatusBar(settings.enabled);

    setActiveButton(fontSizeGroup, settings.fontSize);
    setActiveButton(styleGroup, settings.style);
    sourceLang.value = settings.sourceLang;
    targetLang.value = settings.targetLang;
    setActiveColorSwatch(settings.translatedColor);
    customColor.value = settings.translatedColor;

    bgOpacity.value = Math.round(settings.bgOpacity * 100);
    opacityValue.textContent = `${Math.round(settings.bgOpacity * 100)}%`;

    transFontFamily.value = settings.transFontFamily;

    transFontSize.value = settings.transFontSize;
    transSizeValue.textContent = settings.transFontSize > 0 ? `${settings.transFontSize}px` : '跟随预设';

    setActiveButton(fontWeightGroup, settings.transFontWeight);

    // ============ 事件监听 ============

    // 启用/禁用
    toggleEnabled.addEventListener('change', async () => {
        const enabled = toggleEnabled.checked;
        await chrome.storage.sync.set({ enabled });
        updateStatusBar(enabled);

        // 通知 content script
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
                type: 'TOGGLE',
                enabled,
            }).catch(() => { });
        }
    });

    // 字体大小
    fontSizeGroup.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-option');
        if (!btn) return;
        const value = btn.dataset.value;
        setActiveButton(fontSizeGroup, value);
        await chrome.storage.sync.set({ fontSize: value });
        previewStyle({ fontSize: value });
    });

    // 显示风格
    styleGroup.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-option');
        if (!btn) return;
        const value = btn.dataset.value;
        setActiveButton(styleGroup, value);
        await chrome.storage.sync.set({ style: value });
        previewStyle({ style: value });
    });

    // 源语言
    sourceLang.addEventListener('change', async () => {
        await chrome.storage.sync.set({ sourceLang: sourceLang.value });
    });

    // 目标语言
    targetLang.addEventListener('change', async () => {
        await chrome.storage.sync.set({ targetLang: targetLang.value });
    });

    // 译文颜色预设
    colorPresets.addEventListener('click', async (e) => {
        const swatch = e.target.closest('.color-swatch');
        if (!swatch) return;
        const color = swatch.dataset.color;
        setActiveColorSwatch(color);
        customColor.value = color;
        await chrome.storage.sync.set({ translatedColor: color });
        previewStyle({ translatedColor: color });
    });

    // 自定义颜色
    customColor.addEventListener('input', () => {
        const color = customColor.value;
        setActiveColorSwatch(color);
        previewStyle({ translatedColor: color });
    });
    customColor.addEventListener('change', async () => {
        await chrome.storage.sync.set({ translatedColor: customColor.value });
    });

    // 背景不透明度
    bgOpacity.addEventListener('input', () => {
        const val = parseInt(bgOpacity.value);
        opacityValue.textContent = `${val}%`;
        previewStyle({ bgOpacity: val / 100 });
    });
    bgOpacity.addEventListener('change', async () => {
        await chrome.storage.sync.set({ bgOpacity: parseInt(bgOpacity.value) / 100 });
    });

    // 译文字体
    transFontFamily.addEventListener('change', async () => {
        await chrome.storage.sync.set({ transFontFamily: transFontFamily.value });
        previewStyle({ transFontFamily: transFontFamily.value });
    });

    // 译文字号
    transFontSize.addEventListener('input', () => {
        const val = parseInt(transFontSize.value);
        transSizeValue.textContent = val > 0 ? `${val}px` : '跟随预设';
        previewStyle({ transFontSize: val });
    });
    transFontSize.addEventListener('change', async () => {
        await chrome.storage.sync.set({ transFontSize: parseInt(transFontSize.value) });
    });

    // 译文字重
    fontWeightGroup.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-option');
        if (!btn) return;
        const value = btn.dataset.value;
        setActiveButton(fontWeightGroup, value);
        await chrome.storage.sync.set({ transFontWeight: value });
        previewStyle({ transFontWeight: value });
    });

    // ============ 辅助函数 ============

    function setActiveButton(group, value) {
        group.querySelectorAll('.btn-option').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.value === value);
        });
    }

    function updateStatusBar(enabled) {
        const dot = statusBar.querySelector('.status-dot');
        const text = statusBar.querySelector('.status-text');
        dot.classList.toggle('active', enabled);
        text.textContent = enabled ? '已启用' : '已禁用';
    }

    function setActiveColorSwatch(color) {
        colorPresets.querySelectorAll('.color-swatch').forEach((s) => {
            s.classList.toggle('active', s.dataset.color === color);
        });
    }

    // 发送实时预览样式（不会触发 storage 写入配额限制）
    function previewStyle(styleObj) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'PREVIEW_STYLE',
                    style: styleObj
                }).catch(() => { });
            }
        });
    }
});
