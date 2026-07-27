// Pure quality-candidate helpers kept separate so selection policy is smoke-testable.
(function () {
    function isVerifiedPlayable(result) {
        const quality = result?.quality || {};
        return !!(
            quality.searchOk &&
            quality.detailOk &&
            (quality.episodesCount || 0) > 0 &&
            quality.playOk &&
            quality.segmentOk
        );
    }

    function selectVerifiedPlayable(results, limit = 5) {
        return (Array.isArray(results) ? results : [])
            .filter(isVerifiedPlayable)
            .sort((a, b) => (b.quality?.score || 0) - (a.quality?.score || 0))
            .slice(0, Math.max(0, Number(limit) || 0));
    }

    async function testCandidatesUntilLimit(candidates, options = {}) {
        const input = Array.isArray(candidates) ? candidates : [];
        const batchSize = Math.max(1, Number(options.batchSize) || 1);
        const limit = Math.max(1, Number(options.limit) || 5);
        const test = options.test;
        if (typeof test !== 'function') throw new TypeError('candidate test function is required');

        const tested = [];
        for (let index = 0; index < input.length; index += batchSize) {
            const batch = input.slice(index, index + batchSize);
            const batchResults = await Promise.all(batch.map(test));
            tested.push(...batchResults);
            if (selectVerifiedPlayable(tested, limit).length >= limit) break;
        }
        return tested;
    }

    async function mapWithConcurrency(items, options = {}) {
        const input = Array.isArray(items) ? items : [];
        const worker = options.worker;
        const concurrency = Math.max(1, Math.min(
            input.length || 1,
            Number(options.concurrency) || 1
        ));
        if (typeof worker !== 'function') throw new TypeError('concurrent worker function is required');

        const output = new Array(input.length);
        let nextIndex = 0;
        async function runWorker() {
            while (nextIndex < input.length) {
                const index = nextIndex;
                nextIndex += 1;
                output[index] = await worker(input[index], index);
            }
        }
        await Promise.all(Array.from({ length: concurrency }, runWorker));
        return output;
    }

    window.OpenStreamQualitySelection = {
        isVerifiedPlayable,
        selectVerifiedPlayable,
        testCandidatesUntilLimit,
        mapWithConcurrency
    };
})();
