// Browser-side streaming search pipeline. It keeps Vercel stateless and lets the
// UI render usable results while slower sources continue in the background.
(function () {
    const DEFAULTS = {
        firstPageBudget: 1,
        enrichPageBudget: 3,
        totalBudgetMs: 5200,
        sourceConcurrency: 4,
        sourceMaxConcurrency: 7,
        sourceHedgeDelayMs: 350,
        tierTimeoutMs: {
            S: 2200,
            A: 3200,
            B: 4300,
            C: 5000
        },
        minResultsBeforeSkippingSlowTier: 24
    };

    function now() {
        return performance && typeof performance.now === 'function' ? performance.now() : Date.now();
    }

    function createAbortError(name, message) {
        const error = new Error(message);
        error.name = name;
        return error;
    }

    function withTimeout(factory, timeoutMs, parentSignal) {
        const controller = new AbortController();
        let timeoutId;
        let rejectAbort;

        const abortPromise = new Promise((_, reject) => {
            rejectAbort = reject;
        });
        const abort = (error) => {
            if (!controller.signal.aborted) controller.abort(error);
            rejectAbort(error);
        };
        const abortFromParent = () => abort(
            parentSignal?.reason instanceof Error
                ? parentSignal.reason
                : createAbortError('AbortError', 'search aborted')
        );

        if (parentSignal?.aborted) {
            abortFromParent();
        } else {
            parentSignal?.addEventListener('abort', abortFromParent, { once: true });
        }

        timeoutId = setTimeout(() => {
            abort(createAbortError('TimeoutError', 'source timeout'));
        }, Math.max(1, timeoutMs));

        const work = Promise.resolve().then(() => factory(controller.signal));
        return Promise.race([work, abortPromise]).finally(() => {
            clearTimeout(timeoutId);
            parentSignal?.removeEventListener('abort', abortFromParent);
        });
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

    async function runAdaptivePool(items, poolOptions, worker, shouldContinue) {
        const input = Array.isArray(items) ? items : [];
        if (input.length === 0) return;

        const initialLimit = Math.max(1, Number(poolOptions?.initialConcurrency) || 1);
        const maxLimit = Math.max(
            initialLimit,
            Math.min(input.length, Number(poolOptions?.maxConcurrency) || initialLimit)
        );
        const hedgeDelayMs = Math.max(50, Number(poolOptions?.hedgeDelayMs) || 350);
        let currentLimit = Math.min(initialLimit, input.length);
        let nextIndex = 0;
        let active = 0;
        let settled = false;
        let hedgeTimer = 0;

        await new Promise((resolve) => {
            const finish = () => {
                if (settled) return;
                if (active > 0 || (nextIndex < input.length && shouldContinue())) return;
                settled = true;
                clearTimeout(hedgeTimer);
                resolve();
            };

            const scheduleHedge = () => {
                clearTimeout(hedgeTimer);
                if (settled || nextIndex >= input.length || !shouldContinue()) return;
                hedgeTimer = setTimeout(() => {
                    if (active >= currentLimit && currentLimit < maxLimit) {
                        currentLimit += 1;
                    }
                    launch();
                    scheduleHedge();
                }, hedgeDelayMs);
            };

            const launch = () => {
                while (active < currentLimit && nextIndex < input.length && shouldContinue()) {
                    const current = input[nextIndex++];
                    active += 1;
                    Promise.resolve()
                        .then(() => worker(current))
                        .catch(() => {})
                        .finally(() => {
                            active -= 1;
                            launch();
                            finish();
                        });
                }
                finish();
            };

            launch();
            scheduleHedge();
        });
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

    async function fetchSource(source, context, pageBudget, timeoutMs, parentSignal) {
        const startedAt = now();
        const status = window.OpenStreamSourceHealth?.SOURCE_STATUS || {};
        try {
            const adapterResult = await withTimeout(
                (signal) => window.OpenStreamSourceAdapter?.search
                    ? window.OpenStreamSourceAdapter.search(source.sourceKey, context.query, context.filters, { maxPages: pageBudget, signal })
                    : Promise.resolve({ status: status.READY, list: [] })
                        .then(() => searchByAPIAndKeyWord(source.sourceKey, context.query, context.filters, { maxPages: pageBudget, signal }))
                        .then((list) => ({ status: status.READY, list })),
                timeoutMs,
                parentSignal
            );
            const ms = Math.round(now() - startedAt);
            const list = Array.isArray(adapterResult?.list) ? adapterResult.list : [];
            const nextStatus = adapterResult?.status || (list.length > 0 ? status.READY : status.NO_RESULT);
            window.OpenStreamSourceHealth?.recordSourceEvent(source.sourceKey, { status: nextStatus, ms });
            return { source, status: nextStatus, ms, results: list };
        } catch (error) {
            const ms = Math.round(now() - startedAt);
            if (parentSignal?.aborted || error?.name === 'AbortError') {
                return { source, status: 'cancelled', ms, results: [], error };
            }
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
        const successful = new Set();
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
            if (options?.signal?.aborted) return false;
            return now() < deadline;
        };
        const getAggregatedResultCount = () => {
            const aggregateResults = window.OpenStreamResultAggregator?.aggregateResults || ((items) => items);
            return aggregateResults(allRawResults, sourcePlan).length;
        };

        callbacks.onStart({ total: sourcePlan.length, sourcePlan });
        emitUpdate('started');

        // One priority-sorted pool prevents a slow high-tier source from blocking
        // every source behind it while preserving a strict global concurrency cap.
        await runAdaptivePool(sourcePlan, {
            initialConcurrency: config.sourceConcurrency,
            maxConcurrency: config.sourceMaxConcurrency,
            hedgeDelayMs: config.sourceHedgeDelayMs
        }, async (source) => {
            if (!shouldContinue()) return;
            if (
                (source.tier === 'B' || source.tier === 'C') &&
                getAggregatedResultCount() >= config.minResultsBeforeSkippingSlowTier
            ) {
                completed.add(source.sourceKey);
                callbacks.onSourceDone({ source, status: 'skipped', ms: 0, results: [] });
                emitUpdate(`skipped_${source.tier}`);
                return;
            }

            const tierTimeout = config.tierTimeoutMs[source.tier] || config.tierTimeoutMs.C;
            const remainingBudget = Math.max(1, deadline - now());
            const result = await fetchSource(
                source,
                context,
                config.firstPageBudget,
                Math.min(tierTimeout, remainingBudget),
                options?.signal
            );
            completed.add(source.sourceKey);
            if (result.results.length > 0) {
                successful.add(source.sourceKey);
                allRawResults.splice(0, allRawResults.length, ...mergeUnique(allRawResults, result.results));
            }
            callbacks.onSourceDone(result);
            emitUpdate(`tier_${source.tier}`);
        }, shouldContinue);

        // Enrich only successful high-value sources. This runs after first paint
        // and keeps adding lines without blocking the user.
        const enrichCandidates = sourcePlan
            .filter((item) => successful.has(item.sourceKey) && ['S', 'A'].includes(item.tier))
            .filter((item) => !window.OpenStreamSourceAdapter?.isBridgeSource?.(item.sourceKey))
            .slice(0, 8);

        await runPool(enrichCandidates, 2, async (source) => {
            if (!shouldContinue() || enriched.has(source.sourceKey)) return;
            enriched.add(source.sourceKey);
            const remainingBudget = Math.max(1, deadline - now());
            const result = await fetchSource(
                source,
                context,
                config.enrichPageBudget,
                Math.min(config.tierTimeoutMs.A + 1800, remainingBudget),
                options?.signal
            );
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
