import { useEffect, useState } from 'react';
import { Leaf, Loader2 } from 'lucide-react';
import type { Product } from '@/lib/domain';
import { healthScore, scoreReviewed, type HealthScore } from '@/lib/health-score';
import { Photo } from './ui';
import './health-panel.css';

const bandLabel: Record<NonNullable<HealthScore['band']>, string> = {
  excellent: 'Excellent',
  good: 'Good',
  mediocre: 'Mediocre',
  poor: 'Poor',
};
const riskLabel = { high: 'High concern', moderate: 'Moderate', limited: 'Limited' } as const;
const novaLabel = {
  1: 'Unprocessed or minimally processed',
  2: 'Processed culinary ingredient',
  3: 'Processed food',
  4: 'Ultra-processed food',
} as const;

/** Compact score badge for result rows and scan results. */
export function ScoreBadge({ product }: { product: Product }) {
  const h = healthScore(product);
  if (h.value === undefined) return null;
  return (
    <span
      className={'score-badge score-' + h.band}
      title={`Health score ${h.value}/100 (${bandLabel[h.band!]})`}
    >
      {h.value}
      <span className="sr-only">/100 health score, {bandLabel[h.band!]}</span>
    </span>
  );
}

type Alternative = { product: Product; score: HealthScore };
const shops = [
  ['', 'Any Swiss shop'],
  ['coop-ch', 'Coop'],
  ['migros-ch', 'Migros'],
  ['denner-ch', 'Denner'],
  ['lidl-ch', 'Lidl'],
  ['aldi-ch', 'Aldi'],
] as const;

/**
 * Health score breakdown: Nutri-Score, additive flags, organic certification and NOVA,
 * with better-scoring alternatives from the saved Swiss catalogue.
 */
export function HealthPanel({
  product,
  demo,
  household,
  onOpen,
}: {
  product: Product;
  demo?: boolean;
  household?: string;
  onOpen?: (p: Product) => void;
}) {
  const h = healthScore(product);
  const [shop, setShop] = useState('');
  const [result, setResult] = useState<{
    key: string;
    alternatives?: Alternative[];
    error?: string;
  }>();
  const code = product.barcode;
  const scored = h.value !== undefined;
  const key = `${code}|${shop}|${demo ? 'demo' : household || ''}`;
  useEffect(() => {
    if (!code || !scored) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ better: code });
    if (shop) params.set('retailer', shop);
    if (shop) params.set('country', 'CH');
    if (household && !demo) params.set('household', household);
    fetch((demo ? '/api/demo-catalogue?' : '/api/catalogue?') + params, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Alternatives are unavailable.');
        setResult({ key, alternatives: d.alternatives || [] });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setResult({ key, error: (e as Error).message });
      });
    return () => controller.abort();
  }, [code, shop, demo, household, scored, key]);
  const current = result?.key === key ? result : undefined;
  const loading = !current;
  const error = current?.error;
  const alternatives = current?.alternatives;
  const n = h.nutrition;
  return (
    <section className="health-panel" aria-labelledby="health-heading">
      <h3 id="health-heading">Health score</h3>
      <div className="health-summary">
        {scored ? (
          <div className={'score-ring score-' + h.band} aria-hidden="true">
            <strong>{h.value}</strong>
            <span>/100</span>
          </div>
        ) : (
          <div className="score-ring score-none" aria-hidden="true">
            <strong>–</strong>
          </div>
        )}
        <div>
          <p className="score-verdict">
            {scored ? (
              <>
                <strong>{bandLabel[h.band!]}</strong> · {h.value}/100
              </>
            ) : (
              <strong>Not scored</strong>
            )}
          </p>
          {h.notes.map((note) => (
            <p className="fine" key={note}>
              {note}
            </p>
          ))}
        </div>
      </div>
      <dl className="health-breakdown">
        <div>
          <dt>Nutrition (60)</dt>
          <dd>
            {n ? (
              <>
                <span className={'nutri-letter nutri-' + n.grade} aria-hidden="true">
                  {n.grade.toUpperCase()}
                </span>{' '}
                Nutri-Score {n.grade.toUpperCase()}
                {h.nutritionPoints !== undefined && ` · ${h.nutritionPoints} points`}
                <span className="fine">
                  {' '}
                  {n.origin === 'source'
                    ? '(computed by Open Food Facts)'
                    : '(estimated here from declared values)'}
                </span>
              </>
            ) : (
              'Unknown'
            )}
          </dd>
        </div>
        <div>
          <dt>Additives (30)</dt>
          <dd>
            {h.additivePoints} points ·{' '}
            {h.additives.length
              ? `${h.additives.length} recorded, ${h.additives.filter((a) => a.flag).length} flagged`
              : product.ingredients || product.additives?.length
                ? 'none recorded'
                : 'unknown'}
          </dd>
        </div>
        <div>
          <dt>Organic (10)</dt>
          <dd>
            {h.organicPoints} points ·{' '}
            {h.organic ? (
              <>
                <Leaf size={14} aria-hidden="true" /> certified label recorded
              </>
            ) : (
              'no organic label recorded'
            )}
          </dd>
        </div>
        {h.nova && (
          <div>
            <dt>Processing (not scored)</dt>
            <dd>
              NOVA {h.nova}: {novaLabel[h.nova]}
            </dd>
          </div>
        )}
      </dl>
      {h.additives.some((a) => a.flag) && (
        <ul className="additive-list">
          {h.additives
            .filter((a) => a.flag)
            .map(({ code, flag }) => (
              <li key={code}>
                <span className={'risk risk-' + flag!.risk}>{riskLabel[flag!.risk]}</span>{' '}
                <strong>
                  {code.toUpperCase()} {flag!.name}
                </strong>
                <p className="fine">
                  {flag!.summary}{' '}
                  <a href={flag!.source} target="_blank" rel="noreferrer">
                    Source
                  </a>
                </p>
              </li>
            ))}
        </ul>
      )}
      {h.additives.some((a) => !a.flag) && (
        <p className="fine">
          Also recorded without a flag in this table:{' '}
          {h.additives
            .filter((a) => !a.flag)
            .map((a) => a.code.toUpperCase())
            .join(', ')}
          . No flag is not a safety finding.
        </p>
      )}
      {scored && code && (
        <div className="better-alternatives">
          <div className="row wrap between">
            <h4>Better-scoring alternatives</h4>
            <div className="segmented" role="group" aria-label="Shop">
              {shops.map(([id, label]) => (
                <button
                  key={id}
                  className={'btn' + (shop === id ? ' primary' : '')}
                  aria-pressed={shop === id}
                  onClick={() => setShop(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <p className="row fine" role="status">
              <Loader2 className="spin" size={16} /> Finding alternatives…
            </p>
          ) : error ? (
            <p className="fine" role="status">
              {error}
            </p>
          ) : alternatives?.length ? (
            <ul className="alternative-list">
              {alternatives.map(({ product: p, score }) => (
                <li key={p.id}>
                  <button className="alternative" onClick={() => onOpen?.(p)}>
                    <Photo product={p} />
                    <span>
                      <strong>{p.name}</strong>
                      <span className="fine">
                        {[p.brand?.split(',')[0], p.pack].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={'score-badge score-' + score.band}>{score.value}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            alternatives && (
              <p className="fine">
                No clearly better product in this category was found in the saved catalogue.
              </p>
            )
          )}
          <p className="fine">
            Same catalogue category and at least 10 points higher. Taste, allergens and current
            stock are not compared.
          </p>
        </div>
      )}
      <details className="fine">
        <summary>How the score works</summary>
        <p>
          Nutrition gives up to 60 points from the Nutri-Score grade (A 60, B 48, C 33, D 18, E 5).
          Additives give up to 30 points, minus 15, 8 or 3 for each additive with a high, moderate
          or limited flag; a high flag caps the total at 49. A recorded organic certification adds
          10. NOVA processing is shown but not scored. Additive flags summarise EFSA, WHO/IARC and
          EU labelling evidence reviewed on {scoreReviewed}. The score is a comparison aid for
          similar products, not medical or allergy advice, and depends on catalogue data that may be
          incomplete or out of date.
        </p>
      </details>
    </section>
  );
}
