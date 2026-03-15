import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAllParties,
  updateParty,
  endParty,
  reactivateParty,
  duplicateParty,
  deleteParty,
  lockParty,
  getPartyMembers,
  updateMember,
  removeMember,
} from '../services/api';
import './SettingsPage.css';

export default function SettingsPage() {
  const navigate = useNavigate();

  // Parties state
  const [parties, setParties] = useState([]);
  const [partiesLoading, setPartiesLoading] = useState(true);
  const [partiesError, setPartiesError] = useState('');

  // Selected party for member management
  const [selectedParty, setSelectedParty] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState('');

  // Edit state for party name
  const [editingPartyId, setEditingPartyId] = useState(null);
  const [editingPartyName, setEditingPartyName] = useState('');
  const [partyEditError, setPartyEditError] = useState('');
  const [partyEditLoading, setPartyEditLoading] = useState(false);

  // Edit state for member
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [editingMemberName, setEditingMemberName] = useState('');
  const [editingMemberRole, setEditingMemberRole] = useState('guest');
  const [memberEditError, setMemberEditError] = useState('');
  const [memberEditLoading, setMemberEditLoading] = useState(false);

  // Confirmation dialogs
  const [confirmDelete, setConfirmDelete] = useState(null); // { type: 'party'|'member', id, partyId? }

  const loadParties = useCallback(async () => {
    setPartiesLoading(true);
    setPartiesError('');
    try {
      const res = await getAllParties();
      setParties(res.data);
    } catch (err) {
      setPartiesError(err.response?.data?.error || 'Failed to load parties.');
    } finally {
      setPartiesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadParties();
  }, [loadParties]);

  const loadMembers = useCallback(async (party) => {
    setSelectedParty(party);
    setMembers([]);
    setMembersError('');
    setEditingMemberId(null);
    setMembersLoading(true);
    try {
      const res = await getPartyMembers(party.id);
      setMembers(res.data);
    } catch (err) {
      setMembersError(err.response?.data?.error || 'Failed to load members.');
    } finally {
      setMembersLoading(false);
    }
  }, []);

  // Party editing
  const startEditParty = (party) => {
    setEditingPartyId(party.id);
    setEditingPartyName(party.name);
    setPartyEditError('');
  };

  const cancelEditParty = () => {
    setEditingPartyId(null);
    setEditingPartyName('');
    setPartyEditError('');
  };

  const saveEditParty = async (partyId) => {
    if (!editingPartyName.trim()) {
      setPartyEditError('Party name cannot be empty.');
      return;
    }
    setPartyEditLoading(true);
    setPartyEditError('');
    try {
      const res = await updateParty(partyId, { name: editingPartyName.trim() });
      setParties((prev) => prev.map((p) => (p.id === partyId ? res.data : p)));
      if (selectedParty?.id === partyId) {
        setSelectedParty(res.data);
      }
      setEditingPartyId(null);
    } catch (err) {
      setPartyEditError(err.response?.data?.error || 'Failed to update party.');
    } finally {
      setPartyEditLoading(false);
    }
  };

  // Party status toggle
  const handleTogglePartyStatus = async (party) => {
    try {
      if (party.is_active) {
        await endParty(party.id);
        setParties((prev) =>
          prev.map((p) => (p.id === party.id ? { ...p, is_active: false } : p))
        );
        if (selectedParty?.id === party.id) {
          setSelectedParty((prev) => ({ ...prev, is_active: false }));
        }
      } else {
        const res = await reactivateParty(party.id);
        setParties((prev) => prev.map((p) => (p.id === party.id ? res.data : p)));
        if (selectedParty?.id === party.id) {
          setSelectedParty(res.data);
        }
      }
    } catch (err) {
      setPartiesError(err.response?.data?.error || 'Failed to update party status.');
    }
  };

  // Party lock toggle
  const handleTogglePartyLock = async (party) => {
    try {
      const res = await lockParty(party.id, !party.is_locked);
      setParties((prev) => prev.map((p) => (p.id === party.id ? res.data : p)));
      if (selectedParty?.id === party.id) {
        setSelectedParty(res.data);
      }
    } catch (err) {
      setPartiesError(err.response?.data?.error || 'Failed to update party lock.');
    }
  };

  // Party duplicate
  const handleDuplicateParty = async (party) => {
    try {
      const res = await duplicateParty(party.id);
      setParties((prev) => [res.data.party, ...prev]);
    } catch (err) {
      setPartiesError(err.response?.data?.error || 'Failed to duplicate party.');
    }
  };

  // Party permanent delete
  const handleDeleteParty = async (partyId) => {
    try {
      await deleteParty(partyId);
      setParties((prev) => prev.filter((p) => p.id !== partyId));
      if (selectedParty?.id === partyId) {
        setSelectedParty(null);
        setMembers([]);
      }
    } catch (err) {
      setPartiesError(err.response?.data?.error || 'Failed to delete party.');
    } finally {
      setConfirmDelete(null);
    }
  };

  // Member editing
  const startEditMember = (member) => {
    setEditingMemberId(member.id);
    setEditingMemberName(member.name);
    setEditingMemberRole(member.role);
    setMemberEditError('');
  };

  const cancelEditMember = () => {
    setEditingMemberId(null);
    setEditingMemberName('');
    setEditingMemberRole('guest');
    setMemberEditError('');
  };

  const saveEditMember = async (memberId) => {
    if (!editingMemberName.trim()) {
      setMemberEditError('Member name cannot be empty.');
      return;
    }
    setMemberEditLoading(true);
    setMemberEditError('');
    try {
      const res = await updateMember(selectedParty.id, memberId, {
        name: editingMemberName.trim(),
        role: editingMemberRole,
      });
      setMembers((prev) => prev.map((m) => (m.id === memberId ? res.data : m)));
      setEditingMemberId(null);
    } catch (err) {
      setMemberEditError(err.response?.data?.error || 'Failed to update member.');
    } finally {
      setMemberEditLoading(false);
    }
  };

  // Member delete
  const handleRemoveMember = async (memberId) => {
    try {
      await removeMember(selectedParty.id, memberId);
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err) {
      setMembersError(err.response?.data?.error || 'Failed to remove member.');
    } finally {
      setConfirmDelete(null);
    }
  };

  const handleConfirmDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === 'party') {
      handleDeleteParty(confirmDelete.id);
    } else if (confirmDelete.type === 'member') {
      handleRemoveMember(confirmDelete.id);
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="settings-container">
      <header className="settings-header">
        <button className="btn btn-ghost settings-back-btn" onClick={() => navigate('/')}>
          ← Back
        </button>
        <div className="settings-header-title">
          <span className="settings-icon">⚙️</span>
          <h1>Settings</h1>
        </div>
      </header>

      <div className="settings-content">
        {/* Parties Section (left column) */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h2>🎉 Parties</h2>
            <span className="settings-count">{parties.length} total</span>
          </div>

          {partiesError && <div className="settings-error">{partiesError}</div>}

          {partiesLoading ? (
            <div className="settings-loading">Loading parties…</div>
          ) : parties.length === 0 ? (
            <div className="settings-empty">No parties found.</div>
          ) : (
            <div className="settings-list">
              {parties.map((party) => (
                <div
                  key={party.id}
                  className={`settings-item ${selectedParty?.id === party.id ? 'settings-item--selected' : ''}`}
                >
                  <div className="settings-item-main">
                    {editingPartyId === party.id ? (
                      <div className="settings-inline-edit">
                        <input
                          type="text"
                          value={editingPartyName}
                          onChange={(e) => setEditingPartyName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditParty(party.id);
                            if (e.key === 'Escape') cancelEditParty();
                          }}
                          autoFocus
                          maxLength={100}
                          className="settings-inline-input"
                        />
                        {partyEditError && (
                          <span className="settings-inline-error">{partyEditError}</span>
                        )}
                        <div className="settings-inline-actions">
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => saveEditParty(party.id)}
                            disabled={partyEditLoading}
                          >
                            Save
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={cancelEditParty}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="settings-item-info">
                        <div className="settings-item-name">
                          {party.name}
                          <span
                            className={`settings-badge ${party.is_active ? 'settings-badge--active' : 'settings-badge--inactive'}`}
                          >
                            {party.is_active ? 'Active' : 'Ended'}
                          </span>
                          {party.is_locked && (
                            <span className="settings-badge settings-badge--locked">🔒 Locked</span>
                          )}
                        </div>
                        <div className="settings-item-meta">
                          Code: <strong>{party.join_code}</strong> · Created{' '}
                          {formatDate(party.created_at)}
                        </div>
                      </div>
                    )}
                  </div>

                  {editingPartyId !== party.id && (
                    <div className="settings-item-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => loadMembers(party)}
                        title="Manage members"
                      >
                        👥 Members
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => startEditParty(party)}
                        title="Rename party"
                      >
                        ✏️
                      </button>
                      <button
                        className={`btn btn-sm ${party.is_locked ? 'btn-success' : 'btn-warning'}`}
                        onClick={() => handleTogglePartyLock(party)}
                        title={party.is_locked ? 'Unlock party queue' : 'Lock party queue'}
                      >
                        {party.is_locked ? '🔓 Unlock' : '🔒 Lock'}
                      </button>
                      <button
                        className={`btn btn-sm ${party.is_active ? 'btn-warning' : 'btn-success'}`}
                        onClick={() => handleTogglePartyStatus(party)}
                        title={party.is_active ? 'End party' : 'Reactivate party'}
                      >
                        {party.is_active ? '⏹ End' : '▶ Reactivate'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDuplicateParty(party)}
                        title="Duplicate party"
                      >
                        📋 Duplicate
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() =>
                          setConfirmDelete({ type: 'party', id: party.id, name: party.name })
                        }
                        title="Permanently delete party"
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Members Section (right column) */}
        <section className="settings-section">
          <div className="settings-section-header">
            <h2>
              👥 Members
              {selectedParty && (
                <>
                  {' '}—{' '}
                  <span className="settings-section-subtitle">{selectedParty.name}</span>
                </>
              )}
            </h2>
            {selectedParty && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSelectedParty(null);
                  setMembers([]);
                  setEditingMemberId(null);
                }}
              >
                ✕ Close
              </button>
            )}
          </div>

          {!selectedParty ? (
            <div className="settings-empty settings-members-placeholder">
              Select a party to view its members.
            </div>
          ) : (
            <>
              {membersError && <div className="settings-error">{membersError}</div>}

              {membersLoading ? (
                <div className="settings-loading">Loading members…</div>
              ) : members.length === 0 ? (
                <div className="settings-empty">No members in this party.</div>
              ) : (
                <div className="settings-list">
                  {members.map((member) => (
                    <div key={member.id} className="settings-item">
                      <div className="settings-item-main">
                        {editingMemberId === member.id ? (
                          <div className="settings-inline-edit">
                            <input
                              type="text"
                              value={editingMemberName}
                              onChange={(e) => setEditingMemberName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEditMember(member.id);
                                if (e.key === 'Escape') cancelEditMember();
                              }}
                              autoFocus
                              maxLength={60}
                              className="settings-inline-input"
                            />
                            <select
                              value={editingMemberRole}
                              onChange={(e) => setEditingMemberRole(e.target.value)}
                              className="settings-inline-select"
                            >
                              <option value="organizer">Organizer</option>
                              <option value="guest">Guest</option>
                            </select>
                            {memberEditError && (
                              <span className="settings-inline-error">{memberEditError}</span>
                            )}
                            <div className="settings-inline-actions">
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => saveEditMember(member.id)}
                                disabled={memberEditLoading}
                              >
                                Save
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={cancelEditMember}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="settings-item-info">
                            <div className="settings-item-name">
                              {member.name}
                              <span
                                className={`settings-badge ${member.role === 'organizer' ? 'settings-badge--organizer' : 'settings-badge--guest'}`}
                              >
                                {member.role}
                              </span>
                            </div>
                            <div className="settings-item-meta">
                              Joined {formatDate(member.joined_at)}
                            </div>
                          </div>
                        )}
                      </div>

                      {editingMemberId !== member.id && (
                        <div className="settings-item-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => startEditMember(member)}
                            title="Edit member"
                          >
                            ✏️
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() =>
                              setConfirmDelete({
                                type: 'member',
                                id: member.id,
                                name: member.name,
                              })
                            }
                            title="Remove member"
                          >
                            🗑
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Confirmation Modal */}
      {confirmDelete && (
        <div className="settings-modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm Delete</h3>
            <p>
              {confirmDelete.type === 'party'
                ? `Permanently delete the party "${confirmDelete.name}"? This will also remove all members and queue entries.`
                : `Remove member "${confirmDelete.name}" from this party?`}
            </p>
            <div className="settings-modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleConfirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
