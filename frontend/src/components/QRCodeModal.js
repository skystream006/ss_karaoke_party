import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getServerInfo } from '../services/api';
import './QRCodeModal.css';

export default function QRCodeModal({ party }) {
  const joinUrl = `${window.location.origin}/join/${party.join_code}`;
  const [ipJoinUrl, setIpJoinUrl] = useState(null);

  useEffect(() => {
    getServerInfo()
      .then(({ data }) => {
        if (data.ip) {
          const { protocol, port } = window.location;
          const isDefaultPort =
            (protocol === 'http:' && port === '80') ||
            (protocol === 'https:' && port === '443') ||
            port === '';
          const portSuffix = isDefaultPort ? '' : `:${port}`;
          setIpJoinUrl(`${protocol}//${data.ip}${portSuffix}/join/${party.join_code}`);
        }
      })
      .catch(() => {});
  }, [party.join_code]);

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

        {ipJoinUrl && (
          <div className="qr-section">
            <div className="qr-wrapper">
              <QRCodeSVG
                value={ipJoinUrl}
                size={220}
                bgColor="#ffffff"
                fgColor="#1a1a2e"
                level="M"
                includeMargin={true}
              />
            </div>
            <p className="qr-hint">Scan to join via IP address</p>
          </div>
        )}

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

        {ipJoinUrl && (
          <div className="url-section" style={{ marginTop: '1rem' }}>
            <p className="url-label">IP Address Link</p>
            <div className="url-box">
              <span className="url-text">{ipJoinUrl}</span>
              <button
                className="copy-btn"
                onClick={() => navigator.clipboard.writeText(ipJoinUrl)}
                title="Copy IP link"
              >
                📋 Copy
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
