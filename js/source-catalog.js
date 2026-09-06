(function () {
    const DEFAULT_KEYS = ['jisu', 'bfzy', 'baidu', 'hwba', 'qiqi', 'mozhua'];
    const QUALITY_TTL = 24 * 60 * 60 * 1000;
    const FAILURE_TTL = 30 * 60 * 1000;
    const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

    function defaults(sites) {
        return DEFAULT_KEYS.filter(key => owns(sites, key));
    }

    function reconcileSelection(raw, sites, custom = []) {
        let parsed;
        try { parsed = JSON.parse(raw); } catch (_) {}
        if (!Array.isArray(parsed)) return defaults(sites);
        const valid = [...new Set(parsed)].filter(key => {
            if (typeof key !== 'string') return false;
            if (owns(sites, key)) return true;
            if (!/^custom_\d+$/.test(key)) return false;
            return !!custom[Number(key.slice(7))];
        });
        // An explicit empty selection is a preference; removed source IDs are not.
        return parsed.length && !valid.length ? defaults(sites) : valid;
    }

    function freshQualities(raw, fallbackTime, now = Date.now()) {
        let parsed;
        try { parsed = JSON.parse(raw); } catch (_) {}
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
        return Object.fromEntries(Object.entries(parsed).filter(([, value]) => {
            if (!value || !Number.isFinite(value.score)) return false;
            const testedAt = Number(value.testedAt || fallbackTime);
            const age = now - testedAt;
            const ttl = value.score === 0 ? FAILURE_TTL : QUALITY_TTL;
            return testedAt > 0 && age >= 0 && age < ttl;
        }));
    }

    window.OpenStreamSourceCatalog = { defaults, reconcileSelection, freshQualities };
})();
