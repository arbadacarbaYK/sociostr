import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Icon } from 'leaflet';
import axios from 'axios';
import { bech32 } from 'bech32';
import 'leaflet/dist/leaflet.css';
import './App.css';

interface User {
  pubkey: string;
  name: string;
  display_name?: string;
  about?: string;
  picture?: string;
  location: {
    latitude: number;
    longitude: number;
    confidence: number;
    method: string;
  };
  activityType: 'profile' | 'post' | 'zap';
  lastSeen: number;
}

interface Stats {
  totalUsers: number;
  usersWithLocation: number;
  uniqueCountries: number;
}

const App: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([0, 0]);
  const [mapZoom, setMapZoom] = useState(2);
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, usersWithLocation: 0, uniqueCountries: 0 });
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastUpdateTimestamp, setLastUpdateTimestamp] = useState<number | null>(null);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Convert hex pubkey to npub
  const hexToNpub = (hex: string): string => {
    try {
      const words = bech32.toWords(Buffer.from(hex, 'hex'));
      return bech32.encode('npub', words);
    } catch (error) {
      console.error('Error converting hex to npub:', error);
      return hex;
    }
  };

  // Create user icon with activity type colors
  const createUserIcon = (activityType: string): Icon => {
    let color = '#9b59b6'; // purple for profile
    if (activityType === 'post') color = '#e67e22'; // orange for posts
    if (activityType === 'zap') color = '#f1c40f'; // yellow for zaps

    return new Icon({
      iconUrl: `data:image/svg+xml;base64,${btoa(`
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" fill="${color}" stroke="#000" stroke-width="2"/>
          <circle cx="12" cy="12" r="4" fill="#fff"/>
        </svg>
      `)}`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -12]
    });
  };

  // Update stats
  const updateStats = (userList: User[]) => {
    const usersWithLocation = userList.filter(user => 
      user.location && 
      user.location.latitude && 
      user.location.longitude &&
      user.location.method !== 'fallback'
    );
    
    const uniqueCountries = new Set(
      usersWithLocation
        .map(user => user.location.method)
        .filter(method => method && method !== 'fallback' && method !== 'unknown')
    ).size;

    setStats({
      totalUsers: userList.length,
      usersWithLocation: usersWithLocation.length,
      uniqueCountries
    });
  };

  // Clean up inactive users
  const cleanupInactiveUsers = () => {
    setUsers(prevUsers => {
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      const activeUsers = prevUsers.filter(user => 
        user.lastSeen && user.lastSeen > fiveMinutesAgo
      );
      
      if (activeUsers.length !== prevUsers.length) {
        console.log(`Cleaned up ${prevUsers.length - activeUsers.length} inactive users`);
        updateStats(activeUsers);
      }
      
      return activeUsers;
    });
  };

  // Start auto-update
  const startAutoUpdate = () => {
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
    }
    updateIntervalRef.current = setInterval(() => {
      if (autoUpdateEnabled && !loading && !isUpdating) {
        console.log('Auto-updating users...');
        setLastUpdateTimestamp(Date.now());
        fetchUsers(true);
        cleanupInactiveUsers();
      }
    }, 2 * 60 * 1000); // 2 minutes
  };

  // Stop auto-update
  const stopAutoUpdate = () => {
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }
  };

  // Fetch users from backend
  const fetchUsers = async (isAutoUpdate = false) => {
    if (isAutoUpdate) {
      setIsUpdating(true);
    } else {
      setLoading(true);
      setError(null);
      setUsers([]);
    }

    try {
      const baseURL = process.env.NODE_ENV === 'production' 
        ? 'https://sociostr-backend.onrender.com'
        : 'http://localhost:3000';
      
      const params = isAutoUpdate && lastUpdateTimestamp ? 
        { since: Math.floor(lastUpdateTimestamp / 1000) } : {};
      
      // First fetch raw users
      const rawResponse = await axios.get(`${baseURL}/api/nostr-users`, { params });
      const { users: rawUsers } = rawResponse.data;
      
      if (rawUsers.length === 0) {
        if (isAutoUpdate) {
          console.log('No new users found during auto-update');
          setIsUpdating(false);
          setLastUpdate(new Date());
        } else {
          setError('No users found. Please try again later.');
          setLoading(false);
        }
        return;
      }

      // Then process users with geolocation
      const processResponse = await axios.post(`${baseURL}/api/process-users`, { users: rawUsers });
      const { users: fetchedUsers } = processResponse.data;
      
      // Process users with timestamps
      const processedUsers = fetchedUsers.map((user: any) => ({
        ...user,
        lastSeen: Date.now()
      }));

      if (isAutoUpdate) {
        setUsers(prevUsers => {
          const existingPubkeys = new Set(prevUsers.map(user => user.pubkey));
          const uniqueNewUsers = processedUsers.filter((user: User) => !existingPubkeys.has(user.pubkey));
          
          const newUsersWithTimestamp = uniqueNewUsers.map((user: User) => ({
            ...user,
            lastSeen: Date.now()
          }));
          
          const newPubkeys = new Set(processedUsers.map((user: User) => user.pubkey));
          const updatedExistingUsers = prevUsers.map(user => 
            newPubkeys.has(user.pubkey) 
              ? { ...user, lastSeen: Date.now() }
              : user
          );
          
          const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
          const activeUsers = updatedExistingUsers.filter(user => 
            user.lastSeen && user.lastSeen > fiveMinutesAgo
          );
          
          const finalUsers = [...activeUsers, ...newUsersWithTimestamp];
          updateStats(finalUsers);
          return finalUsers;
        });
      } else {
        setUsers(processedUsers);
        updateStats(processedUsers);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to fetch users. Please check if the server is running.');
    } finally {
      if (!isAutoUpdate) {
        setLoading(false);
      }
      if (isAutoUpdate) {
        setLastUpdate(new Date());
        setIsUpdating(false);
      } else {
        const now = Date.now();
        setLastUpdateTimestamp(now);
        startAutoUpdate();
      }
    }
  };

  // Get user location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setMapCenter([latitude, longitude]);
          setMapZoom(6);
        },
        (error) => {
          console.log('Geolocation error:', error);
          setMapCenter([0, 0]);
          setMapZoom(2);
        }
      );
    } else {
      setMapCenter([0, 0]);
      setMapZoom(2);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAutoUpdate();
    };
  }, []);

  return (
    <div className="App">
      <div className="header">
        <h1>🌐 Sociostr</h1>
        <div className="stats">
          <span>Users: {stats.totalUsers}</span>
          <span>With Location: {stats.usersWithLocation}</span>
          <span>Countries: {stats.uniqueCountries}</span>
        </div>
      </div>

      <div className="controls">
        <button 
          onClick={() => fetchUsers(false)}
          disabled={loading}
          className="load-button"
        >
          {loading ? 'Loading...' : 'Load Nostr Users'}
        </button>

        <div className="control-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#cccccc', fontSize: '0.9rem' }}>
            <input
              type="checkbox"
              checked={autoUpdateEnabled}
              onChange={(e) => {
                setAutoUpdateEnabled(e.target.checked);
                if (e.target.checked && users.length > 0) {
                  startAutoUpdate();
                } else {
                  stopAutoUpdate();
                }
              }}
              style={{
                width: '16px',
                height: '16px',
                accentColor: '#9b59b6',
                backgroundColor: '#333',
                border: '2px solid #666',
                borderRadius: '3px'
              }}
            />
            Auto-update (2 min)
          </label>
          {lastUpdate && (
            <p style={{ fontSize: '0.7rem', color: '#aaaaaa', marginTop: '0.5rem' }}>
              Last update: {Math.floor((Date.now() - lastUpdate.getTime()) / 60000)} minutes ago
            </p>
          )}
          {isUpdating && (
            <p style={{ fontSize: '0.7rem', color: '#9b59b6', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span className="loading-spinner" style={{ width: '12px', height: '12px', border: '2px solid #9b59b6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
              Updating...
            </p>
          )}
        </div>

        <div className="legend">
          <div className="legend-item">
            <div className="legend-color" style={{ backgroundColor: '#9b59b6' }}></div>
            <span>Profile Updates</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ backgroundColor: '#e67e22' }}></div>
            <span>Posts</span>
          </div>
          <div className="legend-item">
            <div className="legend-color" style={{ backgroundColor: '#f1c40f' }}></div>
            <span>Zaps</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="error">
          {error}
          <button onClick={() => fetchUsers(false)}>Try Again</button>
        </div>
      )}

      {loading && (
        <div className="loading-overlay">
          <div className="loading-content">
            <h3>Loading Nostr Users...</h3>
            <p>Fetching active users (profiles, posts, zaps) from Nostr relays</p>
            <p>You can zoom and pan the map while loading, but it may be slow</p>
          </div>
        </div>
      )}

      {!loading && !error && mapCenter && (
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          style={{ height: '100vh', width: '100%' }}
          zoomDelta={0.5}
          zoomSnap={0.5}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            maxZoom={18}
            subdomains="abcd"
            tileSize={256}
            zoomOffset={0}
            updateWhenZooming={false}
            keepBuffer={2}
            maxNativeZoom={18}
          />
          
          {users.map((user) => {
            if (!user.location?.latitude || !user.location?.longitude) return null;
            
            return (
              <Marker
                key={user.pubkey}
                position={[user.location.latitude, user.location.longitude]}
                icon={createUserIcon(user.activityType)}
              >
                <Popup>
                  <div className="user-popup">
                    <h3>
                      <a 
                        href={`https://nostr.com/${hexToNpub(user.pubkey)}`} 
          target="_blank"
          rel="noopener noreferrer"
                        style={{ color: '#9b59b6', textDecoration: 'none' }}
                      >
                        {user.display_name || user.name || 'Unknown User'}
                      </a>
                    </h3>
                    {user.about && (
                      <p style={{ fontSize: '0.8rem', color: '#cccccc', margin: '0.5rem 0' }}>
                        {user.about.length > 100 ? `${user.about.substring(0, 100)}...` : user.about}
                      </p>
                    )}
                    <div className="location" style={{ fontSize: '0.7rem', color: '#aaaaaa', marginTop: '0.5rem' }}>
                      Location Accuracy: {user.location.confidence ? (user.location.confidence * 100).toFixed(0) + '%' : 'Unknown'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#aaaaaa', marginTop: '0.5rem' }}>
                      Activity: {user.activityType}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      )}

      <div style={{
        position: 'absolute',
        bottom: '10px',
        left: '10px',
        right: '10px',
        textAlign: 'center',
        zIndex: 1000,
        pointerEvents: 'none'
      }}>
        <div style={{
          color: '#666',
          fontSize: '0.7rem',
          marginBottom: '4px'
        }}>
          Built by Bitcoiners with 💜
        </div>
        <div style={{
          color: '#444',
          fontSize: '0.6rem'
        }}>
          Leaflet | © OpenStreetMap contributors © CARTO
        </div>
      </div>
    </div>
  );
};

export default App;