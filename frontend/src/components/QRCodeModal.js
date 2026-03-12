import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getServerInfo } from '../services/api';
import './QRCodeModal.css';

export default function QRCodeModal({ party }) {
  const joinUrl = `${window.location.origin}/join/${party.join_code}`;
  const [ipJoinUrl, setIpJoinUrl] = useState(null);
  const [activeQr, setActiveQr] = useState('hostname');

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
      .catch(() => { console.warn('Could not retrieve server IP address'); });
  }, [party.join_code]);

  const activeUrl = activeQr === 'ip' && ipJoinUrl ? ipJoinUrl : joinUrl;

  return (
    <div className="qr-panel">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Join "{party.name}"</h2>
        </div>

        {ipJoinUrl && (
          <div className="qr-toggle">
            <button
              className={`qr-toggle-btn${activeQr === 'hostname' ? ' active' : ''}`}
              onClick={() => setActiveQr('hostname')}
            >
              Hostname
            </button>
            <button
              className={`qr-toggle-btn${activeQr === 'ip' ? ' active' : ''}`}
              onClick={() => setActiveQr('ip')}
            >
              IP Address
            </button>
          </div>
        )}

        <div className="qr-section">
          <div className="qr-wrapper">
            <QRCodeSVG
              value={activeUrl}
              size={220}
              bgColor="#ffffff"
              fgColor="#1a1a2e"
              level="M"
              includeMargin={true}
            />
          </div>
          <p className="qr-hint">
            {activeQr === 'ip' ? 'Scan to join via IP address' : 'Scan to join the party'}
          </p>
        </div>

        <div className="code-section">
          <p className="code-label">Party Code</p>
          <div className="join-code-display">{party.join_code}</div>
        </div>

        <div className="url-section">
          <p className="url-label">
            {activeQr === 'ip' ? 'IP Address Link' : 'Direct Link'}
          </p>
          <div className="url-box">
            <span className="url-text">{activeUrl}</span>
            <button
              className="copy-btn"
              onClick={() => navigator.clipboard.writeText(activeUrl)}
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
