(function () {
    const DEFAULT_KEYS = ['jisu', 'lzi', 'dyttzy', 'hongniu', 'guangsu', 'huya'];
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

    const CATALOG_REVISION = 2;
    const CATALOG_KEY = 'openstreamCatalogSnapshot';

    function migrateCatalog(sites, storage) {
        try {
            const current = Object.fromEntries(Object.entries(sites)
                .filter(([, site]) => !site.adult)
                .map(([key, site]) => [key, String(site.api || '')]));
            let previous;
            try { previous = JSON.parse(storage.getItem(CATALOG_KEY)); } catch (_) {}
            if (previous?.revision === CATALOG_REVISION &&
                JSON.stringify(previous.sources) === JSON.stringify(current)) return false;
            let custom;
            try { custom = JSON.parse(storage.getItem('customAPIs')); } catch (_) {}
            const selected = reconcileSelection(storage.getItem('selectedAPIs'), sites,
                Array.isArray(custom) ? custom : []);
            // Repair legacy auto-trimmed selections once; later updates only add
            // newly introduced recommended sources, not user-disabled ones.
            const added = defaults(sites).filter(key =>
                previous?.revision !== CATALOG_REVISION || !owns(previous.sources || {}, key));
            storage.setItem('selectedAPIs', JSON.stringify([...new Set([...selected, ...added])]));
            for (const key of ['apiQualities', 'apiLatencies', 'qualityTestTime',
                'latencyTestTime', 'openstreamSourceHealth', 'hideZombieApis']) {
                storage.removeItem(key);
            }
            // Commit last: interrupted or quota-limited migrations retry safely.
            storage.setItem(CATALOG_KEY, JSON.stringify({ revision: CATALOG_REVISION, sources: current }));
            return true;
        } catch (_) { return false; }
    }

    window.OpenStreamSourceCatalog = { defaults, reconcileSelection, freshQualities, migrateCatalog };
    if (window.API_SITES && typeof localStorage !== 'undefined') migrateCatalog(window.API_SITES, localStorage);
})();
