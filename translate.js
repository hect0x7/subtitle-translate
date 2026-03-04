/**
 * Google Translate 免费 API 翻译服务
 * 使用 Google Translate 的非官方 API（不需要 API Key）
 */

const TranslateService = (() => {
  // 翻译缓存，避免重复请求
  const cache = new Map();
  const MAX_CACHE_SIZE = 2000;

  // 请求队列和节流
  let pendingRequests = new Map();
  const BATCH_DELAY = 100; // ms
  let batchTimer = null;

  /**
   * 翻译单条文本
   * @param {string} text - 要翻译的文本
   * @param {string} from - 源语言 (默认 'en')
   * @param {string} to - 目标语言 (默认 'zh-CN')
   * @returns {Promise<string>} 翻译结果
   */
  async function translate(text, from = 'en', to = 'zh-CN') {
    if (!text || !text.trim()) return '';

    const cacheKey = `${from}:${to}:${text}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    try {
      const result = await callGoogleTranslate(text, from, to);
      // 管理缓存大小
      if (cache.size >= MAX_CACHE_SIZE) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      cache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error('[BiSub] Translation error:', error);
      return '';
    }
  }

  /**
   * 批量翻译多条文本
   * @param {string[]} texts - 要翻译的文本数组
   * @param {string} from - 源语言
   * @param {string} to - 目标语言
   * @returns {Promise<string[]>} 翻译结果数组
   */
  async function translateBatch(texts, from = 'en', to = 'zh-CN') {
    const results = new Array(texts.length).fill('');
    const uncachedIndices = [];
    const uncachedTexts = [];

    // 检查缓存
    texts.forEach((text, index) => {
      if (!text || !text.trim()) return;
      const cacheKey = `${from}:${to}:${text}`;
      if (cache.has(cacheKey)) {
        results[index] = cache.get(cacheKey);
      } else {
        uncachedIndices.push(index);
        uncachedTexts.push(text);
      }
    });

    if (uncachedTexts.length === 0) return results;

    // 将未缓存的文本分批翻译（Google Translate 有长度限制）
    const BATCH_SIZE = 10;
    for (let i = 0; i < uncachedTexts.length; i += BATCH_SIZE) {
      const batch = uncachedTexts.slice(i, i + BATCH_SIZE);
      const batchIndices = uncachedIndices.slice(i, i + BATCH_SIZE);

      try {
        // 用换行符连接，方便一次请求翻译多条
        const combined = batch.join('\n');
        const translated = await callGoogleTranslate(combined, from, to);
        const translatedLines = translated.split('\n');

        translatedLines.forEach((line, j) => {
          if (j < batchIndices.length) {
            results[batchIndices[j]] = line.trim();
            const cacheKey = `${from}:${to}:${batch[j]}`;
            if (cache.size >= MAX_CACHE_SIZE) {
              const firstKey = cache.keys().next().value;
              cache.delete(firstKey);
            }
            cache.set(cacheKey, line.trim());
          }
        });
      } catch (error) {
        console.error('[BiSub] Batch translation error:', error);
      }
    }

    return results;
  }

  /**
   * 调用 Google Translate 免费 API
   */
  async function callGoogleTranslate(text, from, to) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status}`);
    }

    const data = await response.json();

    // 解析 Google Translate 返回的数据格式
    // 格式: [[["翻译结果","原文",null,null,10]],null,"en"]
    if (data && data[0]) {
      return data[0]
        .filter(item => item && item[0])
        .map(item => item[0])
        .join('');
    }

    return '';
  }

  /**
   * 清除缓存
   */
  function clearCache() {
    cache.clear();
  }

  /**
   * 同步获取缓存中的翻译（不发起请求）
   */
  function getFromCache(text, from = 'en', to = 'zh-CN') {
    if (!text || !text.trim()) return '';
    const cacheKey = `${from}:${to}:${text}`;
    return cache.has(cacheKey) ? cache.get(cacheKey) : null;
  }

  return {
    translate,
    translateBatch,
    clearCache,
    getFromCache
  };
})();
