import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, RefreshCw, Check } from 'lucide-react';
import { createPartyInvitation } from '../services/api';
import './QRCodeModal.css';

export default function QRCodeModal({ party }) {
  const [invitation, setInvitation] = useState(null);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const requestRef = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setInvitation(null);
    setError('');
    setCopied(false);
    if (requestRef.current?.partyId !== party.id || requestRef.current?.generation !== generation) {
      requestRef.current = { partyId: party.id, generation, promise: createPartyInvitation(party.id) };
    }
    requestRef.current.promise
      .then(({ data }) => { if (active) setInvitation(data); })
      .catch((failure) => { if (active) setError(failure.response?.data?.error || 'Unable to create invitation.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [party.id, generation]);

  const joinUrl = invitation ? `${window.location.origin}/join/invite#invite=${invitation.token}` : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
    } catch {
      setError('Clipboard unavailable. Select the invitation link to copy it.');
    }
  };

  return (
    <div className="party-invitation">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Join "{party.name}"</h2>
        </div>

        {error && <p className="error-msg" role="alert">{error}</p>}
        {loading && <p role="status">Creating invitation...</p>}
        {invitation && <><div className="qr-section">
          <div className="qr-wrapper">
            <QRCodeSVG
              value={joinUrl}
              size={220}
              bgColor="#ffffff"
              fgColor="#1a1a2e"
              level="M"
              includeMargin={true}
            />
          </div>
          <p className="qr-hint">Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
        </div>

        <div className="url-section">
          <p className="url-label">Invitation link</p>
          <div className="url-box">
            <span className="url-text">{joinUrl}</span>
            <button className="copy-btn" onClick={copy} type="button" aria-label={copied ? 'Copied' : 'Copy invitation link'}
              title={copied ? 'Copied' : 'Copy invitation link'}>
              {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
            </button>
          </div>
        </div></>}
        <button type="button" className="btn btn-ghost qr-regenerate" disabled={loading}
          onClick={() => {
            if (!invitation || window.confirm('Replace this QR code and disconnect guests who joined with it?')) {
              setGeneration((current) => current + 1);
            }
          }}>
          <RefreshCw size={17} aria-hidden="true" /> {invitation ? 'New QR code' : 'Retry'}
        </button>
      </div>
    </div>
  );
}
