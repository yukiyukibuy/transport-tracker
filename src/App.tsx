import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bus, RefreshCw, AlertCircle, Clock, MapPin, Plus, Trash2, X, Search, GripVertical } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

type RouteStopConfig = {
  id: string;
  stop_id: string;
  service_type: string;
  stop_name: string;
  seq: number;
};

type RouteGroup = {
  id: string;
  route: string;
  direction: string;
  stops: RouteStopConfig[];
};

// 預先定義的路線 (清空，讓使用者自行新增)
const PREDEFINED_ROUTES: RouteGroup[] = [];

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 8000) => {
  const controller = new AbortController();
  let isTimeout = false;
  
  const abortHandler = () => {
    controller.abort();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    options.signal.addEventListener('abort', abortHandler);
  }

  const timeoutId = setTimeout(() => {
    isTimeout = true;
    controller.abort();
  }, timeout);

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (options.signal) {
      options.signal.removeEventListener('abort', abortHandler);
    }
  };

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    
    const originalJson = response.json.bind(response);
    response.json = async () => {
      try {
        return await originalJson();
      } catch (err: any) {
        if (isTimeout) throw new Error('Timeout');
        throw err;
      } finally {
        cleanup();
      }
    };
    
    const originalText = response.text.bind(response);
    response.text = async () => {
      try {
        return await originalText();
      } catch (err: any) {
        if (isTimeout) throw new Error('Timeout');
        throw err;
      } finally {
        cleanup();
      }
    };

    return response;
  } catch (err: any) {
    cleanup();
    if (isTimeout) {
      throw new Error('Timeout');
    }
    throw err;
  }
};

let cachedStopsMap: Record<string, string> | null = null;
let fetchStopsPromise: Promise<Record<string, string>> | null = null;

const getGlobalStopsMap = async (): Promise<Record<string, string>> => {
  if (cachedStopsMap) return cachedStopsMap;
  if (fetchStopsPromise) return fetchStopsPromise;

  fetchStopsPromise = fetchWithTimeout('https://data.etabus.gov.hk/v1/transport/kmb/stop', {}, 15000)
    .then(res => {
      if (!res.ok) throw new Error('Network response was not ok');
      return res.json();
    })
    .then(json => {
      const map: Record<string, string> = {};
      if (json && json.data) {
        json.data.forEach((s: any) => {
          map[s.stop] = s.name_tc;
        });
      }
      cachedStopsMap = map;
      return map;
    })
    .catch(err => {
      fetchStopsPromise = null;
      console.error('Failed to load stops map', err);
      throw err;
    });

  return fetchStopsPromise;
};

type EtaData = {
  eta: string | null;
  rmk_tc: string;
};

const StopEtaRow: React.FC<{ route: string; stop: RouteStopConfig; lastRefresh: number; onDelete: () => void }> = ({ route, stop, lastRefresh, onDelete }) => {
  const [etas, setEtas] = useState<EtaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        controller.abort();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const fetchEta = async () => {
      if (document.visibilityState === 'hidden') return;
      
      setLoading(true);
      setError(null);
      try {
        const res = await fetchWithTimeout(`https://data.etabus.gov.hk/v1/transport/kmb/eta/${stop.stop_id}/${route}/${stop.service_type}`, {
          signal: controller.signal
        });
        if (!res.ok) throw new Error('Network response was not ok');
        const json = await res.json();
        
        if (!isActive) return;

        if (json && json.data) {
          const validEtas = json.data
            .filter((item: any) => item.eta !== null)
            .sort((a: any, b: any) => new Date(a.eta).getTime() - new Date(b.eta).getTime())
            .slice(0, 3)
            .map((item: any) => ({
              eta: item.eta,
              rmk_tc: item.rmk_tc || ''
            }));
          setEtas(validEtas);
        } else {
          setEtas([]);
        }
      } catch (err: any) {
        if (!isActive) return;
        if (err.name === 'AbortError' || err.message === 'Timeout') return;
        setError('無法載入');
        console.error(err);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    fetchEta();

    return () => {
      isActive = false;
      controller.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [route, stop, lastRefresh]);

  const getMinutesLeft = (eta: string | null) => {
    if (!eta) return '-';
    const etaDate = new Date(eta);
    const now = new Date();
    const diffMs = etaDate.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins <= 0) return '即將抵達';
    return `${diffMins} 分鐘`;
  };

  const formatTime = (eta: string | null) => {
    if (!eta) return '';
    const date = new Date(eta);
    return date.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  return (
    <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
      <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-200">
        <a 
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.stop_name + ' 巴士站')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-slate-700 text-sm flex items-center gap-2 hover:text-red-600 transition-colors"
          title="在 Google Maps 中開啟"
        >
          <div className="w-2 h-2 rounded-full bg-red-500"></div>
          {stop.stop_name}
        </a>
        <div className="flex items-center gap-2">
          {loading && <RefreshCw size={14} className="animate-spin text-slate-400" />}
          <button onClick={onDelete} className="text-slate-300 hover:text-red-500 transition-colors" title="刪除此車站">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="text-red-500 text-xs flex items-center gap-1 py-1">
          <AlertCircle size={12} /> {error}
        </div>
      ) : etas.length === 0 && !loading ? (
        <div className="text-slate-400 text-xs py-1">沒有資料</div>
      ) : (
        <div className="space-y-1.5 mt-2">
          {etas.map((eta, index) => (
            <div key={index} className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className={`font-mono text-sm ${index === 0 ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                  {formatTime(eta.eta)}
                </span>
                {eta.rmk_tc && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-white rounded text-slate-500 border border-slate-200">
                    {eta.rmk_tc}
                  </span>
                )}
              </div>
              <span className={`text-sm ${index === 0 ? 'text-red-600 font-bold' : 'text-slate-600 font-medium'}`}>
                {getMinutesLeft(eta.eta)}
              </span>
            </div>
          ))}
          {loading && etas.length === 0 && (
            <div className="h-4 bg-slate-200 animate-pulse rounded w-1/2"></div>
          )}
        </div>
      )}
    </div>
  );
};

const BusRouteCard: React.FC<{ 
  group: RouteGroup; 
  lastRefresh: number; 
  onDeleteStop: (groupId: string, stopId: string) => void; 
  onDeleteGroup: (groupId: string) => void;
  onAddStopClick: (group: RouteGroup) => void;
  dragHandleProps?: any 
}> = ({ group, lastRefresh, onDeleteStop, onDeleteGroup, onAddStopClick, dragHandleProps }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-4 overflow-hidden relative">
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div 
            {...dragHandleProps} 
            className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing p-1 -ml-2"
          >
            <GripVertical size={20} />
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-red-600 text-white font-bold text-xl px-3 py-1 rounded-lg shadow-sm">
              {group.route}
            </div>
            <button 
              onClick={() => onAddStopClick(group)}
              className="text-red-600 hover:text-white hover:bg-red-600 bg-red-50 p-1.5 rounded-lg transition-colors"
              title="新增此路線車站"
            >
              <Plus size={18} />
            </button>
          </div>
          <div>
            <h3 className="font-medium text-slate-800 flex items-center gap-1.5 text-sm">
              <MapPin size={14} className="text-slate-400" />
              {group.direction}
            </h3>
          </div>
        </div>
        <button onClick={() => setShowDeleteConfirm(true)} className="text-slate-300 hover:text-red-500 transition-colors p-1" title="刪除整條路線">
          <Trash2 size={18} />
        </button>
      </div>

      <div className="space-y-3">
        {group.stops.map(stop => (
          <StopEtaRow 
            key={stop.id} 
            route={group.route} 
            stop={stop} 
            lastRefresh={lastRefresh} 
            onDelete={() => onDeleteStop(group.id, stop.id)} 
          />
        ))}
      </div>

      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-10 flex flex-col items-center justify-center p-4 text-center">
          <p className="font-medium text-slate-800 mb-4">確定要刪除整條路線嗎？</p>
          <div className="flex gap-3">
            <button 
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 font-medium hover:bg-slate-200 transition-colors"
            >
              取消
            </button>
            <button 
              onClick={() => {
                setShowDeleteConfirm(false);
                onDeleteGroup(group.id);
              }}
              className="px-4 py-2 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
            >
              確定刪除
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const AddStopToGroupModal = ({ group, onAdd, onCancel }: { group: RouteGroup, onAdd: (stop: RouteStopConfig) => void, onCancel: () => void }) => {
  const [stops, setStops] = useState<any[]>([]);
  const [allStopsMap, setAllStopsMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceType, setServiceType] = useState<string>('1');

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      try {
        const normalize = (s: string) => s.replace(/[（）()]/g, '').trim();
        const destTc = normalize(group.direction.replace('往 ', ''));
        const routeRes = await fetchWithTimeout('https://data.etabus.gov.hk/v1/transport/kmb/route/', { signal: controller.signal });
        const routeJson = await routeRes.json();
        
        if (!isActive) return;

        if (!routeJson || !routeJson.data) throw new Error('找不到路線資料');
        
        const boundInfo = routeJson.data.find((r: any) => r.route === group.route && normalize(r.dest_tc) === destTc);
        
        if (!boundInfo) throw new Error('找不到路線資料');
        
        setServiceType(boundInfo.service_type);

        const direction = boundInfo.bound === 'I' ? 'inbound' : 'outbound';
        const stopsRes = await fetchWithTimeout(`https://data.etabus.gov.hk/v1/transport/kmb/route-stop/${group.route}/${direction}/${boundInfo.service_type}`, { signal: controller.signal });
        const stopsJson = await stopsRes.json();
        
        if (!isActive) return;

        try {
          const stopMap = await getGlobalStopsMap();
          if (isActive) setAllStopsMap(stopMap);
        } catch (e) {
          console.error('Failed to get global stops map', e);
        }
        
        if (stopsJson && stopsJson.data) {
          const sortedStops = stopsJson.data.sort((a: any, b: any) => a.seq - b.seq);
          setStops(sortedStops);
        } else {
          setStops([]);
          throw new Error('找不到車站資料');
        }
      } catch (err: any) {
        if (!isActive) return;
        if (err.name === 'AbortError') return;
        setError('載入車站失敗');
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };
    fetchData();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [group]);

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            <Bus className="text-red-600" />
            新增 {group.route} 車站
          </h2>
          <button onClick={onCancel} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <RefreshCw className="animate-spin mb-2" size={24} />
              <p>載入車站中...</p>
            </div>
          ) : error ? (
            <div className="text-center py-10 text-red-500">
              <AlertCircle className="mx-auto mb-2" size={24} />
              <p>{error}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-500 mb-3">{group.direction} - 請選擇車站：</p>
              {stops.map((stop, index) => {
                const stopName = allStopsMap[stop.stop] || '未知車站';
                const isAlreadyAdded = group.stops.some(s => s.stop_id === stop.stop);
                
                return (
                  <button
                    key={stop.stop}
                    disabled={isAlreadyAdded}
                    onClick={() => {
                      onAdd({
                        id: Date.now().toString(),
                        stop_id: stop.stop,
                        service_type: serviceType,
                        stop_name: stopName,
                        seq: index + 1
                      });
                    }}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center gap-3 ${
                      isAlreadyAdded 
                        ? 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed' 
                        : 'border-slate-200 hover:border-red-300 hover:bg-red-50'
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      isAlreadyAdded ? 'bg-slate-200 text-slate-500' : 'bg-red-100 text-red-600'
                    }`}>
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <div className={`font-medium ${isAlreadyAdded ? 'text-slate-500' : 'text-slate-800'}`}>
                        {stopName}
                      </div>
                    </div>
                    {isAlreadyAdded && (
                      <span className="text-xs text-slate-400 font-medium px-2 py-1 bg-slate-200 rounded-md">已加入</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const AddRouteForm = ({ onAdd, onCancel }: { onAdd: (route: { route: string, stop_id: string, service_type: string, direction: string, stop_name: string, seq: number }) => void, onCancel: () => void }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [routeInput, setRouteInput] = useState('');
  const [bounds, setBounds] = useState<any[]>([]);
  const [selectedBoundIdx, setSelectedBoundIdx] = useState<number>(0);
  const [stops, setStops] = useState<any[]>([]);
  const [selectedStop, setSelectedStop] = useState<string>('');
  const [allStopsMap, setAllStopsMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getGlobalStopsMap()
      .then(map => setAllStopsMap(map))
      .catch(err => console.error('Failed to load stops map', err));
      
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleSearchRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    const searchRoute = routeInput.trim().toUpperCase();
    if (!searchRoute) return;
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    setLoading(true);
    setError('');
    try {
      const res = await fetchWithTimeout(`https://data.etabus.gov.hk/v1/transport/kmb/route/`, { signal: controller.signal });
      const json = await res.json();
      
      if (json && json.data) {
        const matchedRoutes = json.data.filter((r: any) => r.route === searchRoute);
        if (matchedRoutes.length > 0) {
          setBounds(matchedRoutes);
          setStep(2);
          setSelectedBoundIdx(0);
          await fetchStops(matchedRoutes[0], controller);
        } else {
          setError('找不到此路線');
        }
      } else {
        setError('找不到此路線');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError('搜尋失敗，請稍後再試');
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  };

  const fetchStops = async (boundInfo: any, existingController?: AbortController) => {
    setLoading(true);
    
    let controller = existingController;
    if (!controller) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      controller = new AbortController();
      abortControllerRef.current = controller;
    }

    try {
      const direction = boundInfo.bound === 'I' ? 'inbound' : 'outbound';
      const res = await fetchWithTimeout(`https://data.etabus.gov.hk/v1/transport/kmb/route-stop/${boundInfo.route}/${direction}/${boundInfo.service_type}`, { signal: controller.signal });
      const json = await res.json();
      
      if (json && json.data) {
        const sortedStops = json.data.sort((a: any, b: any) => a.seq - b.seq);
        setStops(sortedStops);
        if (sortedStops.length > 0) {
          setSelectedStop(sortedStops[0].stop);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError('載入車站失敗');
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  };

  const handleBoundChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value, 10);
    setSelectedBoundIdx(idx);
    fetchStops(bounds[idx]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const boundInfo = bounds[selectedBoundIdx];
    if (!boundInfo || !selectedStop) return;
    
    const stopName = allStopsMap[selectedStop] || '未知車站';
    
    // Find the sequence number for the selected stop
    const stopSeq = stops.findIndex(s => s.stop === selectedStop) + 1;
    
    onAdd({
      route: boundInfo.route,
      stop_id: selectedStop,
      service_type: boundInfo.service_type,
      direction: `往 ${boundInfo.dest_tc}`,
      stop_name: stopName,
      seq: stopSeq
    });
  };

  return (
    <div className="mt-6 bg-white p-4 rounded-2xl shadow-sm border border-slate-100 relative">
      <button 
        onClick={onCancel}
        className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
      >
        <X size={20} />
      </button>
      <h3 className="font-bold text-slate-800 mb-4">新增路線</h3>
      
      {error && (
        <div className="mb-4 p-2 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {step === 1 ? (
        <form onSubmit={handleSearchRoute} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">搜尋路線號碼</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                required
                placeholder="例如: 1A, 98D"
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 uppercase"
                value={routeInput}
                onChange={e => setRouteInput(e.target.value)}
              />
              <button 
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg font-medium text-sm hover:bg-slate-900 transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                搜尋
              </button>
            </div>
          </div>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">選擇方向</label>
            <select 
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 bg-white"
              value={selectedBoundIdx}
              onChange={handleBoundChange}
              disabled={loading}
            >
              {bounds.map((b, idx) => (
                <option key={idx} value={idx}>
                  往 {b.dest_tc} (由 {b.orig_tc} 開出)
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">選擇車站</label>
            <select 
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 bg-white"
              value={selectedStop}
              onChange={e => setSelectedStop(e.target.value)}
              disabled={loading}
            >
              {stops.map((s) => (
                <option key={s.stop} value={s.stop}>
                  {s.seq}. {allStopsMap[s.stop] || s.stop}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-2">
            <button 
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-medium text-sm hover:bg-slate-200 transition-colors"
            >
              上一步
            </button>
            <button 
              type="submit"
              disabled={loading || !selectedStop}
              className="flex-1 py-2.5 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              儲存路線
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default function App() {
  const [routes, setRoutes] = useState<RouteGroup[]>(() => {
    const saved = localStorage.getItem('kmb_routes');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length === 0) return [];
        
        // Migration from old flat format to grouped format
        if (!parsed[0].stops) {
          const groups: RouteGroup[] = [];
          const groupMap = new Map<string, RouteGroup>();

          parsed.forEach((r: any) => {
            const direction = r.label.split(' (')[0];
            const stopNameMatch = r.label.match(/\((.*?)\)/);
            const stopName = stopNameMatch ? stopNameMatch[1] : (r.label || '未知車站');
            
            const groupKey = `${r.route}-${direction}`;
            if (groupMap.has(groupKey)) {
              groupMap.get(groupKey)!.stops.push({
                id: r.id,
                stop_id: r.stop_id,
                service_type: r.service_type,
                stop_name: stopName,
                seq: 999 // Default seq for old data
              });
            } else {
              const newGroup: RouteGroup = {
                id: r.id,
                route: r.route,
                direction: direction,
                stops: [{
                  id: r.id,
                  stop_id: r.stop_id,
                  service_type: r.service_type,
                  stop_name: stopName,
                  seq: 999 // Default seq for old data
                }]
              };
              groups.push(newGroup);
              groupMap.set(groupKey, newGroup);
            }
          });
          return groups;
        }
        
        // Fix missing closing parenthesis and remove dummy stops
        const cleaned = parsed.map((g: RouteGroup) => {
          g.stops = g.stops.map(s => {
            if (s.stop_name.includes('(') && !s.stop_name.includes(')')) {
              return { ...s, stop_name: s.stop_name + ')' };
            }
            return s;
          });
          g.stops = g.stops.filter(s => s.stop_id !== '1900F4E26A96C510');
          return g;
        }).filter((g: RouteGroup) => g.stops.length > 0);
        
        return cleaned;
      } catch (e) {
        console.error('Failed to parse saved routes', e);
      }
    }
    return PREDEFINED_ROUTES;
  });

  const [isAdding, setIsAdding] = useState(false);
  const [addingStopToGroup, setAddingStopToGroup] = useState<RouteGroup | null>(null);

  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    localStorage.setItem('kmb_routes', JSON.stringify(routes));
  }, [routes]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setLastRefresh(Date.now());
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setLastRefresh(Date.now());
        setCountdown(60);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleManualRefresh = () => {
    setLastRefresh(Date.now());
    setCountdown(60);
  };

  const handleAddRoute = (newRoute: { route: string, stop_id: string, service_type: string, direction: string, stop_name: string, seq: number }) => {
    const newStop: RouteStopConfig = {
      id: Date.now().toString(),
      stop_id: newRoute.stop_id,
      service_type: newRoute.service_type,
      stop_name: newRoute.stop_name,
      seq: newRoute.seq
    };

    setRoutes(prevRoutes => {
      const newRoutes = [...prevRoutes];
      const existingGroupIndex = newRoutes.findIndex(g => g.route === newRoute.route && g.direction === newRoute.direction);
      
      if (existingGroupIndex >= 0) {
        // Add to existing group
        const updatedGroup = { ...newRoutes[existingGroupIndex] };
        // Check if stop already exists in this group
        if (!updatedGroup.stops.find(s => s.stop_id === newStop.stop_id)) {
          updatedGroup.stops = [...updatedGroup.stops, newStop];
          // Sort stops by sequence
          updatedGroup.stops.sort((a, b) => (a.seq || 999) - (b.seq || 999));
          newRoutes[existingGroupIndex] = updatedGroup;
        }
      } else {
        // Create new group
        newRoutes.push({
          id: Date.now().toString() + '_g',
          route: newRoute.route,
          direction: newRoute.direction,
          stops: [newStop]
        });
      }
      return newRoutes;
    });
    
    setIsAdding(false);
  };

  const handleDeleteStop = (groupId: string, stopId: string) => {
    setRoutes(prevRoutes => {
      return prevRoutes.map(group => {
        if (group.id === groupId) {
          return {
            ...group,
            stops: group.stops.filter(s => s.id !== stopId)
          };
        }
        return group;
      }).filter(group => group.stops.length > 0); // Remove empty groups
    });
  };

  const handleDeleteGroup = (groupId: string) => {
    setRoutes(prev => prev.filter(g => g.id !== groupId));
  };

  const handleAddStopToGroup = (newStop: RouteStopConfig) => {
    if (!addingStopToGroup) return;
    
    setRoutes(prevRoutes => {
      const newRoutes = [...prevRoutes];
      const groupIndex = newRoutes.findIndex(g => g.id === addingStopToGroup.id);
      
      if (groupIndex >= 0) {
        const updatedGroup = { ...newRoutes[groupIndex] };
        if (!updatedGroup.stops.find(s => s.stop_id === newStop.stop_id)) {
          updatedGroup.stops = [...updatedGroup.stops, newStop];
          updatedGroup.stops.sort((a, b) => (a.seq || 999) - (b.seq || 999));
          newRoutes[groupIndex] = updatedGroup;
        }
      }
      return newRoutes;
    });
    
    setAddingStopToGroup(null);
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const items = Array.from(routes);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setRoutes(items);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-10">
      {/* Header */}
      <header className="bg-red-600 text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-md mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Bus size={24} />
            <h1 className="font-bold text-lg tracking-wide">KMB ETA Tracker</h1>
          </div>
          <button 
            onClick={handleManualRefresh}
            className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 transition-colors px-3 py-1.5 rounded-full text-sm font-medium"
          >
            <RefreshCw size={14} className={countdown === 60 ? 'animate-spin' : ''} />
            <span>{countdown}s</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto p-4 mt-2">
        <div className="mb-4 flex items-center justify-between text-sm text-slate-500 px-1">
          <span>我的常用路線</span>
          <span className="flex items-center gap-1">
            <Clock size={14} />
            最後更新: {new Date(lastRefresh).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </span>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="routes-list">
            {(provided) => (
              <div 
                className="space-y-4"
                {...provided.droppableProps}
                ref={provided.innerRef}
              >
                {routes.map((route, index) => {
                  const DraggableComponent = Draggable as any;
                  return (
                  <DraggableComponent key={route.id} draggableId={route.id} index={index}>
                    {(provided: any, snapshot: any) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        style={{
                          ...provided.draggableProps.style,
                          opacity: snapshot.isDragging ? 0.9 : 1,
                        }}
                      >
                        <BusRouteCard 
                          group={route} 
                          lastRefresh={lastRefresh} 
                          onDeleteStop={handleDeleteStop} 
                          onDeleteGroup={handleDeleteGroup}
                          onAddStopClick={setAddingStopToGroup}
                          dragHandleProps={provided.dragHandleProps}
                        />
                      </div>
                    )}
                  </DraggableComponent>
                )})}
                {provided.placeholder}
                
                {routes.length === 0 && (
                  <div className="text-center py-10 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
                    沒有已儲存的路線，請新增路線
                  </div>
                )}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {/* Add Route Button */}
        {!isAdding && !addingStopToGroup && (
          <button 
            onClick={() => setIsAdding(true)}
            className="mt-6 w-full py-3 bg-white border border-dashed border-slate-300 rounded-xl text-slate-500 font-medium flex items-center justify-center gap-2 hover:bg-slate-50 hover:text-slate-700 transition-colors"
          >
            <Plus size={18} />
            新增路線
          </button>
        )}

        {/* Add Route Form */}
        {isAdding && (
          <AddRouteForm onAdd={handleAddRoute} onCancel={() => setIsAdding(false)} />
        )}

        {/* Add Stop To Group Modal */}
        {addingStopToGroup && (
          <AddStopToGroupModal 
            group={addingStopToGroup} 
            onAdd={handleAddStopToGroup} 
            onCancel={() => setAddingStopToGroup(null)} 
          />
        )}
      </main>
    </div>
  );
}
