import { Flag, MoreHorizontal, UserRound } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { RecordData } from '@/lib/domain';
import { Photo } from '../ui';
import { useApp } from '../state/context';
import { units } from '../state/helpers';

/** One line of the shopping list: check off, edit, claim and the per-item action menu. */
export function ItemRow({ item }: { item: RecordData }) {
  const {
    s,
    items,
    toggle,
    openItem,
    memberName,
    saveFavourite,
    openTranslate,
    findMatches,
    openForm,
    remove,
  } = useApp();
  const d = item.data;
  return (
    <article className={'item-row ' + (d.done ? 'completed' : '')}>
      <Checkbox
        className="purchase-check"
        checked={!!d.done}
        aria-label={(d.done ? 'Uncheck ' : 'Buy ') + d.name}
        onCheckedChange={() => toggle(item)}
      />
      <button className="item-main" onClick={() => openItem(d, item)}>
        <Photo product={{ ...d.product, name: d.name, image: d.image || d.product?.image }} />
        <div className="item-info">
          <div className="item-title">
            {d.name}
            {d.priority === 'high' && <Flag size={14} aria-label="High priority" />}
          </div>
          <span className="item-meta">
            {d.product?.brand?.split(',')[0] || d.category}
            {d.pack ? ' · ' + d.pack : ''}
          </span>
          {d.notes && <span className="item-note">{d.notes}</span>}
          {d.done && <span className="item-meta">Bought by {memberName(d.purchasedBy)}</span>}
        </div>
        <span className="quantity">
          {d.quantity}
          <small>{units[d.unit as keyof typeof units] || d.unit}</small>
        </span>
      </button>
      <button
        className={'avatar small ' + (d.assigned ? 'assigned' : 'unassigned')}
        aria-label={
          d.assigned
            ? 'Assigned to ' + memberName(d.assigned) + '. Change shopper.'
            : 'Claim ' + d.name
        }
        title={d.assigned ? memberName(d.assigned) : 'Claim item'}
        onClick={() =>
          d.assigned && d.assigned !== s.user?.id
            ? openItem(d, item)
            : s.mutate('item', { ...d, assigned: d.assigned ? '' : s.user?.id }, item)
        }
      >
        {d.assigned ? memberName(d.assigned).slice(0, 1) : <UserRound size={16} />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="iconbtn item-more" aria-label={'More actions for ' + d.name}>
            <MoreHorizontal size={18} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openItem(d, item)}>Edit or move item</DropdownMenuItem>
          <DropdownMenuItem onClick={() => saveFavourite(d)}>Save favourite</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              openTranslate();
              if (d.product) void findMatches(item);
            }}
          >
            Find abroad
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              s.mutate(
                'item',
                { ...d, order: Math.min(...items.map((x) => x.data.order || 0)) - 1 },
                item,
              )
            }
          >
            Move to top
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              openForm('observation', {
                productId: d.product?.id,
                name: d.name,
                store: d.store || '',
                date: new Date().toISOString().slice(0, 10),
                price: null,
              })
            }
          >
            Record where bought
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => remove(item)}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}
