// Aggregates repeated results from different sources into one playable candidate.
(function () {
    const TITLE_NOISE = [
        /(?:第[一二三四五六七八九十\d]+季)$/u,
        /(?:全集|全\d+集|更新至\d+集|完结|高清|正片|国语|粤语|中字|蓝光|超清)$/gu
    ];

    function normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[【】\[\]（）()《》<>:：·,，.。!！?？\s_-]+/g, '')
            .trim();
    }

    function normalizeTitle(title) {
        let output = String(title || '').trim();
        TITLE_NOISE.forEach((pattern) => {
            output = output.replace(pattern, '');
        });
        return normalizeText(output || title);
    }

    function getYear(item) {
        const direct = String(item?.vod_year || '').match(/\d{4}/);
        if (direct) return direct[0];
        const text = [item?.vod_name, item?.vod_remarks, item?.vod_content].filter(Boolean).join(' ');
        const fallback = text.match(/\b(19\d{2}|20\d{2})\b/);
        return fallback ? fallback[0] : '';
    }

    function getResultKey(item) {
        const title = normalizeTitle(item?.vod_name);
        const year = getYear(item);
        const type = normalizeText(item?.type_name || '');
        return `${title}|${year}|${type}`;
    }

    function getLineScore(item, sourcePlanMap) {
        const sourceCode = item?.source_code || '';
        const planScore = sourcePlanMap?.get(sourceCode)?.score;
        let score = typeof planScore === 'number' ? planScore : 0;
        if (item?.vod_pic) score += 3;
        if (item?.vod_year) score += 2;
        if (item?.vod_remarks) score += 1;
        return score;
    }

    function mergeResultItem(base, item, sourcePlanMap) {
        const line = {
            vod_id: item.vod_id,
            vod_name: item.vod_name,
            source_code: item.source_code,
            source_name: item.source_name,
            api_url: item.api_url,
            score: getLineScore(item, sourcePlanMap)
        };

        const existingLine = base.source_lines.find((candidate) => (
            candidate.source_code === line.source_code && String(candidate.vod_id) === String(line.vod_id)
        ));
        if (!existingLine) base.source_lines.push(line);

        const bestLine = base.source_lines.slice().sort((a, b) => b.score - a.score)[0];
        const bestSourceItem = bestLine && bestLine.source_code === item.source_code && String(bestLine.vod_id) === String(item.vod_id)
            ? item
            : base;

        base.source_count = base.source_lines.length;
        base.source_name = bestLine?.source_name || base.source_name;
        base.source_code = bestLine?.source_code || base.source_code;
        base.vod_id = bestLine?.vod_id || base.vod_id;
        base.api_url = bestLine?.api_url || base.api_url;

        if (!base.vod_pic && item.vod_pic) base.vod_pic = item.vod_pic;
        if (!base.vod_year && item.vod_year) base.vod_year = item.vod_year;
        if (!base.type_name && item.type_name) base.type_name = item.type_name;
        if ((!base.vod_remarks || base.vod_remarks === '暂无介绍') && item.vod_remarks) base.vod_remarks = item.vod_remarks;

        if (bestSourceItem !== base) {
            base.vod_name = bestSourceItem.vod_name || base.vod_name;
        }

        return base;
    }

    function aggregateResults(items, sourcePlan = []) {
        const sourcePlanMap = new Map((Array.isArray(sourcePlan) ? sourcePlan : []).map((item) => [item.sourceKey, item]));
        const grouped = new Map();

        (Array.isArray(items) ? items : []).forEach((item) => {
            if (!item || !item.vod_name || !item.vod_id || !item.source_code) return;
            const key = getResultKey(item);
            if (!key || key.startsWith('|')) return;

            if (!grouped.has(key)) {
                grouped.set(key, {
                    ...item,
                    aggregate_key: key,
                    source_lines: [],
                    source_count: 0
                });
            }
            mergeResultItem(grouped.get(key), item, sourcePlanMap);
        });

        return Array.from(grouped.values()).sort((a, b) => {
            const lineDelta = (b.source_count || 0) - (a.source_count || 0);
            if (lineDelta !== 0) return lineDelta;
            return String(a.vod_name || '').localeCompare(String(b.vod_name || ''));
        });
    }

    window.OpenStreamResultAggregator = {
        aggregateResults,
        normalizeTitle,
        getResultKey
    };
})();
