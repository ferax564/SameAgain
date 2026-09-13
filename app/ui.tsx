'use client';
import {ReactNode,useState} from 'react';
import {Select,SelectTrigger,SelectContent,SelectItem,SelectValue} from '@/components/ui/select';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Package,Repeat2} from 'lucide-react';
export function Choice({value,onChange,options,label}: {value:string;onChange:(v:string)=>void;options:Record<string,string>;label:string}){return <Select value={value||'_none'} onValueChange={v=>onChange(v==='_none'?'':v)}><SelectTrigger aria-label={label} className="choice"><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{Object.entries(options).map(([v,t])=><SelectItem key={v} value={v||'_none'}>{t}</SelectItem>)}</SelectContent></Select>}
export function Modal({title,description,open,onClose,children,wide=false}:{title:string;description?:string;open:boolean;onClose:()=>void;children:ReactNode;wide?:boolean}){return <Dialog open={open} onOpenChange={v=>!v&&onClose()}><DialogContent className={'modal '+(wide?'wide':'')}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description||'Same Again · your shared household'}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>}
export function Photo({product,large=false}:{product?:any;large?:boolean}){
 const [failed,setFailed]=useState('');const url=product?.image;const missing=!url||failed===url;
 return <div className={'product-photo '+(large?'large ':'')+(missing?'photo-unavailable':'')}>
  {missing?<span className="photo-fallback" aria-label={product?.name?`Photo unavailable for ${product.name}`:'Photo unavailable'}><Package size={large?32:22} strokeWidth={1.4}/>{large&&<span>Photo unavailable</span>}</span>:<img key={url} src={url} alt={product.name||'Product'} loading="lazy" decoding="async" onError={()=>setFailed(url)}/>}
 </div>
}
export function Brand(){return <div className="brand"><span className="brand-symbol"><Repeat2 size={28} strokeWidth={2.2}/></span><span>same again<span className="brand-dot">.</span></span></div>}
