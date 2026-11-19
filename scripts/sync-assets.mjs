import { mkdir, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'), output=resolve(root,'public');
await mkdir(output,{recursive:true});
for(const name of ['index.html','atleta.html','gestor.html','styles.css','app.mjs','competition-ui.mjs','schedule-ui.mjs','roster-review-ui.mjs','operations.mjs','public-visibility.mjs','commerce.mjs','assets','operacao'])await cp(resolve(root,name),resolve(output,name),{recursive:true});
await rm(resolve(output,'favicon.svg'),{force:true});
console.log('Arena pages and official branding copied to public/.');
