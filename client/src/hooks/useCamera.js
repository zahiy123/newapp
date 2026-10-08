import { useRef, useState, useCallback } from 'react';

// Wide view (owner): the camera's full field of view so the whole trainee fits.
//   • 4:3 — on phones the full sensor is 4:3; 16:9 modes CROP the top / bottom (less of the body)
//   • resizeMode 'none' — the browser must not crop / rescale the frame to the asked size
//   • zoom at its minimum (widest) where the camera supports zoom
// The resolution is high enough for precise landmarks but not so high that pose detection slows
// down. Fallbacks: the wide request fails on some devices → the previous plain request.
const WIDE_VIDEO = {
  facingMode: 'user',
  width: { ideal: 1280 },
  height: { ideal: 960 },
  aspectRatio: { ideal: 4 / 3 },
  resizeMode: { ideal: 'none' },
};
const BASIC_VIDEO = { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } };

/** Zoom out to the widest view the camera allows (no-op where zoom is not supported). */
export async function widestZoom(track) {
  try {
    const caps = track?.getCapabilities?.();
    if (caps?.zoom && typeof caps.zoom.min === 'number') {
      await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
    }
  } catch { /* zoom not adjustable — keep the default */ }
}

export function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);

  const start = useCallback(async () => {
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: WIDE_VIDEO, audio: false });
      } catch (wideErr) {
        if (wideErr?.name === 'NotAllowedError' || wideErr?.name === 'SecurityError') throw wideErr;
        stream = await navigator.mediaDevices.getUserMedia({ video: BASIC_VIDEO, audio: false });
      }
      await widestZoom(stream.getVideoTracks()[0]);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
      setError(null);
    } catch (err) {
      setError(err.message);
      setActive(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActive(false);
  }, []);

  return { videoRef, active, error, start, stop };
}
