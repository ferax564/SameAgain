import { ArrowRight, Globe2, Heart, ListChecks, Plus, Repeat2 } from 'lucide-react';
import { useApp } from '../state/context';

/** Shown when no household is open: sign in, create or join a household, or try the demo. */
export function Onboarding() {
  const { s, openForm } = useApp();
  return (
    <div className="onboarding">
      <div className="welcome-mark">
        <Repeat2 size={40} />
      </div>
      <span className="eyebrow">A LITTLE LESS TO REMEMBER</span>
      <h1>
        Your favourites.
        <br />
        Everyone on the same list.
      </h1>
      <p className="muted">
        From the weekly shop to somewhere new.
        <br />
        Keep the things you love close.
      </p>
      <div className="row wrap">
        {s.realUser ? (
          <>
            <button
              className="btn primary"
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
              <Plus size={18} /> Create a household
            </button>
            <button className="btn" onClick={() => openForm('join', { token: '' })}>
              Join a household
            </button>
          </>
        ) : (
          <a href="/signin-with-chatgpt?return_to=%2F" target="_top" className="btn primary">
            Sign in with ChatGPT <ArrowRight size={18} />
          </a>
        )}
        <button className="btn" onClick={s.enterDemo}>
          Explore the demo
        </button>
      </div>
      {/* Local illustrations only: the signed-out page makes no third-party requests. */}
      <ul className="welcome-products" aria-label="What Same Again does">
        {[
          { icon: ListChecks, label: 'One shared list' },
          { icon: Heart, label: 'Favourites remembered' },
          { icon: Globe2, label: 'Alternatives abroad' },
        ].map(({ icon: Icon, label }) => (
          <li key={label}>
            <span className="product-photo large welcome-feature" aria-hidden="true">
              <Icon size={34} strokeWidth={1.5} />
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      <p className="fine">Personal households are private. Only invited members can access them.</p>
    </div>
  );
}
