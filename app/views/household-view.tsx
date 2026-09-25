import { Download, LogOut, MoreHorizontal, Plus, Settings2, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { Household } from '@/lib/sync-core';
import { Choice } from '../ui';
import { useApp } from '../state/context';

/** Members and invitations, personal and household preferences, data and account actions. */
export function HouseholdView({ household }: { household: Household }) {
  const { s, now, hid, act, setConfirm, openForm, setModal, dark, changeTheme } = useApp();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">BETTER, TOGETHER</span>
          <h1>{household.name}</h1>
          <p className="muted">Shared favourites. Individual tastes. Everyone has a place.</p>
        </div>
        <button
          className="btn primary"
          disabled={!['owner', 'admin'].includes(household.role ?? '')}
          onClick={() => openForm('invitePerson', { email: '' })}
        >
          <Plus size={18} /> Invite someone
        </button>
      </div>
      <div className="household-grid">
        <section className="card">
          <h2>The people on your list</h2>
          {s.members.map((m) => (
            <div className="member-row" key={m.user}>
              <span className="avatar">{m.name?.slice(0, 1)}</span>
              <div>
                <strong>
                  {m.name}
                  {m.user === s.user?.id ? ' (you)' : ''}
                </strong>
                <small className="muted">{m.role}</small>
              </div>
              {m.user !== s.user?.id && household.role === 'owner' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="iconbtn" aria-label={'Manage ' + m.name}>
                      <MoreHorizontal size={20} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() =>
                        act('role', {
                          user: m.user,
                          role: m.role === 'admin' ? 'member' : 'admin',
                        })
                      }
                    >
                      {m.role === 'admin' ? 'Make member' : 'Make administrator'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        setConfirm({
                          title: 'Transfer ownership to ' + m.name + '?',
                          description:
                            'You will become an administrator. The new owner will control membership and deletion.',
                          run: () => act('transfer', { user: m.user }),
                        })
                      }
                    >
                      Transfer ownership
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        setConfirm({
                          title: 'Remove ' + m.name + '?',
                          description: 'They will lose access to this household.',
                          run: () => act('remove', { user: m.user }),
                        })
                      }
                    >
                      Remove member
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {household.role === 'admin' && m.role === 'member' && m.user !== s.user?.id && (
                <button
                  className="iconbtn"
                  aria-label={'Remove ' + m.name}
                  onClick={() =>
                    setConfirm({
                      title: 'Remove member?',
                      description: 'They will lose access to this household.',
                      run: () => act('remove', { user: m.user }),
                    })
                  }
                >
                  <X size={18} />
                </button>
              )}
            </div>
          ))}
          <p className="fine">
            An invite is single-use, expires in 7 days and can be revoked. The person joining signs
            in with their own ChatGPT account.
          </p>
          {s.invites
            .filter((i) => !i.used_by && !i.revoked)
            .map((i) => (
              <div className="row between invitation" key={i.id}>
                <span>
                  {i.recipient_email || 'Invitation'} · {i.expires < now ? 'Expired' : 'Pending'} ·{' '}
                  {new Date(i.expires).toLocaleDateString()}
                </span>
                <button
                  className="link"
                  onClick={() => act('revoke', { id: i.id }, 'Invitation revoked')}
                >
                  Revoke
                </button>
              </div>
            ))}
        </section>
        <section className="card stack">
          <h2>Make yourself at home</h2>
          {!s.demo && (
            <label>
              Switch household
              <Choice
                label="Switch household"
                value={hid ?? ''}
                onChange={s.switchHousehold}
                options={Object.fromEntries(s.households.map((h) => [h.id, h.name]))}
              />
            </label>
          )}
          <div className="row between">
            <span>Dark mode</span>
            <Switch checked={dark} onCheckedChange={changeTheme} aria-label="Dark mode" />
          </div>
          <button
            className="btn"
            onClick={() =>
              openForm('settings', {
                name: household.name,
                ...household.settings,
                constraintsText: (household.settings.constraints || [])
                  .map((c) => c.kind + ':' + c.value)
                  .join('\n'),
              })
            }
          >
            <Settings2 size={18} /> Household preferences
          </button>
          <button
            className="btn"
            onClick={() =>
              openForm('profile', {
                name: s.user?.name ?? undefined,
                ...s.user?.preferences,
                constraintsText: (s.user?.preferences?.constraints || [])
                  .map((c) => c.kind + ':' + c.value)
                  .join('\n'),
              })
            }
          >
            <UserRound size={18} /> My preferences
          </button>
          <button
            className="btn"
            onClick={() =>
              openForm('create', {
                name: '',
                country: 'IT',
                currency: 'EUR',
                language: 'en',
                listName: 'Weekly groceries',
              })
            }
          >
            <Plus size={18} /> Create another household
          </button>
          <button className="btn" onClick={() => openForm('join', { token: '' })}>
            Join with an invitation
          </button>
        </section>
        <section className="card">
          <h2>Your data, your choice</h2>
          <p className="muted">
            Export your account and shared household records. If you leave, the household keeps its
            shopping history.
          </p>
          <div className="row wrap">
            <a
              className="btn"
              href={s.demo ? '#' : '/api/export'}
              onClick={(e) => {
                if (s.demo) {
                  e.preventDefault();
                  toast('Exports are available in your own household.');
                }
              }}
            >
              <Download size={17} /> Export my data
            </a>
            <button
              className="btn"
              onClick={() =>
                setConfirm({
                  title: 'Leave this household?',
                  description:
                    household.role === 'owner'
                      ? 'Transfer ownership to another member first. A household must have an owner.'
                      : 'Your access will end. Shared shopping records will remain.',
                  run: () => act('leave', {}, 'You left the household'),
                })
              }
            >
              Leave household
            </button>
            <button
              className="btn danger"
              onClick={() =>
                setConfirm({
                  title: 'Delete your account data?',
                  description:
                    'Transfer ownership first. Shared records stay with the family and your contributions are anonymised. Your profile and memberships are deleted.',
                  run: async () => {
                    const r = await act('deleteAccount');
                    if (r) {
                      for (const k of Object.keys(localStorage))
                        if (k.startsWith('same-again:')) localStorage.removeItem(k);
                      window.location.href = '/signout-with-chatgpt?return_to=%2F';
                    }
                  },
                })
              }
            >
              Delete account data
            </button>
            {household.role === 'owner' && (
              <button
                className="btn danger"
                onClick={() =>
                  setConfirm({
                    title: 'Permanently delete this household?',
                    description:
                      'All its shared lists, favourites and history will be deleted for everyone. Export first if you need a copy.',
                    run: async () => {
                      const r = await act('deleteHousehold');
                      if (r) window.location.reload();
                    },
                  })
                }
              >
                Delete household
              </button>
            )}
          </div>
        </section>
      </div>
      <div className="row wrap section-title">
        <a className="btn" href="/device-check" target="_blank">
          Device check
        </a>
        <button className="btn" onClick={() => setModal('archives')}>
          Archived lists
        </button>
        <button className="btn" onClick={s.enterDemo}>
          Open separate demo
        </button>
        <a
          className="btn"
          href="/signout-with-chatgpt?return_to=%2F"
          target="_top"
          onClick={(e) => {
            // Covers queued changes for every household on this device, not just this one.
            if (s.pending || s.pendingAnywhere) {
              e.preventDefault();
              toast.error(
                'Some changes on this device have not synced yet. Go online and wait for them before signing out.',
              );
              return;
            }
            try {
              for (const k of Object.keys(localStorage))
                if (k.startsWith('same-again:') && k !== 'same-again:theme')
                  localStorage.removeItem(k);
            } catch {
              // Storage unavailable: nothing cached to clear.
            }
          }}
        >
          <LogOut size={17} /> Sign out & clear device cache
        </a>
      </div>
    </>
  );
}
