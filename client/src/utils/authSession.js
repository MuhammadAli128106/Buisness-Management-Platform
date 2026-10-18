let handler = null;
export function setUnauthorizedHandler(fn) { handler = fn; }
export function handleUnauthorized() { if (handler) handler(); }
