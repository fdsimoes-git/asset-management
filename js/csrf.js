// CSRF token helper — fetches once per page load, caches for all subsequent requests
let _csrfToken = null;
let _csrfPromise = null;

async function getCsrfToken() {
    if (_csrfToken) return _csrfToken;
    if (!_csrfPromise) {
        _csrfPromise = fetch('/api/csrf-token', { credentials: 'include' })
            .then(r => r.json())
            .then(d => { _csrfToken = d.csrfToken; return _csrfToken; })
            .catch(() => '');
    }
    return _csrfPromise;
}

async function csrfFetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const token = await getCsrfToken();
        options.headers = options.headers || {};
        if (options.headers instanceof Headers) {
            options.headers.set('x-csrf-token', token);
        } else {
            options.headers['x-csrf-token'] = token;
        }
    }
    return fetch(url, options);
}
