'use client';
import { useRef, useState } from 'react';
import { MapPin, ExternalLink, Loader2, Navigation } from 'lucide-react';
import { inferRetailer } from '@/lib/retailers';
import type { Place, Point } from '@/lib/places';
export default function StoreFinder({
  demo,
  onChoose,
  retailer,
}: {
  demo: boolean;
  retailer?: string;
  onChoose?: (place: Place) => void;
}) {
  const [q, setQ] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [locations, setLocations] = useState<Place[]>([]),
    [stores, setStores] = useState<Place[]>([]),
    [selected, setSelected] = useState(''),
    [retrieved, setRetrieved] = useState<number>(),
    [searched, setSearched] = useState(false);
  const serial = useRef(0);
  async function search(at?: Point, label?: string) {
    const attempt = ++serial.current;
    setError('');
    setBusy(true);
    setStores([]);
    setSearched(false);
    if (!at) {
      setSelected('');
      setLocations([]);
    }
    if (demo) {
      setError(
        'Live place search is available in your own household. You can use the map link below from the demo.',
      );
      setBusy(false);
      return;
    }
    try {
      const params = at
        ? new URLSearchParams({ lat: String(at.lat), lon: String(at.lon) })
        : new URLSearchParams({ q });
      const r = await fetch('/api/places?' + params, { cache: 'no-store' });
      const d = await r.json();
      if (attempt !== serial.current) return;
      if (!r.ok) throw new Error(d.error);
      if (at) {
        setStores(
          retailer
            ? d.places.filter((p: Place) => inferRetailer(p.name, p.countryCode || '') === retailer)
            : d.places,
        );
        setSelected(label || 'Your approximate location');
        setLocations([]);
        setRetrieved(d.retrieved);
        setSearched(true);
      } else {
        setLocations(d.places);
        if (!d.places.length)
          setError('No location found. Try adding the country or a nearby city.');
      }
    } catch (e: any) {
      if (attempt === serial.current) setError(e.message);
    } finally {
      if (attempt === serial.current) setBusy(false);
    }
  }
  function locate() {
    if (demo) {
      void search();
      return;
    }
    if (!navigator.geolocation) {
      setError('Location is unavailable. Enter a city or postcode.');
      return;
    }
    setBusy(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (p) =>
        void search({
          lat: Number(p.coords.latitude.toFixed(3)),
          lon: Number(p.coords.longitude.toFixed(3)),
        }),
      () => {
        setBusy(false);
        setError(
          'Location could not be read. Allow access in browser settings or enter a city or postcode.',
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  return (
    <section className="store-finder card stack">
      <MapPin size={34} />
      <h2>A familiar shop, somewhere new.</h2>
      <p className="muted">
        Find supermarkets and convenience stores within about 3 km of a location. Map listings do
        not confirm stock, opening hours or product availability.
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label>
          City, neighbourhood or postcode
          <input
            required
            minLength={2}
            maxLength={100}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Lyon, France"
          />
        </label>
        <div className="row wrap">
          <button className="btn primary" disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <MapPin size={18} />} Find a location
          </button>
          <button className="btn" disabled={busy} type="button" onClick={locate}>
            <Navigation size={18} /> Use my location
          </button>
        </div>
      </form>
      <p className="fine">
        Your chosen area is sent to Photon. Device coordinates are rounded to roughly 100 m. No
        location history is saved to your account.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {locations.length > 0 && (
        <div className="stack">
          <h3>Which place did you mean?</h3>
          {locations.map((p) => (
            <button
              className="btn place-choice"
              key={p.id}
              onClick={() => search(p, [p.name, p.country].filter(Boolean).join(', '))}
            >
              <MapPin size={18} />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.address} · {p.country}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      {searched && (
        <div role="status">
          <h3>Places near {selected}</h3>
          <p className="fine">
            {stores.length} mapped results · Retrieved {new Date(retrieved!).toLocaleString()}.
            Approximate straight-line distances.
          </p>
          {stores.length === 0 && (
            <p className="notice">
              No mapped supermarkets found in this area. Coverage may be incomplete; try another
              location or the map link.
            </p>
          )}
        </div>
      )}
      <div className="store-results">
        {stores.map((p) => (
          <article className="store-result" key={p.id}>
            <div className="row between">
              <h3>{p.name}</h3>
              <span className="pill">~{p.distance?.toFixed(1)} km</span>
            </div>
            <p className="muted">
              {p.address || 'Street address not recorded'} · {p.country}
            </p>
            <span className="fine">
              {p.type === 'supermarket' ? 'Supermarket' : 'Convenience store'} · Stock unknown
            </span>
            <div className="row wrap">
              <a
                className="btn"
                href={
                  'https://www.google.com/maps/search/?api=1&query=' +
                  encodeURIComponent(p.name + ' ' + p.address + ' ' + p.country)
                }
                target="_blank"
                rel="noreferrer"
              >
                Directions <ExternalLink size={15} />
              </a>
              <>
                {onChoose && (
                  <button className="btn" onClick={() => onChoose(p)}>
                    Use this branch
                  </button>
                )}
              </>
              <a className="link" href={p.sourceUrl} target="_blank" rel="noreferrer">
                Map source
              </a>
            </div>
          </article>
        ))}
      </div>
      <p className="fine">
        ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
        , ODbL. Search by{' '}
        <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">
          Photon
        </a>
        . Community data may be outdated.
      </p>
      <a
        className="btn"
        href={
          'https://www.google.com/maps/search/' +
          encodeURIComponent('supermarket ' + (selected || q))
        }
        target="_blank"
        rel="noreferrer"
      >
        Open map search <ExternalLink size={16} />
      </a>
    </section>
  );
}
