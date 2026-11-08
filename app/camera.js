// Rear camera access (spec §2, §6: rear camera, no mirroring).

const BASE = { width: { ideal: 1280 }, height: { ideal: 720 } };

/** @returns {Promise<MediaStream>} */
export async function startRearCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const e = new Error('getUserMedia unavailable');
    e.name = 'NotSupportedError';
    throw e;
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false, video: { ...BASE, facingMode: { exact: 'environment' } },
    });
  } catch (err) {
    if (err?.name !== 'OverconstrainedError' && err?.name !== 'NotFoundError') throw err;
    // Devices without an explicitly "environment" camera: fall back to a preference.
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { ...BASE, facingMode: 'environment' } });
  }
}

/**
 * @param {any} err
 * @param {boolean} isSecureContext
 * @returns {'insecure'|'denied'|'notfound'|'busy'|'unknown'}
 */
export function classifyCameraError(err, isSecureContext) {
  if (!isSecureContext) return 'insecure';
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'notfound';
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    default:
      return 'unknown';
  }
}

export const CAMERA_ERROR_TEXT = {
  insecure: 'HTTPS 주소에서만 카메라를 사용할 수 있습니다. https:// 로 시작하는 주소로 접속하세요.',
  denied: '카메라 권한이 거부되었습니다. 주소창 왼쪽 아이콘 → 권한에서 카메라를 허용한 뒤 다시 시도하세요.',
  notfound: '후면 카메라를 찾을 수 없습니다. 다른 기기에서 시도하세요.',
  busy: '카메라를 열 수 없습니다. 다른 앱이 카메라를 사용 중인지 확인 후 다시 시도하세요.',
  ended: '카메라 연결이 끊어졌습니다. 다시 시도하세요.',
  unknown: '카메라를 시작하지 못했습니다. 다시 시도하세요.',
};
