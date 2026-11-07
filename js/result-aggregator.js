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

    function normalizeType(item) {
        const text = normalizeText([
            item?.type_name,
            item?.vod_class,
            item?.vod_type
        ].filter(Boolean).join(' '));
        if (/动漫|动画|anime/.test(text)) return 'anime';
        if (/综艺|真人秀|脱口秀|访谈/.test(text)) return 'variety';
        if (/电视剧|连续剧|国产剧|港台剧|日韩剧|欧美剧|剧集|短剧/.test(text)) return 'tv';
        if (/电影|影片|院线/.test(text)) return 'movie';
        return '';
    }

    function normalizeChineseNumber(value) {
        const direct = Number.parseInt(value, 10);
        if (Number.isFinite(direct)) return String(direct);
        const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
        if (value === '十') return '10';
        if (value?.startsWith('十')) return String(10 + (digits[value[1]] || 0));
        if (value?.endsWith('十')) return String((digits[value[0]] || 0) * 10);
        if (value?.includes('十')) {
            return String((digits[value[0]] || 0) * 10 + (digits[value[2]] || 0));
        }
        return digits[value] ? String(digits[value]) : '';
    }

    function getSeason(item) {
        const title = String(item?.vod_name || '');
        const chinese = title.match(/第([一二三四五六七八九十百\d]+)季/u);
        if (chinese) return normalizeChineseNumber(chinese[1]);
        const english = title.match(/(?:season\s*|(?:^|\W)s)(\d{1,3})(?:\W|$)/i);
        return english ? String(Number.parseInt(english[1], 10)) : '';
    }

    function getYear(item) {
        const direct = String(item?.vod_year || '').match(/\d{4}/);
        if (direct) return direct[0];
        const text = [item?.vod_name, item?.vod_remarks, item?.vod_content].filter(Boolean).join(' ');
        const fallback = text.match(/\b(19\d{2}|20\d{2})\b/);
        return fallback ? fallback[0] : '';
    }

    function editionTags(item) {
        const title = String(item?.vod_name || '').toLowerCase();
        const tags = [];
        for (const [label, pattern] of [['cantonese', /粤语|粵語|cantonese/], ['mandarin', /国语|國語|普通话|mandarin/], ['dubbed', /配音版|译制版|dubbed/], ['extended', /加长版|加長版|extended/], ['directors-cut', /导演剪辑|導演剪輯|director.?s.?cut/], ['uncut', /未删减|未刪減|无删减|uncut/], ['theatrical', /院线版|院線版|theatrical/], ['remastered', /修复版|修復版|重制版|remaster/]]) {
            if (pattern.test(title)) tags.push(label);
        }
        return tags;
    }
    function languages(item) {
        return [...new Set(String(item.vod_lang || '').split(/[,，/、|;；]+/).map(s=>s.trim()).filter(s=>s&&!['未知','其它','其他'].includes(s)))];
    }
    function getVersion(item) {
        const tags = editionTags(item);
        const language = normalizeText(item?.vod_lang || '');
        if (language && !['未知', '其他'].includes(language)) {
            const canonical = /粤语|粵語|cantonese/.test(language) ? 'cantonese' : /国语|國語|普通话|mandarin/.test(language) ? 'mandarin' : 'lang:' + language;
            tags.push(canonical);
        }
        return [...new Set(tags)].sort().join(',');
    }

    function getVersionLabel(item) {
        const labels = {cantonese:'粤语',mandarin:'国语',dubbed:'配音版',extended:'加长版','directors-cut':'导演剪辑版',uncut:'未删减版',theatrical:'院线版',remastered:'修复版'};
        if(item.work_languages)return [...editionTags(item).map(tag=>labels[tag]),...item.work_languages].filter((s,i,a)=>a.indexOf(s)===i).join(' / ');
        return getVersion(item).split(',').filter(Boolean).map(key => labels[key] || key.replace(/^lang:/, '')).join(' / ');
    }

    function getLegacyResultKey(item) {
        const title = normalizeTitle(item?.vod_name);
        return `${title}|${getYear(item)}|${normalizeType(item)}|${getSeason(item)}|${normalizeText(item?.vod_director || '')}`;
    }

    function getResultKey(item) {
        if(item.work_key)return item.work_key;
        const legacy = getLegacyResultKey(item), version = getVersion(item);
        return version ? legacy + '|version:' + version : legacy;
    }

    function getIdentity(item) {
        const identity = {
            subject: /^[1-9]\d{3,10}$/.test(String(item?.vod_douban_id))?String(item.vod_douban_id):'',
            edition: editionTags(item).join(','),
            directors: String(item?.vod_director||'').split(/[,，/、|]/).map(normalizeText).filter(x=>x&&!['未知','暂无','佚名'].includes(x)),
            title: normalizeTitle(item?.vod_name),
            year: getYear(item),
            type: normalizeType(item),
            season: getSeason(item),
            director: normalizeText(item?.vod_director || ''),
            version: getVersion(item)
        };
        identity.specificity = [
            identity.year,
            identity.type,
            identity.season,
            identity.director,
            identity.version
        ].filter(Boolean).length;
        return identity;
    }

    function identitiesCompatible(left, right) {
        if(left.subject&&right.subject&&left.subject!==right.subject)return false;
        if(left.edition!==right.edition)return false;
        if(left.year&&left.year===right.year&&left.season===right.season&&(!left.type||!right.type||left.type===right.type)){
            const includes=(a,b)=>a.length&&a.every(d=>b.includes(d));
            if((left.subject&&left.subject===right.subject)||includes(left.directors,right.directors)||includes(right.directors,left.directors))return true;
        }
        if (left.version !== right.version) return false;
        return ['year', 'type', 'season', 'director', 'version'].every((key) => (
            !left[key] || !right[key] || left[key] === right[key]
        ));
    }

    function mergeIdentity(base, incoming) {
        if(!base.subject)base.subject=incoming.subject;
        ['year', 'type', 'season', 'director', 'version'].forEach((key) => {
            if (!base[key] && incoming[key]) base[key] = incoming[key];
        });
        base.specificity = ['year', 'type', 'season', 'director', 'version']
            .filter((key) => base[key])
            .length;
    }

    function compatibilityScore(left, right) {
        return ['year', 'type', 'season', 'director', 'version']
            .reduce((score, key) => score + (left[key] && left[key] === right[key] ? 1 : 0), 0);
    }

    // These two source assets return the same deleted-poster PNG with HTTP 200.
    const unavailablePosters = new Set([
        'p.bfvp26.com/upload/vod/20230619-1/9007664f78954ad2b459626a21ded7b2.png',
        'ok.zuidapic.com/upload/vod/20230831-1/67793f92f86c83b19ea44e400a5d9f5e.png'
    ]);
    function isUnavailablePoster(url) {
        return unavailablePosters.has(String(url || '').trim().replace(/^https?:\/\//i, '').split(/[?#]/, 1)[0]);
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

        if ((!base.vod_pic || isUnavailablePoster(base.vod_pic)) && item.vod_pic && !isUnavailablePoster(item.vod_pic)) base.vod_pic = item.vod_pic;
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
        const titleBuckets = new Map();

        (Array.isArray(items) ? items : []).forEach((item) => {
            if (!item || !item.vod_name || !item.vod_id || !item.source_code) return;
            const identity = getIdentity(item);
            if (!identity.title) return;
            if (!titleBuckets.has(identity.title)) titleBuckets.set(identity.title, []);
            titleBuckets.get(identity.title).push({ item, identity });
        });

        const grouped = [];
        titleBuckets.forEach((entries, title) => {
            const clusters = [];
            entries
                .slice()
                .sort((a, b) => b.identity.specificity - a.identity.specificity)
                .forEach(({ item, identity }) => {
                    const exactLineMatches = clusters.filter((candidate) => (
                        candidate.result.source_lines.some((line) => (
                            line.source_code === item.source_code &&
                            String(line.vod_id) === String(item.vod_id)
                        ))
                    ));
                    const compatible = clusters
                        .filter((cluster) => identitiesCompatible(cluster.identity, identity))
                        .filter((cluster) => (identity.subject&&identity.subject===cluster.identity.subject&&identity.year&&identity.year===cluster.identity.year) || !cluster.result.source_lines.some((line) => (
                            line.source_code === item.source_code &&
                            String(line.vod_id) !== String(item.vod_id)
                        )))
                        .sort((a, b) => (
                            compatibilityScore(b.identity, identity) -
                            compatibilityScore(a.identity, identity)
                        ));

                    let cluster = exactLineMatches.length === 1 ? exactLineMatches[0] : null;
                    if (!cluster && identity.specificity === 0) {
                        const informative = compatible.filter((candidate) => candidate.identity.specificity > 0);
                        cluster = informative.length === 1 ? informative[0] : null;
                    } else if (!cluster && compatible.length === 1) {
                        cluster = compatible[0];
                    } else if (!cluster && compatible.length > 1) {
                        const bestScore = compatibilityScore(compatible[0].identity, identity);
                        const equallyGood = compatible.filter((candidate) => (
                            compatibilityScore(candidate.identity, identity) === bestScore
                        ));
                        cluster = equallyGood.length === 1 ? equallyGood[0] : null;
                    }

                    if (!cluster) {
                        cluster = {
                            identity: { ...identity },
                            result: {
                                ...item,
                                source_lines: [],
                                source_count: 0
                            }
                        };
                        clusters.push(cluster);
                    } else {
                        mergeIdentity(cluster.identity, identity);
                    }
                    cluster.languages??=new Set();
                    for(const language of languages(item))cluster.languages.add(language);
                    const rating=Number(item.vod_douban_score);
                    if(rating>0&&rating<=10)(cluster.scores??=new Set()).add(rating);
                    mergeResultItem(cluster.result, item, sourcePlanMap);
                });

            clusters.forEach((cluster, index) => {
                const key = [
                    title,
                    cluster.identity.year,
                    cluster.identity.type,
                    cluster.identity.season,
                    cluster.identity.director,
                    cluster.identity.version,
                    index
                ].join('|');
                const id=cluster.identity;
                if(id.subject&&id.year)cluster.result.work_key=['work',title,id.year,id.subject,id.type,id.season,id.edition].join('|');
                cluster.result.work_languages=[...cluster.languages].sort();
                cluster.result.source_count=new Set(cluster.result.source_lines.map(l=>l.source_code)).size;
                cluster.result.score_conflict=cluster.scores?.size>1;
                if(cluster.result.score_conflict)cluster.result.vod_douban_score='';
                cluster.result.aggregate_key = key;
                grouped.push(cluster.result);
            });
        });

        return grouped.sort((a, b) => {
            const lineDelta = (b.source_count || 0) - (a.source_count || 0);
            if (lineDelta !== 0) return lineDelta;
            return String(a.vod_name || '').localeCompare(String(b.vod_name || ''));
        });
    }

    window.OpenStreamResultAggregator = {
        aggregateResults,
        isUnavailablePoster,
        normalizeTitle,
        normalizeType,
        getResultKey,
        getLegacyResultKey,
        getSeason,
        getYear,
        getVersion,
        getVersionLabel
    };
})();
