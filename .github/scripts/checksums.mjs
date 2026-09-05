import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const directory=process.argv[2];
for(const name of (await readdir(directory)).filter(f=>f.endsWith('.tar.gz')).sort()){
  const digest=createHash('sha256').update(await readFile(join(directory,name))).digest('hex');
  await writeFile(join(directory,name+'.sha256'),digest+'  '+name+'\n');
}
