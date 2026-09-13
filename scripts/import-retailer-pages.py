"""Import only factual fields from saved public Firecrawl pages and URL indexes.
Usage: python scripts/import-retailer-pages.py .firecrawl lib/retailer-products.json
No live crawling, guessed barcodes, copied descriptions, prices, or stock assertions.
"""
import json,re,sys,html,pathlib
from html.parser import HTMLParser
from datetime import datetime,timezone
class Node:
 def __init__(self,tag='',attrs=None):self.tag=tag;self.attrs=dict(attrs or []);self.children=[]
 def text(self):return ''.join(c.text() if isinstance(c,Node) else c for c in self.children)
 def all(self,p):return ([self] if p(self) else [])+[n for c in self.children if isinstance(c,Node) for n in c.all(p)]
class DOM(HTMLParser):
 def __init__(self,s):super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root];self.feed(s)
 def handle_starttag(self,t,a):
  n=Node(t,a);self.stack[-1].children.append(n)
  if t not in ['img','br','hr','input','meta','link','source','wbr','area','base','col','embed','param','track']:self.stack.append(n)
 def handle_endtag(self,t):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==t:self.stack=self.stack[:i];return
 def handle_data(self,d):self.stack[-1].children.append(d)
def clean(s):return re.sub(r'\s+',' ',s).strip()
def parse_page(page):
 url=page.get('url','');m=re.fullmatch(r'https://www.migros.ch/de/product/((?:mo/)?\d+)',url)
 if not m:return None
 doc=DOM(page.get('html','')).root
 titles=doc.all(lambda n:n.tag=='h1' and 'product-detail-' in n.attrs.get('data-testid',''))
 if not titles:return None
 name=clean(titles[0].text())
 if not name or len(name)>160:return None
 p={'id':'migros:'+m[1].replace('/','-'),'name':name,'categories':[],'countries':['en:switzerland'],'stores':['migros'],'source':'Migros · public product page','sourceUrl':url,'retrieved':page['retrieved'],'evidence':'retailer-page','retailer':'migros-ch'}
 weights=doc.all(lambda n:re.fullmatch(r'product-detail-\d+-weight',n.attrs.get('data-testid','')) is not None)
 if weights:p['pack']=clean(weights[0].text())
 ingredients=doc.all(lambda n:n.tag=='dd' and n.attrs.get('data-testid','').endswith('-ingredients'))
 if ingredients:
  text=clean(ingredients[0].text()).split('Allergiker-Infos:')[0].strip()
  if text and len(text)<=6000:p['ingredients']=text
 # Bold text is not an exhaustive allergen declaration; leave allergens/traces unknown.
 nutrient_names={'Fett':'fat','davon gesättigte Fettsäuren':'saturated-fat','Kohlenhydrate':'carbohydrates','davon Zucker':'sugars','Ballaststoffe':'fiber','Eiweiss':'proteins','Salz':'salt','Energiewert in kcal':'energy-kcal'}
 for table in doc.all(lambda n:n.tag=='table'):
  headers=[clean(n.text()) for n in table.all(lambda n:n.tag=='th')]
  if len(headers)!=2 or headers[1] not in ['100 g','100 ml']:continue
  nutrition={}
  for row in table.all(lambda n:n.tag=='tr'):
   cells=row.all(lambda n:n.tag=='td')
   if len(cells)!=2:continue
   label=re.sub(r' (hoch|gering|mittel)$','',clean(cells[0].text()));value=clean(cells[1].text())
   key=nutrient_names.get(label);v=re.fullmatch(r'(\d+(?:[.,]\d+)?)\s*(g|kcal)',value)
   if key and v and v[2]==('kcal' if key=='energy-kcal' else 'g'):nutrition[key]=float(v[1].replace(',','.'))
   # Source kJ is explicitly converted, never guessed from macros.
   if label=='Energiewert in kJ':
    kj=re.fullmatch(r'(\d+(?:[.,]\d+)?)\s*kJ',value)
    if kj:nutrition['energy-kcal']=round(float(kj[1].replace(',','.'))/4.184,3);p['nutritionNote']='Energy converted from declared kJ using 4.184 kJ/kcal.'
  if nutrition:p['nutrition']=nutrition;p['basis']=headers[1].replace(' ','')
 return p

def build(folder):
 index=json.load(open(folder/'retailer-index.json'));products={}
 for retailer in ['migros','coop']:
  for item in index[retailer]:
   u=item['url'].split('?')[0];title=item.get('title','')
   m=re.fullmatch(r'https://www.migros.ch/(?:de|en|fr|it)/product/((?:mo/)?\d+)',u) if retailer=='migros' else re.fullmatch(r'https://www.coop.ch/(?:de|en|fr|it)/.+/p/(\d+)',u)
   if not m or not title:continue
   name=re.sub(r'\s*(?:[•|–-]\s*)?(?:online kaufen.*|online kaufen|buy online.*|Migros|coop\.ch|COOP)\s*$','',title,flags=re.I).strip(' ·-|')
   if not name or len(name)>160:continue
   id=retailer+':'+m[1].replace('/','-')
   if id in products:continue
   products[id]={'id':id,'name':name,'categories':[],'countries':['en:switzerland'],'stores':[retailer],'source':retailer.capitalize()+' · indexed page title','sourceUrl':u,'retrieved':index['retrieved'],'evidence':'indexed-link','retailer':retailer+'-ch'}
 for path in sorted(folder.glob('migros-*.json')):
  try:
   p=parse_page(json.load(open(path)))
   if p:products[p['id']]=p
  except (ValueError,KeyError,TypeError):pass
 return list(products.values())
if __name__=='__main__':
 folder=pathlib.Path(sys.argv[1]);products=build(folder)
 pathlib.Path(sys.argv[2]).write_text(json.dumps(products,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'products':len(products),'page_details':sum(p['evidence']=='retailer-page' for p in products),'nutrition':sum(bool(p.get('nutrition')) for p in products)}))
