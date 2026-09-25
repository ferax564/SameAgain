import { ArrowRight } from 'lucide-react';
import { useApp } from '../state/context';

/** Banners above the current view: demo mode, expired session, rejected change, sync error. */
export function Notices() {
  const { s, setSelected } = useApp();
  return (
    <>
      {s.demo && (
        <div className="demo-banner">
          <span>
            <strong>Demo household</strong>
            <span className="desktop-only">
              {' '}
              · Sample shopping activity, real catalogue photos.
            </span>
          </span>
          <button
            onClick={() => {
              s.exitDemo();
              setSelected('');
            }}
          >
            Use my household <ArrowRight size={15} />
          </button>
        </div>
      )}
      {s.authExpired && !s.demo && (
        <div className="notice" role="alert">
          <strong>Your session has expired.</strong>
          <p>Changes made on this device are kept and will sync after you sign in again.</p>
          <a className="btn" href="/signin-with-chatgpt?return_to=%2F" target="_top">
            Sign in again
          </a>
        </div>
      )}
      {s.rejected && (
        <div className="notice" role="alert">
          <strong>
            A change needs attention:{' '}
            <span className="rejected-name">{s.rejected.op.data.name || s.rejected.op.kind}</span>
          </strong>
          <p>
            {s.rejected.message.replace(/[.!?]*$/, '.')} Edit this record in the app to correct it,
            or discard this draft and any pending changes that depend on it.
          </p>
          <button className="btn" onClick={() => s.discardRejected()}>
            Discard rejected draft
          </button>
        </div>
      )}
      {s.error && !s.rejected && (
        <div className="notice" role="alert">
          {s.error}
          <button
            className="link"
            onClick={() => {
              s.setError('');
              void s.boot();
              void s.flush();
            }}
          >
            {' '}
            Retry
          </button>
        </div>
      )}
    </>
  );
}
