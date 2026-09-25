import { ChevronRight, CloudCheck, Flag, RefreshCw, UserRound, WifiOff } from 'lucide-react';
import { Brand } from '../ui';
import { useApp } from '../state/context';
import { navigation } from '../state/helpers';

/** The header: breadcrumb, sync status and the household settings shortcut. */
export function Topbar() {
  const { s, household, view, nav } = useApp();
  return (
    <header className="topbar">
      <div className="mobile-brand">
        <Brand />
      </div>
      <div className="breadcrumb">
        <span>{household?.name || 'Your household'}</span>
        <ChevronRight size={14} />
        <strong>{navigation.find((n) => n.id === view)?.label}</strong>
      </div>
      <div className="row">
        {(s.demo || (!s.loading && household)) && (
          <button
            className="sync"
            aria-live="polite"
            onClick={() => s.flush()}
            aria-label={'Sync status: ' + s.sync + '. Retry synchronisation'}
          >
            {s.sync === 'Offline' ? (
              <WifiOff size={16} />
            ) : s.sync === 'Synced' ? (
              <CloudCheck size={16} />
            ) : s.sync === 'Needs review' || s.sync === 'Session expired' ? (
              <Flag size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
            <span>{s.demo ? 'Demo on this device' : s.sync}</span>
          </button>
        )}
        <button
          className="avatar"
          onClick={() => nav('household')}
          aria-label="Open household settings"
        >
          {s.user?.name?.slice(0, 1) || <UserRound size={18} />}
        </button>
      </div>
    </header>
  );
}
