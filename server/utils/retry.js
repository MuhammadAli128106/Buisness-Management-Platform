// withRetry(fn, { attempts, baseMs, isTemporary }) — retries temporary provider failures with backoff (I5.5).
function defaultIsTemporary(err) {
  const status = err?.status || err?.statusCode || err?.response?.status || err?.code;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  return ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(err?.code)
    || err?.name === 'FetchError' || err?.name === 'AbortError' || /fetch failed|network/i.test(err?.message || '');
}

async function withRetry(fn, { attempts = 3, baseMs = 500, isTemporary = defaultIsTemporary } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try { return await fn(i); } catch (err) {
      lastErr = err;
      if (i === attempts || !isTemporary(err)) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** (i - 1)));
    }
  }
  lastErr.temporary = isTemporary(lastErr);
  throw lastErr;
}
module.exports = { withRetry, defaultIsTemporary };
