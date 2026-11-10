// Bound attendance Auth, REST, RPC and Functions requests. Never retry writes here:
// a missing response does not mean the transaction was rolled back.
export function createDeadlineFetch(fetcher, timeoutMs = 20000) {
  return async (input, init = {}) => {
    const url=new URL(typeof input==='string'||input instanceof URL ? String(input) : input.url);
    // File transfers keep their existing transport and response streaming.
    if(url.pathname.startsWith('/storage/v1/'))return fetcher(input,init);
    const controller = new AbortController();
    const signal = init.signal || input?.signal;
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, {once:true});
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('הבקשה לא הסתיימה בזמן. הנתונים בטופס נשמרו; בדקו חיבור ונסו שוב.');
        error.name = 'AttendanceTimeoutError';
        reject(error);
        controller.abort(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetcher(input, {...init, signal:controller.signal});
        // Headers alone are not completion: a stalled response body must also expire.
        const body = await response.arrayBuffer();
        return new Response([204,205,304].includes(response.status) ? null : body, {
          status:response.status, statusText:response.statusText, headers:response.headers
        });
      })()]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}
