import { useEffect, useState } from 'react';
import { ChefHat, Compass, Heart, ListChecks, Users } from 'lucide-react';
import { type Product, priceBasis } from '@/lib/domain';

/** Current time for event handlers (kept out of render so React can treat renders as pure). */
export const timestamp = () => Date.now();
/** Re-renders every minute so time-relative labels (e.g. invitation expiry) stay current. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(timestamp);
  useEffect(() => {
    const t = setInterval(() => setNow(timestamp()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
/** Identity and display fields of a product; drops nutrition, ingredients and source payloads. */
export function compactProduct(p: Product): Product {
  const { id, name, brand, barcode, image, pack, categories, countries, source, sourceUrl } = p;
  const { retrieved, demo } = p;
  return {
    id,
    name,
    brand,
    barcode,
    image,
    pack,
    categories,
    countries,
    source,
    sourceUrl,
    retrieved,
    demo,
  };
}
/** Price fields follow the unit: per kg for g/kg, per litre for ml/l, otherwise per item. */
export const priceLabel = (unit?: string) =>
  ({ kg: 'per kg', l: 'per litre', item: 'per item' })[priceBasis(unit)];
export const substitutions = {
  exact: 'Exact product only',
  brand: 'Same brand preferred',
  similar: 'Similar alternatives accepted',
  ask: 'Ask before substituting',
};
export const units = { pack: 'packs', piece: 'pieces', kg: 'kg', g: 'g', l: 'litres', ml: 'ml' };
export const navigation = [
  { id: 'lists', label: 'Lists', icon: ListChecks },
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'meals', label: 'Meals', icon: ChefHat },
  { id: 'favourites', label: 'Favourites', icon: Heart },
  { id: 'household', label: 'Household', icon: Users },
];
