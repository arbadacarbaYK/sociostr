import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { DivIcon } from 'leaflet';
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
    country?: string;
    city?: string;
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
  const mapRef = useRef<any>(null);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastUpdateTimestamp, setLastUpdateTimestamp] = useState<number | null>(null);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Convert hex pubkey to npub
  const hexToNpub = (hex: string): string => {
    try {
      // Convert hex string to Uint8Array (browser-compatible)
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
      }
      const words = bech32.toWords(bytes);
      return bech32.encode('npub', words);
    } catch (error) {
      console.error('Error converting hex to npub:', error);
      return hex;
    }
  };

  // Create user icon with profile picture and activity type border
  const createUserIcon = (user: User): DivIcon => {
    let borderColor = '#9b59b6'; // purple for profile
    if (user.activityType === 'post') borderColor = '#e67e22'; // orange for posts
    if (user.activityType === 'zap') borderColor = '#f1c40f'; // yellow for zaps

    const profilePic = user.picture || '';
    const hasProfilePic = profilePic && profilePic.length > 0 && 
                         !profilePic.includes('void.cat') && // Skip problematic domains
                         !profilePic.includes('static.wikia.nocookie.net') &&
                         !profilePic.includes('www.redditstatic.com') &&
                         !profilePic.includes('www.rt.com') &&
                         !profilePic.includes('russian.rt.com') &&
                         !profilePic.includes('de.rt.com');

    if (hasProfilePic) {
      // Use DivIcon with HTML for better profile picture rendering
      const iconHtml = `
        <div style="
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 3px solid ${borderColor};
          overflow: hidden;
          background-image: url('${profilePic}');
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
          image-rendering: pixelated;
        "></div>
      `;
      
      return new DivIcon({
        html: iconHtml,
        className: 'custom-div-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -20]
      });
    } else {
      // Fallback to colored circle with initial
      const initial = (user.display_name || user.name || 'U').charAt(0).toUpperCase();
      const iconHtml = `
        <div style="
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background-color: ${borderColor};
          border: 2px solid #000;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 16px;
          font-family: Arial, sans-serif;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">${initial}</div>
      `;
      
      return new DivIcon({
        html: iconHtml,
        className: 'custom-div-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -20]
      });
    }
  };

  // Update stats
  const updateStats = (userList: User[]) => {
    console.log('updateStats called with users:', userList.length);
    console.log('Sample user locations:', userList.slice(0, 3).map(u => ({ pubkey: u.pubkey?.slice(0, 8), location: u.location })));
    
    // Filter users to only include those with actual location data
    const usersWithLocation = userList.filter(user => {
      const hasLocation = user.location && 
        user.location.latitude !== null && 
        user.location.longitude !== null &&
        user.location.latitude !== 0 && 
        user.location.longitude !== 0;
      return hasLocation;
    });
    
    console.log('Filtered users with location:', usersWithLocation.length);
    console.log('FORCE DEPLOY FRONTEND v2 - Debug filtering');
    
    // Count unique countries from the actual country field
    const uniqueCountries = new Set(
      usersWithLocation
        .map(user => user.location.country)
        .filter(country => country && country !== 'Unknown' && country !== '')
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
      // Get user location when manually loading users
      getUserLocation();
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

  // Get user location only when user clicks load button
  const getUserLocation = () => {
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
  };

  // Initialize with world view
  useEffect(() => {
    setMapCenter([0, 0]);
    setMapZoom(2);
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
              Last update: {lastUpdate.toLocaleTimeString()}
            </p>
          )}
          {isUpdating && (
            <p style={{ fontSize: '0.7rem', color: '#9b59b6', display: 'flex', alignItems: 'center', gap: '5px', marginTop: '0.5rem' }}>
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
        <div className="loading-floating">
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
          zoomControl={false}
          ref={mapRef}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            maxZoom={18}
            subdomains={['a', 'b', 'c', 'd']}
            tileSize={256}
            zoomOffset={0}
            updateWhenZooming={true}
            keepBuffer={2}
            maxNativeZoom={18}
            noWrap={false}
          />
          
          {users.map((user) => {
            // Only show users with valid location data
            if (!user.location || 
                user.location.latitude === null || 
                user.location.longitude === null ||
                user.location.latitude === 0 || 
                user.location.longitude === 0) return null;
            
            return (
              <Marker
                key={user.pubkey}
                position={[user.location.latitude, user.location.longitude]}
                icon={createUserIcon(user)}
              >
                <Popup>
                  <div className="user-popup">
                    {user.picture && 
                     !user.picture.includes('void.cat') && 
                     !user.picture.includes('static.wikia.nocookie.net') &&
                     !user.picture.includes('www.redditstatic.com') &&
                     !user.picture.includes('www.rt.com') &&
                     !user.picture.includes('russian.rt.com') &&
                     !user.picture.includes('de.rt.com') && (
                      <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                        <img 
                          src={user.picture} 
                          alt="Profile" 
                          style={{ 
                            width: '60px', 
                            height: '60px', 
                            borderRadius: '50%', 
                            border: `3px solid ${user.activityType === 'post' ? '#e67e22' : user.activityType === 'zap' ? '#f1c40f' : '#9b59b6'}`,
                            objectFit: 'cover'
                          }} 
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      </div>
                    )}
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

      <div className="zoom-controls-bottom">
        <button onClick={() => {
          if (mapRef.current) {
            const currentZoom = mapRef.current.getZoom();
            if (currentZoom < 18) {
              mapRef.current.setZoom(currentZoom + 1);
            }
          }
        }}>+</button>
        <button onClick={() => {
          if (mapRef.current) {
            const currentZoom = mapRef.current.getZoom();
            if (currentZoom > 1) {
              mapRef.current.setZoom(currentZoom - 1);
            }
          }
        }}>-</button>
      </div>

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