import { useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw, X, Check, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { todayLocal } from '../lib/api.js';
import { AsyncButton } from './ui.jsx';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export default function CheckInSelfieAction({ onCheckIn, disabled = false }) {
  const { user, profile } = useAuth();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [open, photo, cameraStream]);

  // Automatically start camera when modal opens
  useEffect(() => {
    if (open && !photo && !cameraStream) {
      startCamera();
    }
  }, [open]);

  useEffect(() => () => streamRef.current?.getTracks().forEach(track => track.stop()), []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setCameraStream(null);
  }

  async function startCamera() {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser does not support camera access. Use a modern browser on HTTPS or localhost.');
      return;
    }
    try {
      stopCamera();
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setCameraStream(streamRef.current);
      setPhoto(null);
    } catch (error) {
      setCameraError(error.name === 'NotAllowedError'
        ? 'Camera permission is required to verify your check-in. Please allow camera access in your browser settings.'
        : 'Could not open the camera. Please check that it is connected and not in use by another app.');
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight) {
      setCameraError('Camera is still loading. Please try again in a moment.');
      return;
    }
    const maxWidth = 640;
    const maxHeight = 480;
    let targetWidth = video.videoWidth;
    let targetHeight = video.videoHeight;
    if (targetWidth > maxWidth) {
      targetHeight = Math.round((targetHeight * maxWidth) / targetWidth);
      targetWidth = maxWidth;
    }
    if (targetHeight > maxHeight) {
      targetWidth = Math.round((targetWidth * maxHeight) / targetHeight);
      targetHeight = maxHeight;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('Could not process camera image. Please try again.');
      return;
    }
    context.drawImage(video, 0, 0, targetWidth, targetHeight);
    canvas.toBlob(blob => {
      if (!blob) {
        setCameraError('Could not capture photo. Please try again.');
        return;
      }
      if (blob.size > MAX_FILE_SIZE) {
        setCameraError('The captured selfie is too large. Please retry.');
        return;
      }
      setPhoto(new File([blob], 'check-in-selfie.jpg', { type: 'image/jpeg' }));
      setPreviewUrl(URL.createObjectURL(blob));
      setCameraError('');
      stopCamera();
    }, 'image/jpeg', 0.82);
  }

  function close(force = false) {
    if (busy && !force) return;
    stopCamera();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setPhoto(null);
    setCameraError('');
    setOpen(false);
  }

  async function verifyAndCheckIn() {
    if (!photo) return;
    setBusy(true);
    setCameraError('');
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(photo);
      });
      await onCheckIn(base64);
      close(true);
    } catch (error) {
      setCameraError(error.message || 'Check-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="button button-emerald checkin-btn-glow"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        <Camera size={16} /> Check In
      </button>

      {open && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section className="selfie-dialog" role="dialog" aria-modal="true" aria-labelledby="selfie-title">
            <div className="selfie-dialog-heading">
              <div>
                <div className="eyebrow" style={{ color: '#2563eb', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={14} /> ATTENDANCE VERIFICATION
                </div>
                <h2 id="selfie-title">Take a Check-In Selfie</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close selfie verification"
                onClick={() => close()}
                disabled={busy}
              >
                <X size={17} />
              </button>
            </div>

            <p>Your selfie is verified and attached to today’s attendance record for workplace compliance.</p>

            <div className="selfie-camera">
              {photo && previewUrl ? (
                <>
                  <img src={previewUrl} alt="Check-in selfie preview" />
                  <span className="selfie-status-pill pill-captured">
                    <Check size={12} /> Photo Ready
                  </span>
                </>
              ) : (
                <>
                  <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" />
                  {cameraStream && (
                    <span className="selfie-status-pill pill-live">
                      <span className="live-dot" /> Live Camera
                    </span>
                  )}
                </>
              )}
              {!cameraStream && !photo && (
                <div className="selfie-camera-placeholder">
                  <Camera size={32} />
                  <span>Starting camera…</span>
                </div>
              )}
            </div>

            {cameraError && (
              <div className="selfie-error-banner" role="alert">
                <span>{cameraError}</span>
              </div>
            )}

            <div className="selfie-actions">
              {photo ? (
                <button
                  type="button"
                  className="button button-outline"
                  disabled={busy}
                  onClick={startCamera}
                >
                  <RotateCcw size={15} /> Retake
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-outline"
                  disabled={busy}
                  onClick={startCamera}
                >
                  <Camera size={15} /> Reset Camera
                </button>
              )}

              {!photo ? (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!cameraStream || busy}
                  onClick={capturePhoto}
                  style={{ minWidth: 140 }}
                >
                  <Camera size={15} /> Capture Photo
                </button>
              ) : (
                <AsyncButton
                  className="button button-emerald"
                  busy={busy}
                  onClick={verifyAndCheckIn}
                  style={{ minWidth: 170 }}
                >
                  <Check size={15} /> Verify &amp; Check In
                </AsyncButton>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
