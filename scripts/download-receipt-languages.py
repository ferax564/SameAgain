"""Fetch pinned OCR models. No receipt data is transmitted."""
from pathlib import Path
import hashlib,json,urllib.request
out=Path('public/ocr/v7/lang');out.mkdir(parents=True,exist_ok=True)
report={'repository':'https://github.com/naptha/tessdata','version':'1.0.0','variant':'4.0.0_best_int','licence':'Language npm packaging: MIT; upstream Tesseract trained data: Apache-2.0','upstream':'https://github.com/tesseract-ocr/tessdata_best','files':{}}
for language in ['deu','eng','fra','ita','spa','por','nld']:
 name=language+'.traineddata.gz';path=out/name
 url=f'https://cdn.jsdelivr.net/npm/@tesseract.js-data/{language}@1.0.0/4.0.0_best_int/{name}'
 blob=urllib.request.urlopen(url,timeout=60).read();path.write_bytes(blob)
 report['files'][name]={'sha256':hashlib.sha256(blob).hexdigest(),'url':url}
 print(language,len(blob),flush=True)
(out/'sources.json').write_text(json.dumps(report,indent=2)+'\n')
