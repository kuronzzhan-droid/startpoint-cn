const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Fastify = require('fastify');

// Directory listing order deliberately differs from numeric seq order.
const edge1 = [
    'pinball-1.4.116-1.4.117-10-tenth.zip',
    'pinball-1.4.116-1.4.117-2-second.zip',
    'pinball-1.4.116-1.4.117-1-first.zip',
];
const edge2 = [
    'pinball-1.4.117-1.4.118-3-c.zip',
    'pinball-1.4.117-1.4.118-1-a.zip',
    'pinball-1.4.117-1.4.118-2-b.zip',
];
const files = [...edge2, ...edge1].map((filename, i) => ({ filename, size: (i + 1) * 10 }));

function loadRoutes(patches, warnings = []) {
    const filename = process.env.STARPOINT_ASSET_ROUTE_FILE || path.resolve(__dirname, '../out/routes/cn/asset.js');
    const output = { exports: {} };
    const localRequire = name => {
        if (name.endsWith('/file-exists')) return { existsSync: () => true };
        if (name.endsWith('/utils')) return { generateDataHeaders: value => value || {} };
        if (name.endsWith('/zip-summary-cache')) return {
            getZipArchiveMetadata: directory => directory.replaceAll('\\', '/').endsWith('/asset-patch/active') ? files : [],
            invalidateZipCache() {},
        };
        if (name.endsWith('/version')) return {
            getPatchManifest: () => ({ cdn_version: '1.4.118', patches }),
            computeAssetTarget: version => ({ targetVersion: '1.4.118', isFirstTime: !version, fullVersion: '1.4.0' }),
        };
        return require(name);
    };
    const quietConsole = { ...console, warn: message => warnings.push(String(message)) };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module: output, exports: output.exports, require: localRequire,
        __dirname: path.dirname(filename), process: { env: {} }, console: quietConsole, URL,
    }, { filename });
    return output.exports;
}

const fullChain = [{ type: 'patch', enabled: true, chain: [...edge1, ...edge2] }];

test('archives inside one version edge are returned in numeric seq order', async () => {
    const app = Fastify({ logger: false });
    await app.register(loadRoutes(fullChain).default);
    try {
        const response = await app.inject({
            method: 'POST', url: '/get_path', headers: { device: 'Android', res_ver: '1.4.116' }, payload: {},
        });
        assert.equal(response.statusCode, 200);
        const diff = response.json().data.diff;
        assert.deepEqual(diff.map(group => [group.original_version, group.version]), [
            ['1.4.116', '1.4.117'], ['1.4.117', '1.4.118'],
        ]);
        assert.deepEqual(diff[0].archive.map(a => path.basename(a.location)), [
            'pinball-1.4.116-1.4.117-1-first.zip',
            'pinball-1.4.116-1.4.117-2-second.zip',
            'pinball-1.4.116-1.4.117-10-tenth.zip',
        ]);
        assert.deepEqual(diff[1].archive.map(a => path.basename(a.location)), [
            'pinball-1.4.117-1.4.118-1-a.zip',
            'pinball-1.4.117-1.4.118-2-b.zip',
            'pinball-1.4.117-1.4.118-3-c.zip',
        ]);
    } finally { await app.close(); }
});

test('archive name comparison is numeric for versions and seq', () => {
    const { compareDiffArchiveNames, parseDiffArchiveName } = loadRoutes(fullChain);
    assert.deepEqual({ ...parseDiffArchiveName('pinball-1.4.9-1.4.10-12-x.zip') }, { from: '1.4.9', to: '1.4.10', seq: 12 });
    assert.equal(parseDiffArchiveName('readme.zip'), null);
    const sorted = [
        'pinball-1.4.10-1.4.11-1-a.zip',
        'pinball-1.4.9-1.4.10-10-a.zip',
        'pinball-1.4.9-1.4.10-9-a.zip',
    ].sort(compareDiffArchiveNames);
    assert.deepEqual(sorted, [
        'pinball-1.4.9-1.4.10-9-a.zip',
        'pinball-1.4.9-1.4.10-10-a.zip',
        'pinball-1.4.10-1.4.11-1-a.zip',
    ]);
});

test('chain self-check accepts a clean chain and stays silent at startup', () => {
    const warnings = [];
    const { checkPatchChainIntegrity } = loadRoutes(
        [{ type: 'patch', enabled: true, chain: ['pinball-1.4.116-1.4.117-1-first.zip', 'pinball-1.4.116-1.4.117-2-second.zip', ...edge2] }],
        warnings,
    );
    assert.deepEqual(warnings, []);
    const clean = ['pinball-1.4.1-1.4.2-1-a.zip', 'pinball-1.4.1-1.4.2-2-b.zip', 'pinball-1.4.2-1.4.3-1-c.zip'];
    // The module runs in a separate vm realm; compare its arrays by value.
    assert.equal(JSON.stringify(checkPatchChainIntegrity(clean, clean)), '[]');
});

test('chain self-check reports duplicates, gaps, conflicting edges and missing files', () => {
    const { checkPatchChainIntegrity } = loadRoutes(fullChain);
    const names = [
        'pinball-1.4.1-1.4.2-1-a.zip',
        'pinball-1.4.1-1.4.2-1-a-copy.zip',
        'pinball-1.4.1-1.4.2-3-c.zip',
        'pinball-1.4.3-1.4.4-1-d.zip',
        'pinball-1.4.0-1.4.4-1-e.zip',
        'pinball-1.4.4-1.4.5-1-missing.zip',
    ];
    const warnings = checkPatchChainIntegrity(names, names.slice(0, -1));
    const has = fragment => assert.ok(warnings.some(w => w.includes(fragment)), `expected warning containing "${fragment}" in ${JSON.stringify(warnings)}`);
    has('duplicate (from,to,seq) 1.4.1->1.4.2#1');
    has('sequence gap in 1.4.1->1.4.2');
    has('version 1.4.4 is reached from several versions');
    has('chain gap: 1.4.1->1.4.2 is followed by 1.4.3->1.4.4');
    has('missing from active directory: pinball-1.4.4-1.4.5-1-missing.zip');
});

test('startup self-check logs a warning instead of failing to load', () => {
    const warnings = [];
    const exports = loadRoutes([{ type: 'patch', enabled: true, chain: [edge1[0], edge1[2]] }], warnings);
    assert.equal(typeof exports.default, 'function');
    assert.ok(warnings.some(w => w.startsWith('[PATCH] chain self-check: sequence gap in 1.4.116->1.4.117')), JSON.stringify(warnings));
});
