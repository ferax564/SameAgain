'use client';
import { ReactNode, useState } from 'react';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Package, Repeat2 } from 'lucide-react';
export function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Record<string, string>;
  label: string;
}) {
  return (
    <Select value={value || '_none'} onValueChange={(v) => onChange(v === '_none' ? '' : v)}>
      <SelectTrigger aria-label={label} className="choice">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(options).map(([v, t]) => (
          <SelectItem key={v} value={v || '_none'}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Modal({
  title,
  description,
  open,
  onClose,
  children,
  wide = false,
  dismissible = true,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** When false the dialog has no close button and ignores Escape/outside clicks: the user must pick an action. */
  dismissible?: boolean;
}) {
  const block = (e: Event) => e.preventDefault();
  return (
    <Dialog open={open} onOpenChange={(v) => !v && dismissible && onClose()}>
      <DialogContent
        className={'modal ' + (wide ? 'wide' : '')}
        showCloseButton={dismissible}
        {...(dismissible ? {} : { onEscapeKeyDown: block, onInteractOutside: block })}
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export type PhotoProduct = { name?: string; image?: string | null };
export function Photo({
  product,
  large = false,
}: {
  product?: PhotoProduct | null;
  large?: boolean;
}) {
  const [failed, setFailed] = useState('');
  const url = product?.image;
  const missing = !url || failed === url;
  return (
    <div
      className={'product-photo ' + (large ? 'large ' : '') + (missing ? 'photo-unavailable' : '')}
    >
      {missing ? (
        <span
          className="photo-fallback"
          role="img"
          aria-label={product?.name ? `Photo unavailable for ${product.name}` : 'Photo unavailable'}
        >
          <Package size={large ? 32 : 22} strokeWidth={1.4} />
          {large && <span>Photo unavailable</span>}
        </span>
      ) : (
        <img
          key={url}
          src={url}
          alt={product?.name || 'Product'}
          width={large ? 320 : 96}
          height={large ? 320 : 96}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(url)}
        />
      )}
    </div>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        <Repeat2 size={28} strokeWidth={2.2} />
      </span>
      <span>
        same again<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
