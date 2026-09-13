// Opt-in local OCR check. Photo and outputs stay in ignored local test storage.
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createWorker,PSM} from 'tesseract.js';
const input=process.argv[2];if(!input)throw new Error('Pass a local receipt photo path.');
mkdirSync('.sites-runtime/receipt',{recursive:true});
await build({entryPoints:['lib/receipt-image.ts','lib/receipt.ts'],outdir:'.sites-runtime/receipt',format:'esm',outExtension:{'.js':'.mjs'}});
const {suggestPaperCrop}=await import('../.sites-runtime/receipt/receipt-image.mjs');
const {parseReceipt}=await import('../.sites-runtime/receipt/receipt.mjs');
function python(code,args=[]){const r=spawnSync('python',['-c',code,...args],{encoding:'utf8'});if(r.status)throw new Error(r.stderr);return r.stdout}
const size=JSON.parse(python("from PIL import Image,ImageOps;import sys,json;i=ImageOps.exif_transpose(Image.open(sys.argv[1])).convert('RGBA');w,h=i.size;s=200/max(w,h);p=i.resize((round(w*s),round(h*s)));open('.sites-runtime/receipt/probe.rgba','wb').write(p.tobytes());print(json.dumps([p.width,p.height]))",[input]));
const crop=suggestPaperCrop(new Uint8ClampedArray(readFileSync('.sites-runtime/receipt/probe.rgba')),...size);
python("from PIL import Image,ImageOps;import sys,json;i=ImageOps.exif_transpose(Image.open(sys.argv[1])).convert('RGB');c=json.loads(sys.argv[2]);w,h=i.size;i=i.crop((w*c['left']/100,h*c['top']/100,w*c['right']/100,h*c['bottom']/100));s=min(2,3200/max(i.size));i=i.resize((round(i.width*s),round(i.height*s)),Image.Resampling.BICUBIC);i.save('.sites-runtime/receipt/input.png')",[input,JSON.stringify(crop)]);
const w=await createWorker('deu',1,{langPath:'public/ocr/v7/lang',cacheMethod:'none'});
try{await w.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,preserve_interword_spaces:'1'});const {data}=await w.recognize('.sites-runtime/receipt/input.png',{rotateAuto:true});const parsed=parseReceipt(data.text);writeFileSync('.sites-runtime/receipt/recognised.txt',data.text);writeFileSync('.sites-runtime/receipt/parsed.json',JSON.stringify(parsed,null,2));console.log(JSON.stringify({crop,confidence:data.confidence,store:parsed.store,date:parsed.date,total:parsed.total,count:parsed.items.length,items:parsed.items.map(i=>({name:i.name,quantity:i.quantity,unit:i.unit,lineTotal:i.lineTotal})),warnings:parsed.warnings},null,2))}finally{await w.terminate()}
