// Browser-side streaming search pipeline. It keeps Vercel stateless and lets the
// UI render usable results while slower sources continue in the background.
(function () {
    const DEFAULTS = {
        firstPageBudget: 1,
        enrichPageBudget: 3,
        totalBudgetMs: 5200,
        tierTimeoutMs: {
            S: 1400,
            A: 2400,
            B: 3600,
            C: 4200
        },
        tierConcurrency: {
            S: 4,
            A: 4,
            B: 2,
            C: 1
        },
        minResultsBeforeSkippingSlowTier: 24
    };

    function now() {
        return performance && typeof performance.now === 'function' ? performance.now() : Date.now();
    }

    function withTimeout(promise, timeoutMs) {
        let timeoutId;
        const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                const error = new Error('source timeout');
                error.name = 'TimeoutError';
                reject(error);
            }, timeoutMs);
        });

        return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
    }

    async function runPool(items, concurrency, worker, shouldContinue) {
        const input = Array.isArray(items) ? items : [];
        const limit = Math.max(1, Number(concurrency) || 1);
        let index = 0;

        const workers = Array.from({ length: Math.min(limit, input.length) }, async () => {
            while (index < input.length && shouldContinue()) {
                const current = input[index++];
                await worker(current);
            }
        });

        await Promise.allSettled(workers);
    }

    function mergeUnique(existing, incoming) {
        const map = new Map();
        (Array.isArray(existing) ? existing : []).forEach((item) => {
            map.set(`${item.source_code}|${item.vod_id}|${item.vod_name}`, item);
        });
        (Array.isArray(incoming) ? incoming : []).forEach((item) => {
            map.set(`${item.source_code}|${item.vod_id}|${item.vod_name}`, item);
        });
        return Array.from(map.values());
    }

    function getTierGroups(plan) {
        return ['S', 'A', 'B', 'C']
            .map((tier) => ({
                tier,
                sources: plan.filter((item) => item.tier === tier)
            }))
            .filter((group) => group.sources.length > 0);
    }

    async function fetchSource(source, context, pageBudget, timeoutMs) {
        const startedAt = now();
        const status = window.OpenStreamSourceHealth?.SOURCE_STATUS || {};
        try {
            const adapterResult = await withTimeout(
                window.OpenStreamSourceAdapter?.search
                    ? window.OpenStreamSourceAdapter.search(source.sourceKey, context.query, context.filters, { maxPages: pageBudget })
                    : Promise.resolve({ status: status.READY, list: [] }).then(() => searchByAPIAndKeyWord(source.sourceKey, context.query, context.filters, { maxPages: pageBudget })).then((list) => ({ status: status.READY, list })),
                timeoutMs
            );
            const ms = Math.round(now() - startedAt);
            const list = Array.isArray(adapterResult?.list) ? adapterResult.list : [];
            const nextStatus = adapterResult?.status || (list.length > 0 ? status.READY : status.NO_RESULT);
            window.OpenStreamSourceHealth?.recordSourceEvent(source.sourceKey, { status: nextStatus, ms });
            return { source, status: nextStatus, ms, results: list };
        } catch (error) {
            const ms = Math.round(now() - startedAt);
            const nextStatus = error?.name === 'TimeoutError' ? status.TIMEOUT : status.ERROR;
            window.OpenStreamSourceHealth?.recordSourceEvent(source.sourceKey, { status: nextStatus, ms });
            return { source, status: nextStatus, ms, results: [], error };
        }
    }

    async function runStreamingSearch(options) {
        const config = { ...DEFAULTS, ...(options?.config || {}) };
        const sourceKeys = Array.isArray(options?.sources) ? options.sources : [];
        const sourcePlan = window.OpenStreamSourceHealth?.getSearchPlan(sourceKeys) || sourceKeys.map((sourceKey) => ({
            sourceKey,
            tier: 'B',
            score: 0
        }));

        const context = {
            query: String(options?.query || '').trim(),
            filters: options?.filters || {}
        };

        const startedAt = now();
        const deadline = startedAt + config.totalBudgetMs;
        const allRawResults = [];
        const completed = new Set();
        const enriched = new Set();
        const callbacks = {
            onStart: options?.onStart || function () {},
            onUpdate: options?.onUpdate || function () {},
            onSourceDone: options?.onSourceDone || function () {},
            onDone: options?.onDone || function () {}
        };

        const emitUpdate = (phase) => {
            const aggregateResults = window.OpenStreamResultAggregator?.aggregateResults || ((items) => items);
            callbacks.onUpdate({
                phase,
                rawResults: allRawResults.slice(),
                results: aggregateResults(allRawResults, sourcePlan),
                completed: completed.size,
                total: sourcePlan.length,
                sourcePlan
            });
        };

        const shouldContinue = () => {
            if (typeof options?.isActive === 'function' && !options.isActive()) return false;
            return now() < deadline;
        };

        callbacks.onStart({ total: sourcePlan.length, sourcePlan });
        emitUpdate('started');

        const groups = getTierGroups(sourcePlan);
        for (const group of groups) {
            if (!shouldContinue()) break;
            if ((group.tier === 'B' || group.tier === 'C') && allRawResults.length >= config.minResultsBeforeSkippingSlowTier) {
                break;
            }

            const timeoutMs = config.tierTimeoutMs[group.tier] || config.tierTimeoutMs.C;
            const concurrency = config.tierConcurrency[group.tier] || 1;

            await runPool(group.sources, concurrency, async (source) => {
                if (!shouldContinue()) return;
                const result = await fetchSource(source, context, config.firstPageBudget, timeoutMs);
                completed.add(source.sourceKey);
                if (result.results.length > 0) {
                    allRawResults.splice(0, allRawResults.length, ...mergeUnique(allRawResults, result.results));
                }
                callbacks.onSourceDone(result);
                emitUpdate(`tier_${group.tier}`);
            }, shouldContinue);
        }

        // Enrich only successful high-value sources. This runs after first paint
        // and keeps adding lines without blocking the user.
        const enrichCandidates = sourcePlan
            .filter((item) => completed.has(item.sourceKey) && ['S', 'A'].includes(item.tier))
            .slice(0, 8);

        await runPool(enrichCandidates, 2, async (source) => {
            if (!shouldContinue() || enriched.has(source.sourceKey)) return;
            enriched.add(source.sourceKey);
            const result = await fetchSource(source, context, config.enrichPageBudget, config.tierTimeoutMs.A + 1800);
            if (result.results.length > 0) {
                allRawResults.splice(0, allRawResults.length, ...mergeUnique(allRawResults, result.results));
                emitUpdate('enriched');
            }
        }, shouldContinue);

        const aggregateResults = window.OpenStreamResultAggregator?.aggregateResults || ((items) => items);
        const finalPayload = {
            rawResults: allRawResults.slice(),
            results: aggregateResults(allRawResults, sourcePlan),
            completed: completed.size,
            total: sourcePlan.length,
            sourcePlan,
            elapsedMs: Math.round(now() - startedAt)
        };
        callbacks.onDone(finalPayload);
        return finalPayload;
    }

    window.OpenStreamStreamingSearch = {
        runStreamingSearch,
        defaults: DEFAULTS
    };
})();
