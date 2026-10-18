'use strict';
/**
 * Telegram Bot API client (I4) — owner: Ali. Plain fetch, no library.
 * Every call is recorded in integration_events (I5.4). The bot token comes from the
 * workspace's Integrations page (getConfig(ws,'telegram') → { bot_token }) and never leaves the server.
 */
const { getConfig, markOk, markError } = require('./integrationsStore');
const { recordEvent } = require('./integrationEvents');

const API = 'https://api.telegram.org';
const TIMEOUT_MS = 8000;

function maskChat(chatId) {
  const s = String(chatId || '');
  return s.length > 4 ? `…${s.slice(-4)}` : s;
}

async function safe(fn) {
  try { await fn(); } catch (err) { console.error('[telegram] bookkeeping failed:', err.message); }
}

/**
 * Send one message. Resolves with Telegram's message object.
 * Throws an Error with:
 *   .temporary  true → worth retrying later (network, 429, 5xx)
 *   .permanent  true → retrying won't help (no bot connected, bad token, chat not found)
 */
async function sendMessage({ ws, chatId, text, kind }) {
  const eventKind = kind || 'send_message';
  const cfg = await getConfig(ws, 'telegram');
  if (!cfg || !cfg.bot_token) {
    const err = new Error('Telegram is not connected for this workspace. An Admin can add the bot token on Settings → Integrations.');
    err.permanent = true;
    await safe(() => recordEvent({
      ws, provider: 'telegram', direction: 'out', kind: eventKind, external_id: null,
      status: 'error', http_status: null, error: err.message, detail: { chat: maskChat(chatId) },
    }));
    throw err;
  }
  if (!chatId) {
    const err = new Error('This employee has not set a Telegram chat ID on their Profile.');
    err.permanent = true;
    throw err;
  }

  let res;
  let body = {};
  try {
    res = await fetch(`${API}/bot${cfg.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = await res.json().catch(() => ({}));
  } catch (netErr) {
    const err = new Error(`Could not reach Telegram (${netErr.name === 'TimeoutError' ? 'timed out' : netErr.message})`);
    err.temporary = true;
    await safe(() => recordEvent({
      ws, provider: 'telegram', direction: 'out', kind: eventKind, external_id: null,
      status: 'error', http_status: null, error: err.message, detail: { chat: maskChat(chatId) },
    }));
    await safe(() => markError(ws, 'telegram', err.message));
    throw err;
  }

  if (!res.ok || !body.ok) {
    const description = body.description || `HTTP ${res.status}`;
    const status = res.status;
    let message = `Telegram refused the message: ${description}`;
    if (status === 401 || status === 404) message = 'Telegram rejected the bot token. Reconnect Telegram on Settings → Integrations.';
    else if (status === 400 && /chat not found/i.test(description)) {
      message = 'Telegram chat not found. The employee must open the bot, send /start, and re-check the chat ID on their Profile.';
    } else if (status === 403) message = 'The employee blocked the bot or never started it (send /start to the bot).';

    const err = new Error(message);
    err.http_status = status;
    err.temporary = status === 429 || status >= 500;
    err.permanent = !err.temporary;
    if (body.parameters && body.parameters.retry_after) err.retryAfter = body.parameters.retry_after;

    await safe(() => recordEvent({
      ws, provider: 'telegram', direction: 'out', kind: eventKind, external_id: null,
      status: 'error', http_status: status, error: description, detail: { chat: maskChat(chatId) },
    }));
    // A bad token / outage is an integration problem; a single user's wrong chat id is not.
    if (status === 401 || status === 404 || err.temporary) {
      await safe(() => markError(ws, 'telegram', message));
    }
    throw err;
  }

  const messageId = body.result && body.result.message_id;
  await safe(() => recordEvent({
    ws, provider: 'telegram', direction: 'out', kind: eventKind,
    external_id: messageId ? String(messageId) : null,
    status: 'ok', http_status: res.status, error: null, detail: { chat: maskChat(chatId) },
  }));
  await safe(() => markOk(ws, 'telegram'));
  return body.result;
}

module.exports = { sendMessage, maskChat };
