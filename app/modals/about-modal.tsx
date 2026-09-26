import { ExternalLink, Monitor } from 'lucide-react';
import { Brand, Modal } from '../ui';
import { useApp } from '../state/context';

/** About Same Again: ranking, sources, licences, privacy and limitations. */
export function AboutModal() {
  const { modal, setModal } = useApp();
  return (
    <Modal
      open={modal === 'about'}
      onClose={() => setModal('')}
      title="Familiar things. Clear information."
      wide
    >
      <div className="stack prose">
        <Brand />
        <p>
          Same Again keeps shared lists, exact favourites and approved country alternatives
          together.
        </p>
        <h3>How candidates are ranked</h3>
        <p>
          We retrieve a category’s products, require a destination-country record, then exclude
          candidates with missing or conflicting required attributes. Shared ingredients, compatible
          per-100-unit nutrition, pack size and brand contribute to a reproducible score. The chosen
          priority changes their weight. Match bands summarise evidence; they are not a percentage
          of identicalness.
        </p>
        <p>
          Intended use is inferred from a shared category. Taste and texture require member
          feedback. Sweetening, powder and concentrate differences can disqualify candidates. No
          confident evidence means no confident match.
        </p>
        <h3>Sources and licences</h3>
        <p>
          Contains information from{' '}
          <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">
            Open Food Facts
          </a>
          , made available under the{' '}
          <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">
            Open Database Licence 1.0
          </a>
          . Individual contents are under DbCL 1.0. Product photos are supplied by Open Food Facts
          contributors under{' '}
          <a
            href="https://creativecommons.org/licenses/by-sa/3.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-SA 3.0
          </a>
          . Original product pages provide source attribution. Catalogue records are cached
          separately from private household data.
        </p>
        <h3>Imported retailer records</h3>
        <p>
          Coop and Migros page imports are partial. Indexed page titles are labelled separately from
          successfully scraped product facts. Each record links its source; no barcode, missing
          nutrient or branch stock is inferred. Retailer content is not covered by the Open Food
          Facts licence. Retailer photos and promotional descriptions have not been copied.
        </p>
        <h3>What we can and cannot know</h3>
        <p>
          Catalogue entries are community-maintained and may be incomplete or outdated. A country
          entry does not establish current availability. Nearby stores use OpenStreetMap data via
          Photon, with map links and no connected inventory. Prices are entered by members, with
          currency and date. Nothing is automatically purchased.
        </p>
        <h3>Privacy and syncing</h3>
        <p>
          Every shared request requires a signed-in household member. Shopping changes sync about
          every four seconds. Cached active lists work offline after first loading. Conflicting
          edits stop for review. Account deletion anonymises contributions retained in shared lists;
          household owners must transfer ownership or delete their household first.
        </p>
        <p>
          Camera access happens only when you open the scanner. Location is used only for an
          explicit place search, rounded before sending to Photon, and never saved as account
          history. Private photos stay within the household. Sign out clears this device’s offline
          cache.
        </p>
        <a className="btn" href="/device-check" target="_blank">
          Check this device <Monitor size={16} />
        </a>
        <h3>Meals, nutrition & ingredient evidence</h3>
        <p>
          Shared recipes keep photos, weighed ingredients and methods. Meal plans preserve a recipe
          snapshot. Nutrition uses matched per-100-g or per-100-ml values, scales by portions, and
          labels incomplete totals. Generic data is from the Swiss Food Composition Database, FSVO
          v7.1, reused with attribution under its published dataset permission. Generic composition
          values are averages and do not establish brand identity or allergy safety.
        </p>
        <p>
          Ingredient context currently covers four sweeteners, with links to EFSA and WHO sources.
          It is not a comprehensive hazard ranking. No concentration or personal exposure is
          inferred. Targets are optional values entered by you.
        </p>
        <h3>Current limitations</h3>
        <p>
          The interface is in English. Prices and dates follow your device’s regional format.
          Product coverage is strongest for packaged food. Household essentials work as generic or
          private items. No retailer stock, verified taste equivalence, background reminders or full
          pantry tracking is connected. Family access also depends on the site’s hosting access
          policy.
        </p>
        <a className="btn" href="/guide" target="_blank">
          Setup, testing & technical guide <ExternalLink size={16} />
        </a>
      </div>
    </Modal>
  );
}
