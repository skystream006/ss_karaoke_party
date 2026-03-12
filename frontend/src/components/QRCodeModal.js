import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import './QRCodeModal.css';

export default function QRCodeModal({ party }) {
  const joinUrl = `${window.location.origin}/join/${party.join_code}`;

  return (
    <div className="qr-panel">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Join "{party.name}"</h2>
        </div>

        <div className="qr-section">
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
          <p className="qr-hint">Scan to join the party</p>
        </div>

        <div className="code-section">
          <p className="code-label">Party Code</p>
          <div className="join-code-display">{party.join_code}</div>
        </div>

        <div className="url-section">
          <p className="url-label">Direct Link</p>
          <div className="url-box">
            <span className="url-text">{joinUrl}</span>
            <button
              className="copy-btn"
              onClick={() => navigator.clipboard.writeText(joinUrl)}
              title="Copy link"
            >
              📋 Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
