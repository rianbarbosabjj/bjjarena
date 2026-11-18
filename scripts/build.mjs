import {cp,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),dist=join(root,'dist');
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
for(const entry of ['index.html','atleta.html','gestor.html','styles.css','app.mjs','commerce.mjs','assets','operacao'])await cp(join(root,entry),join(dist,entry),{recursive:true});
console.log('Built static BJJ Arena pages in dist/; server code and tests are excluded.');
