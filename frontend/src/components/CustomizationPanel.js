import React from 'react';
import './CustomizationPanel.css';

export default function CustomizationPanel({ settings, onChange }) {
  const handleChange = (key, value) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div className="customization-panel">
      <h3 className="panel-title">🎛️ Audio Settings</h3>

      <div className="control-group">
        <div className="control-header">
          <label>Key</label>
          <span className="control-value">
            {settings.key > 0 ? `+${settings.key}` : settings.key} semitones
          </span>
        </div>
        <input
          type="range"
          min="-6"
          max="6"
          step="1"
          value={settings.key}
          onChange={(e) => handleChange('key', parseInt(e.target.value))}
          className="range-input"
        />
        <div className="range-labels">
          <span>-6</span>
          <span>0</span>
          <span>+6</span>
        </div>
      </div>

      <div className="control-group">
        <div className="control-header">
          <label>Tempo</label>
          <span className="control-value">{settings.tempo.toFixed(2)}×</span>
        </div>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.05"
          value={settings.tempo}
          onChange={(e) => handleChange('tempo', parseFloat(e.target.value))}
          className="range-input"
        />
        <div className="range-labels">
          <span>0.5×</span>
          <span>1.0×</span>
          <span>2.0×</span>
        </div>
      </div>

      <div className="control-group">
        <div className="control-header">
          <label>Vocal Level</label>
          <span className="control-value">{settings.vocalLevel}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={settings.vocalLevel}
          onChange={(e) => handleChange('vocalLevel', parseInt(e.target.value))}
          className="range-input"
        />
        <div className="range-labels">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      <button
        className="btn-reset"
        onClick={() => onChange({ key: 0, tempo: 1.0, vocalLevel: 100 })}
      >
        Reset to Defaults
      </button>
    </div>
  );
}
