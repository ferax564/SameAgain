import { History, Moon, Plus, Repeat2, Sun, Users } from 'lucide-react';
import { Brand } from '../ui';
import { useApp } from '../state/context';
import { navigation } from '../state/helpers';

/** The desktop side navigation: household, views, lists and profile. */
export function Sidebar() {
  const {
    s,
    household,
    view,
    nav,
    lists,
    active,
    setSelected,
    openForm,
    setModal,
    dark,
    changeTheme,
  } = useApp();
  return (
    <aside className="app-side flex h-full flex-col" aria-label="Household navigation">
      <div className="app-side-content flex min-h-0 flex-1 flex-col overflow-auto">
        <Brand />
        <div className="household-picker">
          <span className="avatar">
            <Users size={20} />
          </span>
          <div>
            <small className="muted">YOUR HOUSEHOLD</small>
            <strong>{household?.name || 'Make room for everyone'}</strong>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <button
              key={n.id}
              className={'nav-item ' + (view === n.id ? 'active' : '')}
              onClick={() => nav(n.id)}
            >
              <n.icon size={21} />
              {n.label}
              {n.id === 'lists' && lists.length > 0 && (
                <span className="nav-count">{lists.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-lists">
          <div className="row between">
            <span className="eyebrow">YOUR LISTS</span>
            <button
              className="iconbtn"
              aria-label="Create list"
              onClick={() =>
                openForm(household ? 'list' : 'create', {
                  name: '',
                  currency: household?.settings.currency || 'EUR',
                  country: 'IT',
                  listName: 'Weekly groceries',
                })
              }
            >
              <Plus size={18} />
            </button>
          </div>
          {lists.map((l) => (
            <button
              className={'side-list ' + (l.id === active?.id ? 'selected' : '')}
              key={l.id}
              onClick={() => {
                setSelected(l.id);
                nav('lists');
              }}
            >
              <span className="list-mark" />
              <span>{l.data.name}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setModal('history')}>
            <History size={20} /> Shopping history
          </button>
          <button className="nav-item" onClick={() => setModal('about')}>
            <Repeat2 size={20} /> About Same Again
          </button>
          <div className="profile">
            <span className="avatar">{s.user?.name?.slice(0, 1) || 'S'}</span>
            <span>
              {s.user?.name?.split(' ')[0] || 'Welcome'}
              <small className="muted">
                {s.demo ? 'Demo experience' : 'Your everyday, together'}
              </small>
            </span>
            <button
              className="iconbtn"
              onClick={changeTheme}
              aria-label={dark ? 'Use light theme' : 'Use dark theme'}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
