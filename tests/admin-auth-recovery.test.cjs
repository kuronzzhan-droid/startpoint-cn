'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

function load(relative, imports = {}, globals = {}) {
    const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
        reportDiagnostics: true,
    })
    assert.equal(output.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0)
    const module = { exports: {} }
    vm.runInNewContext(output.outputText, {
        module, exports: module.exports, URL, Response, FormData, AbortController, TextDecoder,
        require(name) {
            if (name.endsWith(".css")) return {}
            if (name === "../lib/adminFormat") return load("admin/src/lib/adminFormat.ts")
            if (name in imports) return imports[name]
            if (name.startsWith('node:')) return require(name)
            throw new Error(`Unexpected import: ${name}`)
        }, ...globals,
    }, { filename: relative })
    return module.exports
}

function uiHarness(relative, { queries = {}, mutations = [], api = {}, auth, window = {} } = {}) {
    let cursor = 0
    const slots = [], notices = [], mutationOptions = []
    const jsx = (type, props) => ({ type, props: props || {} })
    const react = {
        useState(initial) {
            const index = cursor++
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
            return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
        },
        useRef(initial) {
            const index = cursor++
            return slots[index] || (slots[index] = { current: initial })
        },
        useEffect() {},
        useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    }
    const queryClient = { invalidateQueries: () => Promise.resolve(), setQueryData() {} }
    const antd = new Proxy({
        Layout: Object.assign('Layout', {}),
        Grid: { useBreakpoint: () => ({ md: true }) },
        Typography: { Text: 'Text', Paragraph: 'Paragraph', Title: 'Title' },
        message: new Proxy({}, { get: (_target, name) => text => notices.push({ name, text }) }),
        Modal: Object.assign('Modal', { success() {}, confirm() {} }),
    }, { get: (target, name) => name in target ? target[name] : name })
    // Layout has static component members in AntD.
    antd.Layout = { Sider: 'Sider', Content: 'Content', Header: 'Header' }
    let mutationIndex = 0
    const imports = {
        react,
        'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
        antd,
        '@ant-design/icons': new Proxy({}, { get: (_t, name) => name }),
        'lucide-react': new Proxy({}, { get: (_t, name) => name }),
        '@tanstack/react-query': {
            useQueryClient: () => queryClient,
            useQuery: options => ({ isLoading: false, isPending: false, isError: false, isFetching: false, refetch: () => Promise.resolve(), ...(options.enabled === false ? {} : queries[options.queryKey[0]]) }),
            useMutation: options => {
                mutationOptions.push(options)
                return { isPending: false, mutate() {}, mutateAsync: async () => ({}), ...mutations[mutationIndex++] }
            },
        },
        'react-router-dom': { useNavigate: () => () => {}, useLocation: () => ({ pathname: '/accounts' }), Routes: 'Routes', Route: 'Route', Navigate: 'Navigate' },
        './api/client': api, '../api/client': api,
        './api/auth': auth,
        './components/AsyncPage': { createAsyncPage: () => 'AsyncPage' },
        './lib/editGuard': { requestAdminLeave: action => action(), allowAdminUnload() {}, useAdminBeforeUnload() {}, useAdminEditGuard() {} },
        '../lib/editGuard': { requestAdminLeave: action => action(), useAdminEditGuard() {}, useAdminNavigate: () => () => {} },
        '../components/AdminPage': { AdminPage: 'AdminPage' },
        './assets/logo.png': 'fixture-logo',
    }
    for (const name of ['Dashboard', 'Accounts', 'PlayerDetail', 'Mail', 'Seeds', 'TimeControl', 'Leaderboards', 'News', 'ContentOperations']) {
        imports[`./pages/${name}`] = { default: name }
    }
    const component = load(relative, imports, { window }).default
    return {
        notices, mutationOptions, queryClient,
        render() { cursor = 0; mutationIndex = 0; mutationOptions.length = 0; return component({ dark: true, onToggleDark() {} }) },
    }
}

function elements(value, predicate) {
    const found = []
    function walk(node) {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) return node.forEach(walk)
        if ('type' in node && node.props && predicate(node)) found.push(node)
        // AntD grouped menu items are plain records; only JSX nodes have props.
        Object.values(node.props ?? node).forEach(walk)
    }
    walk(value)
    return found
}

test('401 coalesces login notice, keeps 403 distinct, and neither status is retried', async () => {
    const auth = load('admin/src/api/auth.ts')
    let responseStatus = 401, notifications = 0
    const unsubscribe = auth.subscribeLoginExpired(() => notifications++)
    const api = load('admin/src/api/client.ts', { './auth': auth }, {
        fetch: async () => new Response('{"error":"unauthorized"}', { status: responseStatus, headers: { 'content-type': 'application/json' } }),
    })
    await assert.rejects(api.apiGet('/fixture'), error => error.status === 401 && /登录已失效/.test(error.message))
    await assert.rejects(api.apiPost('/fixture', {}), error => error.status === 401)
    assert.equal(auth.getLoginExpired(), true)
    assert.equal(notifications, 1)
    assert.equal(api.shouldRetryQuery(0, new api.ApiError(401, 'expired')), false)
    assert.equal(api.shouldRetryQuery(0, new api.ApiError(403, 'forbidden')), false)
    assert.equal(api.shouldRetryQuery(0, new api.ApiError(503, 'unavailable')), true)
    assert.equal(api.shouldRetryQuery(1, new Error('network')), false)
    auth.setLoginExpired(false); responseStatus = 403
    await assert.rejects(api.apiGet('/fixture'), error => error.status === 403 && /没有执行此操作的权限/.test(error.message))
    assert.equal(auth.getLoginExpired(), false)
    unsubscribe()
})

test('logout rejects safely, suppresses duplicate pending submits, and redirects only after success', async () => {
    let resolve, reject, requests = 0
    const redirects = []
    const auth = load('admin/src/api/auth.ts')
    const harness = uiHarness('admin/src/App.tsx', {
        auth, window: { location: { replace: url => redirects.push(url) } },
        api: { apiPost: () => { requests++; return new Promise((a, b) => { resolve = a; reject = b }) } },
    })
    const click = elements(harness.render(), el => el.props['aria-label'] === '退出管理面板')[0].props.onClick
    const first = click()
    await click()
    assert.equal(requests, 1)
    assert.equal(elements(harness.render(), el => el.props['aria-label'] === '退出管理面板')[0].props.loading, true)
    reject(new Error('Synthetic 503')); await first
    assert.deepEqual(redirects, [])
    const failed = harness.render()
    assert.equal(elements(failed, el => el.type === 'Alert' && /退出未完成/.test(el.props.message)).length, 1)
    const retry = elements(failed, el => el.type === 'Button' && el.props.children === '重试退出')[0]
    const second = retry.props.onClick(); resolve({ ok: true }); await second
    assert.deepEqual(redirects, ['/admin-login'])
})

test('expired login leaves current route mounted and offers a separate login window', () => {
    const auth = load('admin/src/api/auth.ts'); auth.setLoginExpired(true)
    const harness = uiHarness('admin/src/App.tsx', { auth })
    const tree = harness.render()
    assert.equal(elements(tree, el => el.type === 'Routes').length, 1)
    const link = elements(tree, el => el.type === 'Button' && el.props.href === '/admin-login')[0]
    assert.equal(link.props.target, '_blank')
    assert.match(link.props.rel, /noopener/)
    assert.equal(elements(tree, el => el.type === 'Alert' && el.props.message === '管理登录已失效').length, 1)
})

test('account read failure is distinct from empty and every write mutation has error feedback', () => {
    const failed = uiHarness('admin/src/pages/Accounts.tsx', {
        queries: { accounts: { isError: true }, 'unnoted-account-cleanup': { data: { status: 'idle' } } },
    })
    const tree = failed.render()
    assert.equal(elements(tree, el => el.type === 'Alert' && el.props.message === '账号列表加载失败').length, 1)
    assert.equal(elements(tree, el => el.type === 'Table' && el.props.className === 'accounts-overview-table').length, 0)
    assert.equal(elements(tree, el => el.type === 'Button' && String(el.props.children).includes('数据未就绪'))[0].props.disabled, true)
    assert.equal(failed.mutationOptions.length, 11)
    failed.mutationOptions.forEach(option => {
        assert.equal(typeof option.onError, 'function')
        assert.equal(option.onError(new Error('Synthetic write failure')), undefined, 'toast callbacks must not prolong TanStack pending')
    })
    assert.equal(failed.notices.length, 11)
    const empty = uiHarness('admin/src/pages/Accounts.tsx', { queries: { accounts: { data: { rows: [], summary: { unnotedAccountCount: 0, unnotedSaveCount: 0 } } } } }).render()
    assert.equal(elements(empty, el => el.type === 'Table' && el.props.className === 'accounts-overview-table')[0].props.locale.emptyText, '暂无账号')
})

test('account writes expose pending and disable conflicting row writes', () => {
    const row = { id: 1, note: 'keep', bindings: [], players: [], saveCount: 0, playerIds: [] }
    const harness = uiHarness('admin/src/pages/Accounts.tsx', {
        queries: { accounts: { data: { rows: [row], summary: { unnotedAccountCount: 0, unnotedSaveCount: 0 } } } }, mutations: [{}, { isPending: true, variables: 1 }],
    })
    const tree = harness.render()
    const table = elements(tree, el => el.type === 'Table' && el.props.className === 'accounts-overview-table')[0]
    const actionCell = table.props.columns.find(column => column.title === '操作').render(undefined, row)
    const create = elements(actionCell, el => el.type === 'Button' && String(el.props.children).includes('新建存档'))[0]
    assert.equal(create.props.loading, true)
    assert.equal(create.props.disabled, true)
    assert.equal(elements(actionCell, el => el.type === 'Button' && el.props.danger)[0].props.disabled, true)
})

test('default-save read failure is not displayed as unset and prevents replacement', () => {
    const harness = uiHarness('admin/src/pages/DataMaintenance.tsx', {
        queries: { defaultSave: { isError: true } },
    })
    const tree = harness.render()
    assert.equal(elements(tree, el => el.type === 'Alert' && el.props.message === '默认存档读取失败').length, 1)
    assert.equal(elements(tree, el => el.type === 'Tag' && el.props.children === '未设置，新建时使用空存档').length, 0)
    assert.equal(elements(tree, el => el.type === 'Upload')[0].props.disabled, true)
    harness.mutationOptions.forEach(option => assert.equal(option.onError(new Error('Synthetic failure')), undefined))
})

test('a diagnosed corrupt default template keeps replacement and explicit clear available', () => {
    const harness = uiHarness('admin/src/pages/DataMaintenance.tsx', {
        queries: { defaultSave: { data: { exists: true, status: 'invalid', error: 'Synthetic invalid template' } } },
    })
    const tree = harness.render()
    assert.equal(elements(tree, el => el.type === 'Alert' && el.props.message === '默认存档损坏或不受支持').length, 1)
    assert.equal(elements(tree, el => el.type === 'Tag' && el.props.children === '未设置，新建时使用空存档').length, 0)
    assert.equal(elements(tree, el => el.type === 'Upload')[0].props.disabled, false)
    assert.equal(elements(tree, el => el.type === 'Button' && el.props.children === '清除默认存档')[0].props.disabled, false)
})

async function loginFixture(fetch) {
    const routes = new Map()
    const auth = load('src/lib/management-auth.ts', { './request-route-path': { requestRoutePath: req => req.url } }, { process: { env: {} } })
    auth.installManagementAuth({ addHook() {}, get(url, fn) { routes.set(url, fn) }, post() {} })
    let html
    const reply = { type() { return this }, send(value) { html = value; return this } }
    await routes.get('/admin-login')({ headers: {}, query: {} }, reply)
    assert.match(html, /<label for="password">/)
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
    let submit
    const nodes = {
        '#login': { addEventListener(_event, callback) { submit = callback } },
        '#login-submit': { disabled: false, textContent: '登录' },
        '#login-error': { hidden: true, textContent: '' },
        '#password': { value: 'synthetic-password-only' },
    }
    const redirects = []
    vm.runInNewContext(script, { document: { querySelector: selector => nodes[selector] }, fetch, location: { replace: url => redirects.push(url) } })
    return { nodes, redirects, submit: () => submit({ preventDefault() {} }) }
}

test('login keeps failures visible, distinguishes network/server/auth, and recovers submit state', async () => {
    for (const [fetch, expected] of [
        [async () => { throw new Error('offline') }, /检查网络/],
        [async () => ({ ok: false, status: 503 }), /服务暂时不可用/],
        [async () => ({ ok: false, status: 401 }), /密码错误或尝试次数过多/],
    ]) {
        const fixture = await loginFixture(fetch); await fixture.submit()
        assert.match(fixture.nodes['#login-error'].textContent, expected)
        assert.equal(fixture.nodes['#login-error'].hidden, false)
        assert.equal(fixture.nodes['#login-submit'].disabled, false)
        assert.deepEqual(fixture.redirects, [])
    }
    let release, requests = 0
    const fixture = await loginFixture(() => { requests++; return new Promise(resolve => { release = resolve }) })
    const pending = fixture.submit(); await fixture.submit()
    assert.equal(requests, 1); assert.equal(fixture.nodes['#login-submit'].disabled, true)
    release({ ok: true }); await pending
    assert.deepEqual(fixture.redirects, ['/admin/'])
})
