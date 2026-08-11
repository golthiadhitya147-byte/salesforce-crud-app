import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE = 'http://localhost:3000';
const OBJECTS = ['Account', 'Opportunity', 'Lead', 'Contact', 'Case'];

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedObject, setSelectedObject] = useState('');
  const [fields, setFields] = useState([]);
  const [records, setRecords] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [formData, setFormData] = useState({});
  const tableContainerRef = useRef(null);

  // Check login status on load (and after redirect back from Salesforce)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('login') === 'success') {
      setIsLoggedIn(true);
      window.history.replaceState({}, '', '/');
    } else {
      axios.get(`${API_BASE}/whoami`)
        .then(() => setIsLoggedIn(true))
        .catch(() => setIsLoggedIn(false));
    }
  }, []);

  // Load fields + first page of records when object changes
  useEffect(() => {
    if (!selectedObject || !isLoggedIn) return;
    setRecords([]);
    setOffset(0);
    setHasMore(true);

    axios.get(`${API_BASE}/api/objects/${selectedObject}/fields`)
      .then(res => setFields(res.data))
      .catch(err => console.error('Failed to load fields', err));

    loadRecords(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedObject, isLoggedIn]);

  const loadRecords = useCallback((currentOffset, replace = false) => {
    if (!selectedObject) return;
    setLoading(true);
    axios.get(`${API_BASE}/api/objects/${selectedObject}/records`, {
      params: { offset: currentOffset }
    })
      .then(res => {
        setRecords(prev => replace ? res.data.records : [...prev, ...res.data.records]);
        setHasMore(res.data.hasMore);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load records', err);
        setLoading(false);
      });
  }, [selectedObject]);

  // Infinite scroll handler
  const handleScroll = () => {
    const el = tableContainerRef.current;
    if (!el || loading || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      const newOffset = offset + 20;
      setOffset(newOffset);
      loadRecords(newOffset);
    }
  };

  const handleLogin = () => {
    window.location.href = `${API_BASE}/login`;
  };

  const openCreateForm = () => {
    setEditingRecord(null);
    const initial = {};
    fields.forEach(f => { initial[f.name] = ''; });
    setFormData(initial);
    setShowForm(true);
  };

  const openEditForm = (record) => {
    setEditingRecord(record);
    const initial = {};
    fields.forEach(f => { initial[f.name] = record[f.name] || ''; });
    setFormData(initial);
    setShowForm(true);
  };

  const handleFormChange = (fieldName, value) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
  };

  const handleSave = async () => {
    try {
      if (editingRecord) {
        await axios.patch(`${API_BASE}/api/objects/${selectedObject}/records/${editingRecord.Id}`, formData);
      } else {
        await axios.post(`${API_BASE}/api/objects/${selectedObject}/records`, formData);
      }
      setShowForm(false);
      setOffset(0);
      loadRecords(0, true);
    } catch (err) {
      alert('Save failed: ' + JSON.stringify(err.response?.data || err.message));
    }
  };

  const handleDelete = async (record) => {
    if (!window.confirm(`Delete this ${selectedObject}? This cannot be undone.`)) return;
    try {
      await axios.delete(`${API_BASE}/api/objects/${selectedObject}/records/${record.Id}`);
      setOffset(0);
      loadRecords(0, true);
    } catch (err) {
      alert('Delete failed: ' + JSON.stringify(err.response?.data || err.message));
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="login-screen">
        <h1>Salesforce CRUD App</h1>
        <p>Log in with your Salesforce account to manage your data.</p>
        <button className="btn btn-primary" onClick={handleLogin}>
          Log in to Salesforce
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Salesforce CRUD App</h1>
        <select
          value={selectedObject}
          onChange={e => setSelectedObject(e.target.value)}
          className="object-dropdown"
        >
          <option value="">-- Select an object --</option>
          {OBJECTS.map(obj => <option key={obj} value={obj}>{obj}</option>)}
        </select>
        {selectedObject && (
          <button className="btn btn-primary" onClick={openCreateForm}>
            + New {selectedObject}
          </button>
        )}
      </header>

      {selectedObject && (
        <div
          className="table-container"
          ref={tableContainerRef}
          onScroll={handleScroll}
        >
          <table>
            <thead>
              <tr>
                {fields.map(f => <th key={f.name}>{f.label}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map(record => (
                <tr key={record.Id}>
                  {fields.map(f => <td key={f.name}>{String(record[f.name] ?? '')}</td>)}
                  <td>
                    <button className="btn btn-small" onClick={() => openEditForm(record)}>Edit</button>
                    <button className="btn btn-small btn-danger" onClick={() => handleDelete(record)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <p className="loading-text">Loading more records...</p>}
          {!hasMore && records.length > 0 && <p className="loading-text">No more records.</p>}
          {records.length === 0 && !loading && <p className="loading-text">No records found.</p>}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{editingRecord ? `Edit ${selectedObject}` : `New ${selectedObject}`}</h2>
            {fields.map(f => (
              <div className="form-field" key={f.name}>
                <label>{f.label}</label>
                {f.picklistValues && f.picklistValues.length > 0 ? (
                  <select
                    value={formData[f.name] || ''}
                    onChange={e => handleFormChange(f.name, e.target.value)}
                  >
                    <option value="">-- Select --</option>
                    {f.picklistValues.map(val => <option key={val} value={val}>{val}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={formData[f.name] || ''}
                    onChange={e => handleFormChange(f.name, e.target.value)}
                  />
                )}
              </div>
            ))}
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={handleSave}>Save</button>
              <button className="btn" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;