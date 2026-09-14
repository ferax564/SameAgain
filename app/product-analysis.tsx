'use client';
import {analyzeProduct} from '@/lib/product-analysis';
import {additiveEvidenceReviewed} from '@/lib/additive-evidence';
import {IngredientReview,ProductNutrition} from './nutrition-panel';
import type {Product,Constraint} from '@/lib/domain';

export function ScoreBadge({product,large=false}:{product:Product;large?:boolean}){
 const a=analyzeProduct(product);
 if(a.score==null)return large?<span className="score-badge score-unknown">Score incomplete</span>:null;
 return <span className={'score-badge score-'+a.band?.tone+(large?' score-large':'')} title={a.band?.label}>
  <strong>{a.score}</strong>{large&&<span>{a.band?.label}</span>}
 </span>;
}

export function ProductAnalysis({product,constraints=[]}:{product:Product;constraints?:Constraint[]}){
 const a=analyzeProduct(product);
 return <div className="stack product-analysis">
  <section className="analysis-hero">
   <div className="analysis-hero-top">
    <ScoreBadge product={product} large/>
    <div>
     <h3>Ingredients, nutrition and additives</h3>
     <div className="row wrap analysis-pills">
      {a.nutriScore&&<span className={'pill nutri-'+a.nutriScore}>Nutri-Score {a.nutriScore.toUpperCase()}{a.nutriScoreSource==='open-food-facts'?' · OFF':''}</span>}
      {a.novaGroup&&<span className={'pill nova-'+a.novaGroup}>NOVA {a.novaGroup}{a.novaGroup===4?' · ultra-processed':''}</span>}
      {a.organic&&<span className="pill">Organic label</span>}
      {a.missingIngredients&&<span className="pill">Ingredients not recorded</span>}
     </div>
    </div>
   </div>
   <p className="fine">{a.notice}</p>
  </section>
  <div className="analysis-breakdown">
   <article><span>Nutrition</span><strong>{a.nutritionPoints==null?'—':a.nutritionPoints+' / 60'}</strong><small>{a.nutriScoreSource==='open-food-facts'?'Open Food Facts Nutri-Score':a.nutriScoreSource==='estimated-macros'?'Estimated from labelled macros, not official Nutri-Score':'Not enough labelled macros'}</small></article>
   <article><span>Additives</span><strong>{a.additivePoints==null?'—':a.additivePoints+' / 30'}</strong><small>{a.additives.length?a.additives.filter(x=>x.concern!=='low').length+' flagged · '+a.additives.length+' matched':a.missingIngredients?'No ingredient list to review':'No matched additive of concern'}</small></article>
   <article><span>Organic</span><strong>{a.organicPoints} / 10</strong><small>{a.organic?'A recorded organic/bio label':'No organic label on the community record'}</small></article>
  </div>
  <section>
   <h3>Ingredient list</h3>
   {a.missingIngredients?(product.ingredientsImage?<div className="ingredients-photo-wrap"><img src={product.ingredientsImage} alt={'Ingredient list photo for '+(product.name||'this product')} loading="lazy"/><p className="notice">Ingredient list from the Open Food Facts pack photo. The words have not been transcribed yet. Check the pack.</p></div>:<p className="notice">Ingredients are not in this snapshot. Open the product source or check the pack. Demo browse uses the saved catalogue; a signed-in household can refresh a barcode from Open Food Facts.</p>):<div className="ingredient-chips">{a.chips.map((c,i)=><span key={i} className={'ingredient-chip '+(c.additive?'concern-'+c.additive.concern:c.unknownCode?'concern-unknown':'')}>{c.text}{c.additive&&<em>{c.additive.id.toUpperCase()}</em>}</span>)}</div>}
   {product.allergens&&<p className="fine"><strong>Declared allergens:</strong> {product.allergens.length?product.allergens.map(x=>x.replace(/^[a-z]{2}:/,'').replaceAll('-',' ')).join(', '):'None in the catalogue declaration'}</p>}
   <p className="notice">Missing information is not confirmation of suitability. Check the current package, especially for allergies.</p>
  </section>
  <section className="stack">
   <h3>Additives and chemicals</h3>
   {!a.additives.length&&!a.unknownAdditives.length&&<p className="muted">{a.missingIngredients?'No additive review is possible without ingredients.':'No matched E-number in our evidence set. That is not a clean bill of health.'}</p>}
   {a.additives.map(m=><article className={'evidence-card concern-'+m.concern} key={m.id}><div className="row between"><h4>{m.name}</h4><span className="pill">{m.id.toUpperCase()} · {m.concern}</span></div><p>{m.summary}</p><small>{m.certainty}</small><a className="link" href={m.source} target="_blank" rel="noreferrer">Read the evidence ↗</a></article>)}
   {!!a.unknownAdditives.length&&<p className="notice">Also recorded, without a Same Again evidence card: {a.unknownAdditives.map(c=>c.toUpperCase()).join(', ')}. Presence is not ranked.</p>}
   <p className="fine">Additive evidence checked {additiveEvidenceReviewed}. Amounts are not on the label snapshot, so intake cannot be calculated. This is not Yuka, not an EFSA exposure assessment and not medical advice.</p>
  </section>
  <ProductNutrition product={product}/>
  <IngredientReview product={product} constraints={constraints}/>
 </div>;
}
