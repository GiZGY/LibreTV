export const STATUS = Object.freeze({
  READY: 'ready',
  TIMEOUT: 'timeout',
  UNSUPPORTED: 'unsupported',
  LOGIN_REQUIRED: 'login_required',
  NO_RESULT: 'no_result',
  ERROR: 'error'
});

export function statusResponse(status, message, extra = {}) {
  return {
    status,
    message,
    ...extra
  };
}
